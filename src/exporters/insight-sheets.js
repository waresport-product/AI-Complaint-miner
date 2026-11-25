"use strict";

/**
 * Market-intelligence sheets added to complaint-miner.xlsx after the Complaints sheet.
 * Every header carries a hover note, like the Complaints sheet.
 */

function day(iso) {
    return iso ? String(iso).slice(0, 10) : "";
}

function names(list, max = 3) {
    return (list || []).slice(0, max).map((x) => `${x.competitorName || x.name} (${x.count})`).join(", ");
}

const TREND_NOTE = "Last 30 days vs. the average of the 60 days before: new = nothing before, rising = ≥1.5×, falling = ≤0.5×, steady = in between. Undated complaints are left out.";

const COMPETITOR_MAP_COLUMNS = Object.freeze([
    { key: "competitorName", header: "Competitor", width: 16, note: "Competing platform." },
    { key: "segment", header: "Segment", width: 13, note: "racquet = court/racquet booking, team_league = team & youth sports, facility = gym/studio/facility." },
    { key: "complaints", header: "Complaints", width: 11, note: "Verified complaints collected (within the age cutoff)." },
    { key: "hot", header: "Hot", width: 7, note: "Complaints with Lead Tier = Hot." },
    { key: "considering", header: "Considering Switch", width: 12, note: "Complaints from people actively looking for alternatives." },
    { key: "decisionMakers", header: "From Owners/Staff", width: 12, note: "Complaints written by club owners, admins or staff — the buyers." },
    { key: "avgSeverity", header: "Avg Severity", width: 10, note: "Average severity (1-5)." },
    { key: "topPains", header: "Top Pains", width: 50, wrap: true, note: "Most common pain categories and their share of this competitor's complaints." },
    { key: "recent", header: "Last 30 Days", width: 10, note: "Complaints posted in the last 30 days (before the latest collection date)." },
    { key: "priorAvg", header: "Prior Avg / 30d", width: 11, note: "Average per 30 days over the 60 days before that." },
    { key: "trend", header: "Trend", width: 9, note: TREND_NOTE },
    { key: "latestPost", header: "Latest Post", width: 11, note: "Most recent post date among this competitor's complaints." },
]);

const CLUSTER_COLUMNS = Object.freeze([
    { key: "label", header: "Issue", width: 42, wrap: true, note: "Issue theme. known = matched a named theme; emerging = a recurring phrase not yet named; other = everything else in that pain category." },
    { key: "kind", header: "Type", width: 9, note: "known / emerging / other." },
    { key: "count", header: "Complaints", width: 11, note: "Complaints in this cluster, across all competitors." },
    { key: "hot", header: "Hot", width: 7, note: "Hot complaints in this cluster." },
    { key: "considering", header: "Considering Switch", width: 12, note: "Complaints in this cluster from people looking for alternatives." },
    { key: "trend", header: "Trend", width: 9, note: TREND_NOTE },
    { key: "competitors", header: "Top Competitors", width: 40, wrap: true, note: "Competitors this issue shows up for most (with counts)." },
    { key: "exampleQuote", header: "Example Quote", width: 70, wrap: true, note: "Strongest word-for-word example from this cluster." },
    { key: "exampleUrl", header: "Example Source", width: 40, link: true, note: "Link to the example's source." },
]);

const PLAYBOOK_COLUMNS = Object.freeze([
    { key: "competitorName", header: "Competitor", width: 16, note: "Competing platform the playbook is for." },
    { key: "rank", header: "#", width: 4, note: "Pain rank for this competitor (1 = lead with this)." },
    { key: "painCategoryLabel", header: "Pain to Lead With", width: 24, note: "Pain ranked by evidence: Hot and switching complaints count extra." },
    { key: "count", header: "Complaints", width: 11, note: "Complaints about this pain for this competitor." },
    { key: "sharePct", header: "Share %", width: 8, note: "Share of this competitor's complaints." },
    { key: "trend", header: "Trend", width: 9, note: TREND_NOTE },
    { key: "opener", header: "Suggested Opener", width: 50, wrap: true, note: "Conversation starter built from the top pains. Shown on the first row of each competitor." },
    { key: "waresportAngle", header: "WareSport Angle", width: 50, wrap: true, note: "WareSport strength that answers this pain. Verify wording before using it with a prospect." },
    { key: "questions", header: "Discovery Questions", width: 60, wrap: true, note: "Questions that surface this pain on a call." },
    { key: "proofQuote", header: "Proof Quote", width: 70, wrap: true, note: "Real word-for-word complaint you can reference (anonymously)." },
    { key: "proofUrl", header: "Proof Source", width: 40, link: true, note: "Link to the proof quote's source." },
]);

