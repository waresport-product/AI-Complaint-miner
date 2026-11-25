"use strict";

/**
 * Ranks where sales should look first.
 *
 *   hotAccounts       clubs/organizations whose name was verified against the source text
 *                     (organizationVerified). Unverified names are never shown as accounts.
 *   hotConversations  individual threads/review pages with the most high-intent complaints —
 *                     useful while verified accounts are still few.
 */

const { buildLeads } = require("../services/lead-builder-service");

function hotAccounts(scored, limit = 50) {
    const verified = scored.filter((c) => c.organization && c.organizationVerified === true);
    return buildLeads(verified).slice(0, limit);
}

function hotConversations(scored, limit = 50) {
    const byUrl = new Map();
    // App Store reviews all share the app's URL, so they aren't a "conversation".
    for (const c of scored.filter((x) => x.url && x.source !== "appstore")) {
        if (!byUrl.has(c.url)) byUrl.set(c.url, []);
        byUrl.get(c.url).push(c);
    }

    const conversations = [...byUrl.entries()].map(([url, list]) => {
        const top = [...list].sort((a, b) => b.leadScore - a.leadScore)[0];
        const considering = list.filter((c) => c.switchingIntent === "considering").length;
        const decisionMakers = list.filter((c) => c.authorType === "club_owner_admin" || c.authorType === "club_staff").length;
        const latest = list.map((c) => c.publishedAt).filter(Boolean).sort().pop() || null;
        return {
            url,
            title: top.title || null,
            sourceLabel: top.sourceLabel,
            competitors: [...new Set(list.map((c) => c.competitorName))],
            complaintCount: list.length,
            hot: list.filter((c) => c.leadTier === "Hot").length,
            considering,
            decisionMakers,
            topQuote: top.quote,
            topAuthorType: top.authorType,
            latestPost: latest,
            score: top.leadScore + Math.min(list.length - 1, 3) * 2 + Math.min(considering, 3) * 2,
        };
    });

    return conversations
        .filter((c) => c.hot > 0 || c.considering > 0)
        .sort((a, b) => b.score - a.score || b.complaintCount - a.complaintCount)
        .slice(0, limit);
}

module.exports = { hotAccounts, hotConversations };
