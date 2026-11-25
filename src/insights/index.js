"use strict";

/**
 * Market-intelligence layer: turns stored complaints into the competitor map, trends, issue
 * clusters, ranked accounts/conversations and sales playbooks. Pure functions — no network,
 * no LLM — so the API, the CLI and a website backend can all call buildInsights() directly.
 */

const { scoreComplaint } = require("../services/lead-builder-service");
const { INSIGHTS_SCHEMA_VERSION } = require("./config");
const { enrichComplaint } = require("./enrich");
const { applyFilters, normalizeFilters, filterOptions } = require("./filters");
const { buildTrends, windowCounts, monthlySeries, defaultAsOf } = require("./trends");
const { buildClusters } = require("./clusters");
const { hotAccounts, hotConversations } = require("./accounts");
const { buildPlaybooks } = require("./playbooks");

function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
}

/** Score (if needed) and enrich every complaint. */
function prepare(complaints, now = Date.now()) {
    return complaints.map((c) => enrichComplaint(c.leadScore === undefined ? scoreComplaint(c, now) : c));
}

function countBy(list, keyFn) {
    const counts = {};
    for (const item of list) {
        const key = keyFn(item);
        if (key) counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

function competitorMap(complaints, asOfMs) {
    const groups = new Map();
    for (const c of complaints) {
        if (!groups.has(c.competitorKey)) groups.set(c.competitorKey, []);
        groups.get(c.competitorKey).push(c);
    }
    return [...groups.entries()]
        .map(([key, list]) => {
            const painCounts = countBy(list, (c) => c.painCategory);
            return {
                competitorKey: key,
                competitorName: list[0].competitorName,
                segment: list[0].segment,
                complaints: list.length,
                hot: list.filter((c) => c.leadTier === "Hot").length,
                warm: list.filter((c) => c.leadTier === "Warm").length,
                considering: list.filter((c) => c.switchingIntent === "considering").length,
                decisionMakers: list.filter((c) => ["club_owner_admin", "club_staff"].includes(c.authorType)).length,
                avgSeverity: Math.round((list.reduce((s, c) => s + (c.severity || 0), 0) / list.length) * 10) / 10,
                topPains: Object.entries(painCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([category, count]) => ({
                        painCategory: category,
                        painCategoryLabel: list.find((c) => c.painCategory === category).painCategoryLabel,
                        count,
                        sharePct: pct(count, list.length),
                    })),
                sources: countBy(list, (c) => c.source),
                sports: countBy(list, (c) => c.sportTag),
                regions: countBy(list, (c) => c.region),
                latestPost: list.map((c) => c.publishedAt).filter(Boolean).sort().pop() || null,
                trend: windowCounts(list, asOfMs),
                series: monthlySeries(list, asOfMs),
            };
        })
        .sort((a, b) => b.hot - a.hot || b.complaints - a.complaints);
}

/**
 * @param {object[]} complaints  raw complaints from the store (or already prepared)
 * @param {object}   [options]
 * @param {object}   [options.filters]  see ./filters.js
 * @param {string}   [options.asOf]     reference date for trends (default: latest collection date)
 * @param {number}   [options.limit]    max accounts/conversations returned (default 50)
 */
function buildInsights(complaints, { filters = {}, asOf, limit = 50 } = {}) {
    const all = prepare(complaints);
    const asOfMs = asOf ? new Date(asOf).getTime() : defaultAsOf(all);
    const scoped = applyFilters(all, filters);

    return {
        schemaVersion: INSIGHTS_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        asOf: new Date(asOfMs).toISOString(),
        filters: normalizeFilters(filters),
        filterOptions: filterOptions(all),
        totals: {
            complaints: scoped.length,
            hot: scoped.filter((c) => c.leadTier === "Hot").length,
            considering: scoped.filter((c) => c.switchingIntent === "considering").length,
            competitors: new Set(scoped.map((c) => c.competitorKey)).size,
            datedPct: pct(scoped.filter((c) => c.publishedAt).length, scoped.length),
            sportKnownPct: pct(scoped.filter((c) => c.sportTag).length, scoped.length),
            regionKnownPct: pct(scoped.filter((c) => c.region).length, scoped.length),
            verifiedAccounts: new Set(scoped.filter((c) => c.organizationVerified).map((c) => c.organization)).size,
        },
        competitorMap: competitorMap(scoped, asOfMs),
        trends: buildTrends(scoped, { asOf: asOfMs }),
        clusters: buildClusters(scoped, { asOf: asOfMs }),
        hotAccounts: hotAccounts(scoped, limit),
        hotConversations: hotConversations(scoped, limit),
        playbooks: buildPlaybooks(scoped, { asOf: asOfMs }),
    };
}

module.exports = { buildInsights, prepare, competitorMap, applyFilters, filterOptions };