const CONVERSATION_COLUMNS = Object.freeze([
    { key: "score", header: "Score", width: 7, note: "Ranking: strongest complaint's score + extra for more complaints and more people considering a switch." },
    { key: "sourceLabel", header: "Source", width: 20, note: "Where the conversation is." },
    { key: "competitors", header: "Competitor(s)", width: 18, note: "Competitors discussed." },
    { key: "complaintCount", header: "Complaints", width: 11, note: "Verified complaints found in this thread/page." },
    { key: "considering", header: "Considering Switch", width: 12, note: "People in this conversation looking for alternatives." },
    { key: "decisionMakers", header: "From Owners/Staff", width: 12, note: "Complaints written by club owners, admins or staff." },
    { key: "latestPost", header: "Latest Post", width: 11, note: "Most recent dated complaint in the conversation." },
    { key: "topQuote", header: "Best Quote", width: 70, wrap: true, note: "Strongest word-for-word complaint in the conversation." },
    { key: "url", header: "Link", width: 45, link: true, note: "Open the conversation." },
]);

const ALERT_COLUMNS = Object.freeze([
    { key: "createdOn", header: "Raised On", width: 11, note: "When the alert was raised (not when the complaint was posted)." },
    { key: "postedOn", header: "Posted On", width: 13, note: "When the complaint was posted. Date unknown = the source shows no date, so it is newly found but may be older. Blank for trends." },
    { key: "priority", header: "Priority", width: 9, note: "high = Hot complaint with a known recent date; medium = switching intent with a known date, Hot with no date, or rising trend; low = switching intent with no date." },
    { key: "type", header: "Type", width: 16, note: "hot_complaint / switching_intent / rising_trend." },
    { key: "title", header: "Alert", width: 40, wrap: true, note: "What happened." },
    { key: "message", header: "Details", width: 60, wrap: true, note: "Summary or trend numbers." },
    { key: "suggestedAction", header: "Suggested Action", width: 50, wrap: true, note: "What sales could do about it." },
    { key: "sourceUrl", header: "Source", width: 40, link: true, note: "Link to the complaint (blank for trends)." },
]);

const PRIORITY_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });

/** Newest first; within a day, highest priority first. */
function byDayThenPriority(a, b) {
    return day(b.createdAt).localeCompare(day(a.createdAt)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

function trendLabel(t) {
    return t ? t.status : "";
}

/**
 * @param {Function} addSheet  excel-exporter's addSheet(workbook, name, columns, rows)
 */
function addInsightSheets(workbook, addSheet, insights, alerts = []) {
    if (!insights) return;

    addSheet(workbook, "Competitor Map", COMPETITOR_MAP_COLUMNS, insights.competitorMap.map((c) => ({
        ...c,
        topPains: c.topPains.map((p) => `${p.painCategoryLabel} ${p.sharePct}%`).join("; "),
        recent: c.trend.recent,
        priorAvg: c.trend.priorAvg,
        trend: trendLabel(c.trend),
        latestPost: day(c.latestPost),
    })));

    addSheet(workbook, "Issue Clusters", CLUSTER_COLUMNS, insights.clusters.map((c) => ({
        ...c,
        trend: trendLabel(c.trend),
        competitors: names(c.competitors),
        exampleQuote: c.examples[0] ? c.examples[0].quote : null,
        exampleUrl: c.examples[0] ? c.examples[0].url : null,
    })));

    const playbookRows = [];
    for (const p of insights.playbooks) {
        p.topPains.forEach((pain, i) => {
            playbookRows.push({
                competitorName: p.competitorName,
                rank: i + 1,
                painCategoryLabel: pain.painCategoryLabel,
                count: pain.count,
                sharePct: pain.sharePct,
                trend: pain.trend,
                opener: i === 0 ? p.opener : null,
                waresportAngle: pain.waresportAngle,
                questions: pain.discoveryQuestions.map((q) => `• ${q}`).join("\n"),
                proofQuote: pain.proof[0] ? pain.proof[0].quote : null,
                proofUrl: pain.proof[0] ? pain.proof[0].url : null,
            });
        });
    }
    addSheet(workbook, "Playbooks", PLAYBOOK_COLUMNS, playbookRows);

    addSheet(workbook, "Hot Conversations", CONVERSATION_COLUMNS, insights.hotConversations.map((c) => ({
        ...c,
        latestPost: day(c.latestPost),
    })));

    addSheet(workbook, "Alerts", ALERT_COLUMNS, [...alerts].sort(byDayThenPriority).map((a) => ({
        ...a,
        createdOn: day(a.createdAt),
        postedOn: a.type === "rising_trend" ? "" : day(a.postedAt) || "Date unknown",
    })));
}

module.exports = {
    addInsightSheets,
    COMPETITOR_MAP_COLUMNS,
    CLUSTER_COLUMNS,
    PLAYBOOK_COLUMNS,
    CONVERSATION_COLUMNS,
    ALERT_COLUMNS,
};
