"use strict";

/**
 * CRM-ready alerts. Raised once each (dedupe via AlertStore) for:
 *   hot_complaint     a new Hot complaint
 *   switching_intent  a new complaint from someone considering alternatives
 *   rising_trend      a competitor × pain combination heating up this month
 *
 * Optional delivery: POST to COMPLAINT_MINER_WEBHOOK_URL. The body has a Slack/Teams-compatible
 * `text` summary plus structured `alerts` for CRM automations (HubSpot/Salesforce via Zapier,
 * Make or a small webhook handler).
 */

const axios = require("axios");
const { ALERTS } = require("../insights/config");
const { shortHash } = require("../helpers/text.helper");
const { withDateConfidence } = require("./confidence");

const DAY_MS = 86400000;

function complaintAlert(c, createdAt) {
    const isHot = c.leadTier === "Hot";
    const key = `complaint:${c.id}`;
    const posted = c.publishedAt ? String(c.publishedAt).slice(0, 10) : "date unknown";
    return withDateConfidence({
        alertId: shortHash(key),
        dedupeKey: key,
        type: isHot ? "hot_complaint" : "switching_intent",
        createdAt,
        competitorKey: c.competitorKey,
        competitorName: c.competitorName,
        painCategory: c.painCategory,
        painCategoryLabel: c.painCategoryLabel,
        title: `${isHot ? "Hot" : "Switching"} · ${c.competitorName} · ${c.painCategoryLabel}`,
        message: c.painSummary || c.quote,
        quote: c.quote,
        sourceLabel: c.sourceLabel,
        sourceUrl: c.url,
        postedAt: c.publishedAt || null,
        authorType: c.authorType,
        leadTier: c.leadTier,
        leadScore: c.leadScore,
        switchingIntent: c.switchingIntent,
        playbook: { competitorKey: c.competitorKey, painCategory: c.painCategory },
        crm: {
            subject: `[Competitor intel] ${c.competitorName}: ${c.painCategoryLabel}`,
            body: `"${c.quote}"\n\nSource: ${c.sourceLabel} — ${c.url}\nPosted: ${posted}`,
            tags: ["competitor-intel", c.competitorKey, c.painCategory, (c.leadTier || "").toLowerCase()].filter(Boolean),
        },
    });
}

function trendAlert(m, asOfMonth, createdAt) {
    const key = `trend:${m.competitorKey}:${m.painCategory}:${asOfMonth}`;
    const change = m.status === "new"
        ? `${m.recent} complaints in the last 30 days (none before)`
        : `${m.recent} complaints in the last 30 days vs ~${m.priorAvg}/month before`;
    return {
        alertId: shortHash(key),
        dedupeKey: key,
        type: "rising_trend",
        priority: "medium",
        createdAt,
        competitorKey: m.competitorKey,
        competitorName: m.competitorName,
        painCategory: m.painCategory,
        painCategoryLabel: m.painCategoryLabel,
        title: `Rising · ${m.competitorName} · ${m.painCategoryLabel}`,
        message: change,
        quote: null,
        sourceLabel: null,
        sourceUrl: null,
        postedAt: null,
        trend: { recent: m.recent, priorAvg: m.priorAvg, changePct: m.changePct, status: m.status },
        suggestedAction: `Update ${m.competitorName} messaging: "${m.painCategoryLabel}" complaints are ${m.status === "new" ? "a new pattern" : "rising"}.`,
        playbook: { competitorKey: m.competitorKey, painCategory: m.painCategory },
        crm: {
            subject: `[Competitor trend] ${m.competitorName}: ${m.painCategoryLabel} ${m.status}`,
            body: change,
            tags: ["competitor-intel", "trend", m.competitorKey, m.painCategory],
        },
    };
}

/**
 * @param {object}   args
 * @param {object[]} args.complaints  prepared (scored + enriched) complaints
 * @param {object[]} args.movers      insights.trends.movers
 * @param {string}   args.asOf        insights.asOf
 * @param {(key: string) => boolean} [args.isSent]
 * @returns {object[]} new alerts, high priority first
 */
function buildAlerts({ complaints, movers = [], asOf, isSent = () => false, cfg = ALERTS }) {
    const asOfMs = new Date(asOf).getTime();
    const createdAt = new Date().toISOString();
    const recentEnough = (c) => {
        const when = new Date(c.publishedAt || c.foundAt).getTime();
        return Number.isFinite(when) && asOfMs - when <= cfg.lookbackDays * DAY_MS;
    };

    const fromComplaints = complaints
        .filter((c) => (c.leadTier === "Hot" || c.switchingIntent === "considering") && recentEnough(c))
        .map((c) => complaintAlert(c, createdAt));
    const fromTrends = movers.map((m) => trendAlert(m, String(asOf).slice(0, 7), createdAt));

    const rank = { high: 0, medium: 1, low: 2 };
    return [...fromComplaints, ...fromTrends]
        .filter((a) => !isSent(a.dedupeKey))
        .sort((a, b) => rank[a.priority] - rank[b.priority] || (b.leadScore || 0) - (a.leadScore || 0))
        .slice(0, cfg.maxPerRun);
}

function summaryText(alerts) {
    const lines = alerts.slice(0, 10).map((a) => `• *${a.title}*${a.dateKnown === false ? " (post date unknown)" : ""} — ${a.message}${a.sourceUrl ? ` (<${a.sourceUrl}|source>)` : ""}`);
    const more = alerts.length > 10 ? `\n…and ${alerts.length - 10} more.` : "";
    return `AI Complaint Miner: ${alerts.length} new competitor alert(s)\n${lines.join("\n")}${more}`;
}

/** @returns {Promise<{ delivered: boolean, status?: number, error?: string }>} */
async function deliverAlerts(alerts, { webhookUrl = process.env.COMPLAINT_MINER_WEBHOOK_URL, http = axios } = {}) {
    if (!alerts.length || !webhookUrl) return { delivered: false };
    try {
        const res = await http.post(
            webhookUrl,
            { source: "ai-complaint-miner", generatedAt: new Date().toISOString(), count: alerts.length, text: summaryText(alerts), alerts },
            { timeout: 20000, headers: { "Content-Type": "application/json" } }
        );
        return { delivered: true, status: res.status };
    } catch (err) {
        return { delivered: false, status: err.response?.status, error: err.message };
    }
}

/**
 * Build → deliver → remember. Alerts are only marked as sent if delivery succeeded or no webhook
 * is configured (then they're just kept in alerts.json / the workbook), so failed deliveries retry.
 */
async function processAlerts({ alertStore, insights, complaints, log = () => {}, webhookUrl = process.env.COMPLAINT_MINER_WEBHOOK_URL, http }) {
    const alerts = buildAlerts({
        complaints,
        movers: insights.trends.movers,
        asOf: insights.asOf,
        isSent: (key) => alertStore.isSent(key),
    });
    const delivery = await deliverAlerts(alerts, { webhookUrl, http });
    if (alerts.length && (delivery.delivered || !webhookUrl)) {
        alertStore.record(alerts);
        alertStore.save();
    }
    if (alerts.length) {
        log(`alerts: ${alerts.length} new${webhookUrl ? (delivery.delivered ? " (sent to webhook)" : ` (webhook failed: ${delivery.error}; will retry)`) : " (no webhook set; saved to alerts.json)"}`);
    }
    return { alerts, delivery };
}

module.exports = { buildAlerts, deliverAlerts, processAlerts, summaryText };
