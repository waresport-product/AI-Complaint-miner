"use strict";

/**
 * Auto-generated sales playbook per competitor, built only from collected evidence:
 * top pains (with real quotes and links), the matching WareSport angle, discovery questions,
 * and a suggested opener. Deterministic: no LLM call, nothing invented.
 *
 * WareSport angles come from constants.WARESPORT_ANGLES — keep them accurate to the product.
 */

const { COMPETITORS, WARESPORT_ANGLES, PAIN_CATEGORIES } = require("../constants");
const { PLAYBOOKS, DISCOVERY_QUESTIONS } = require("./config");
const { windowCounts, defaultAsOf } = require("./trends");

const COMPETITOR_BY_KEY = new Map(COMPETITORS.map((c) => [c.key, c]));

function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
}

function lowerFirst(text) {
    return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function buildPlaybook(competitorKey, list, asOfMs, cfg) {
    const competitor = COMPETITOR_BY_KEY.get(competitorKey);
    const byPain = new Map();
    for (const c of list) {
        if (c.painCategory === "other") continue;
        if (!byPain.has(c.painCategory)) byPain.set(c.painCategory, []);
        byPain.get(c.painCategory).push(c);
    }

    // Rank pains by weighted evidence: hot and switching complaints count extra.
    const weight = (c) => 1 + (c.leadTier === "Hot" ? 2 : 0) + (c.switchingIntent === "considering" ? 2 : 0);
    const topPains = [...byPain.entries()]
        .map(([category, items]) => ({ category, items, weight: items.reduce((s, c) => s + weight(c), 0) }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, cfg.topPains)
        .map(({ category, items }) => ({
            painCategory: category,
            painCategoryLabel: PAIN_CATEGORIES[category],
            count: items.length,
            sharePct: pct(items.length, list.length),
            hot: items.filter((c) => c.leadTier === "Hot").length,
            trend: windowCounts(items, asOfMs).status,
            proof: [...items]
                .sort((a, b) => b.leadScore - a.leadScore)
                .slice(0, cfg.quotesPerPain)
                .map((c) => ({
                    quote: c.quote,
                    authorType: c.authorType,
                    sourceLabel: c.sourceLabel,
                    url: c.url,
                    publishedAt: c.publishedAt || null,
                })),
            waresportAngle: WARESPORT_ANGLES[category],
            discoveryQuestions: DISCOVERY_QUESTIONS[category] || DISCOVERY_QUESTIONS.other,
        }));

    const considering = list.filter((c) => c.switchingIntent === "considering").length;
    const decisionMakers = list.filter((c) => ["club_owner_admin", "club_staff"].includes(c.authorType)).length;
    const lead = topPains[0];
    const second = topPains[1];

    return {
        competitorKey,
        competitorName: competitor ? competitor.name : list[0].competitorName,
        segment: competitor ? competitor.segment : null,
        complaintCount: list.length,
        hot: list.filter((c) => c.leadTier === "Hot").length,
        consideringPct: pct(considering, list.length),
        decisionMakerPct: pct(decisionMakers, list.length),
        trend: windowCounts(list, asOfMs),
        topPains,
        opener: lead
            ? `Clubs using ${competitor ? competitor.name : list[0].competitorName} often tell us about ` +
              `${lowerFirst(lead.painCategoryLabel)}${second ? ` and ${lowerFirst(second.painCategoryLabel)}` : ""}` +
              ` — is that something your team runs into?`
            : null,
        note: "Built from public complaints. Verify WareSport claims before using them with a prospect.",
    };
}

/** @returns {object[]} one playbook per competitor with enough evidence, most complaints first */
function buildPlaybooks(complaints, { asOf, cfg = PLAYBOOKS } = {}) {
    const asOfMs = asOf ? new Date(asOf).getTime() : defaultAsOf(complaints);
    const byCompetitor = new Map();
    for (const c of complaints) {
        if (!byCompetitor.has(c.competitorKey)) byCompetitor.set(c.competitorKey, []);
        byCompetitor.get(c.competitorKey).push(c);
    }
    return [...byCompetitor.entries()]
        .filter(([, list]) => list.length >= cfg.minComplaints)
        .map(([key, list]) => buildPlaybook(key, list, asOfMs, cfg))
        .sort((a, b) => b.complaintCount - a.complaintCount);
}

module.exports = { buildPlaybooks };
