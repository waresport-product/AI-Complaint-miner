"use strict";

/**
 * Filters shared by the API, the insights builder and the CLI. All filters are optional;
 * list values may be arrays or comma-separated strings. Matching is case-insensitive.
 *
 *   competitor  competitor key(s)         e.g. "teamsnap,mindbody"
 *   segment     racquet | team_league | facility
 *   sport       sportTag(s)               e.g. "pickleball"
 *   region      region(s)                 e.g. "US,Canada"
 *   source      reddit | web | appstore
 *   tier        Hot | Warm | Cold
 *   intent      considering | switched_away | none
 *   pain        painCategory key(s)
 *   since       ISO date; complaints posted (or, if undated, found) on/after it
 */

function toList(value) {
    if (value === undefined || value === null || value === "") return null;
    const list = (Array.isArray(value) ? value : String(value).split(","))
        .map((v) => String(v).trim().toLowerCase())
        .filter(Boolean);
    return list.length ? list : null;
}

function matches(list, value) {
    return !list || list.includes(String(value ?? "").toLowerCase());
}

function normalizeFilters(raw = {}) {
    const since = raw.since ? new Date(raw.since) : null;
    return {
        competitor: toList(raw.competitor),
        segment: toList(raw.segment),
        sport: toList(raw.sport),
        region: toList(raw.region),
        source: toList(raw.source),
        tier: toList(raw.tier),
        intent: toList(raw.intent),
        pain: toList(raw.pain),
        since: since && !Number.isNaN(since.getTime()) ? since : null,
    };
}

function applyFilters(complaints, raw) {
    const f = normalizeFilters(raw);
    return complaints.filter((c) =>
        matches(f.competitor, c.competitorKey) &&
        matches(f.segment, c.segment) &&
        matches(f.sport, c.sportTag) &&
        matches(f.region, c.region) &&
        matches(f.source, c.source) &&
        matches(f.tier, c.leadTier) &&
        matches(f.intent, c.switchingIntent) &&
        matches(f.pain, c.painCategory) &&
        (!f.since || new Date(c.publishedAt || c.foundAt) >= f.since)
    );
}

/** Distinct values available for each filter, for building dropdowns in a UI. */
function filterOptions(complaints) {
    const distinct = (key) => [...new Set(complaints.map((c) => c[key]).filter(Boolean))].sort();
    return {
        competitor: distinct("competitorKey"),
        segment: distinct("segment"),
        sport: distinct("sportTag"),
        region: distinct("region"),
        source: distinct("source"),
        tier: ["Hot", "Warm", "Cold"],
        intent: ["considering", "switched_away", "none"],
        pain: distinct("painCategory"),
    };
}

module.exports = { applyFilters, normalizeFilters, filterOptions };
