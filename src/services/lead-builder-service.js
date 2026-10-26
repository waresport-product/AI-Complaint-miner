"use strict";

/**
 * Lead builder — scores complaints and groups those that name a club/organization
 * into one lead per organization for the sales team.
 *
 * Score (0-23): severity x2 (2-10) + who is complaining (0-6) + switching intent (0-5)
 *               + recency (0-2) [+ repeat complaints on a lead].
 * Organization is deliberately not scored: it isn't verified against the source yet.
 * buildLeads() is not exported to the workbook until organizations are verified.
 */

const { WARESPORT_ANGLES, PAIN_CATEGORIES } = require("../constants");
const { normalizeOrgName } = require("../helpers/text.helper");

const AUTHOR_WEIGHT = Object.freeze({
    club_owner_admin: 6,
    club_staff: 4,
    coach: 3,
    parent: 2,
    player: 1,
    unknown: 0,
});

const SWITCHING_WEIGHT = Object.freeze({ considering: 5, switched_away: 2, none: 0 });

const TIERS = Object.freeze([
    { min: 16, label: "Hot" },
    { min: 10, label: "Warm" },
    { min: 0, label: "Cold" },
]);

function tierFor(score) {
    return TIERS.find((t) => score >= t.min).label;
}

function recencyPoints(publishedAt, now) {
    if (!publishedAt) return 0;
    const ageDays = (now - new Date(publishedAt).getTime()) / 86400000;
    if (!Number.isFinite(ageDays)) return 0;
    if (ageDays <= 90) return 2;
    if (ageDays <= 365) return 1;
    return 0;
}

function scoreComplaint(c, now = Date.now()) {
    const score =
        c.severity * 2 +
        (AUTHOR_WEIGHT[c.authorType] || 0) +
        (SWITCHING_WEIGHT[c.switchingIntent] || 0) +
        recencyPoints(c.publishedAt, now);
    return { ...c, leadScore: score, leadTier: tierFor(score) };
}

function uniq(values) {
    return [...new Set(values.filter(Boolean))];
}

function mostCommon(values) {
    const counts = new Map();
    values.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function buildLeads(scoredComplaints) {
    const groups = new Map();
    for (const c of scoredComplaints) {
        const key = normalizeOrgName(c.organization);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }

    const leads = [];
    for (const list of groups.values()) {
        const top = [...list].sort((a, b) => b.leadScore - a.leadScore)[0];
        const score = top.leadScore + Math.min(list.length - 1, 3) * 2;
        const dates = list.map((c) => c.foundAt).filter(Boolean).sort();
        leads.push({
            organization: mostCommon(list.map((c) => c.organization)),
            location: mostCommon(list.map((c) => c.location)),
            sport: mostCommon(list.map((c) => c.sport)),
            competitors: uniq(list.map((c) => c.competitorName)),
            complaintCount: list.length,
            painPoints: uniq(list.map((c) => PAIN_CATEGORIES[c.painCategory])),
            topQuote: top.quote,
            topQuoteUrl: top.url,
            topAuthorType: top.authorType,
            switchingIntent: list.some((c) => c.switchingIntent === "considering") ? "considering" : top.switchingIntent,
            sources: uniq(list.map((c) => c.sourceLabel)),
            leadScore: score,
            leadTier: tierFor(score),
            waresportAngle: WARESPORT_ANGLES[top.painCategory],
            firstSeen: dates[0] || null,
            lastSeen: dates[dates.length - 1] || null,
        });
    }
    return leads.sort((a, b) => b.leadScore - a.leadScore);
}

module.exports = { scoreComplaint, buildLeads, tierFor, AUTHOR_WEIGHT, SWITCHING_WEIGHT };
