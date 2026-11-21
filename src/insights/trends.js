"use strict";

/**
 * Trend detection on complaint post dates (undated complaints are left out).
 *
 * recent   = complaints posted in the last `windowDays` before `asOf`
 * priorAvg = average per window over the `priorWindows` windows before that
 * status   = new      (nothing before, ≥ minRecent now)
 *            rising   (≥ minRecent now and ≥ risingRatio × priorAvg)
 *            falling  (priorAvg ≥ minRecent and recent ≤ fallingRatio × priorAvg)
 *            steady   otherwise
 *
 * `asOf` defaults to the latest collection date, so a pause in collection doesn't read as a
 * drop in complaints.
 */

const { TRENDS } = require("./config");

const DAY_MS = 86400000;

function trendStatus(recent, priorAvg, cfg = TRENDS) {
    if (recent >= cfg.minRecent && priorAvg === 0) return "new";
    if (recent >= cfg.minRecent && recent >= cfg.risingRatio * priorAvg) return "rising";
    if (priorAvg >= cfg.minRecent && recent <= cfg.fallingRatio * priorAvg) return "falling";
    return "steady";
}

function windowCounts(complaints, asOfMs, cfg = TRENDS) {
    const windowMs = cfg.windowDays * DAY_MS;
    let recent = 0;
    let prior = 0;
    for (const c of complaints) {
        if (!c.publishedAt) continue;
        const age = asOfMs - new Date(c.publishedAt).getTime();
        if (age < 0) continue;
        if (age <= windowMs) recent++;
        else if (age <= windowMs * (1 + cfg.priorWindows)) prior++;
    }
    const priorAvg = Math.round((prior / cfg.priorWindows) * 10) / 10;
    return {
        recent,
        priorAvg,
        changePct: priorAvg > 0 ? Math.round(((recent - priorAvg) / priorAvg) * 100) : null,
        status: trendStatus(recent, priorAvg, cfg),
    };
}

/** Last N calendar months ending with asOf's month: [{ month: "2026-10", count }]. */
function monthlySeries(complaints, asOfMs, months = TRENDS.seriesMonths) {
    const end = new Date(asOfMs);
    const keys = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
        keys.push(d.toISOString().slice(0, 7));
    }
    const counts = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const c of complaints) {
        const m = c.publishedAt ? String(c.publishedAt).slice(0, 7) : null;
        if (m && m in counts) counts[m]++;
    }
    return keys.map((month) => ({ month, count: counts[month] }));
}

function defaultAsOf(complaints) {
    const latest = complaints.reduce((max, c) => (c.foundAt && c.foundAt > max ? c.foundAt : max), "");
    return latest ? new Date(latest).getTime() : Date.now();
}

function groupBy(list, keyFn) {
    const map = new Map();
    for (const item of list) {
        const key = keyFn(item);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    }
    return map;
}

/**
 * @returns {{ asOf: string, windowDays: number, competitors: object[], movers: object[], categories: object[] }}
 */
function buildTrends(complaints, { asOf } = {}) {
    const asOfMs = asOf ? new Date(asOf).getTime() : defaultAsOf(complaints);

    const competitors = [...groupBy(complaints, (c) => c.competitorKey).entries()].map(([key, list]) => ({
        competitorKey: key,
        competitorName: list[0].competitorName,
        ...windowCounts(list, asOfMs),
        series: monthlySeries(list, asOfMs),
    }));

    const categories = [...groupBy(complaints, (c) => c.painCategory).entries()].map(([key, list]) => ({
        painCategory: key,
        painCategoryLabel: list[0].painCategoryLabel,
        ...windowCounts(list, asOfMs),
    }));

    // Competitor × pain combinations that are heating up — the "what's new this month" list.
    const movers = [...groupBy(complaints, (c) => `${c.competitorKey}|${c.painCategory}`).values()]
        .map((list) => ({
            competitorKey: list[0].competitorKey,
            competitorName: list[0].competitorName,
            painCategory: list[0].painCategory,
            painCategoryLabel: list[0].painCategoryLabel,
            ...windowCounts(list, asOfMs),
        }))
        .filter((m) => m.status === "rising" || m.status === "new")
        .sort((a, b) => b.recent - a.recent || (b.changePct ?? 999) - (a.changePct ?? 999));

    return {
        asOf: new Date(asOfMs).toISOString(),
        windowDays: TRENDS.windowDays,
        competitors: competitors.sort((a, b) => b.recent - a.recent),
        categories: categories.sort((a, b) => b.recent - a.recent),
        movers,
    };
}

module.exports = { buildTrends, trendStatus, windowCounts, monthlySeries, defaultAsOf };
