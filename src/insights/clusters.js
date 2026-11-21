"use strict";

/**
 * Groups complaints into issue clusters that cut across competitors.
 *
 *   known     a theme from config.THEMES matched the pain summary or quote ("Refunds refused…")
 *   emerging  no known theme, but a 2-word phrase recurs within the same pain category —
 *             a candidate for a new entry in THEMES
 *   other     everything else, per pain category
 *
 * Deterministic and free (no LLM call), so clusters are stable from run to run.
 */

const { COMPETITORS } = require("../constants");
const { CLUSTERS, THEMES } = require("./config");
const { windowCounts, defaultAsOf } = require("./trends");

const STOPWORDS = new Set([
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "have", "had",
    "not", "but", "can", "cannot", "too", "very", "into", "onto", "than", "then", "when", "while",
    "after", "before", "about", "over", "under", "their", "they", "them", "its", "our", "your",
    "you", "his", "her", "who", "what", "which", "will", "would", "could", "should", "does", "did",
    "been", "being", "via", "per", "also", "just", "only", "more", "most", "much", "many", "some",
    "any", "all", "each", "other", "lack", "lacks", "lacking", "poor", "bad", "issue", "issues",
    "problem", "problems", "difficult", "hard", "unable", "user", "users", "app", "apps",
    "software", "platform", "system", "product", "service", "tool", "feature", "features",
    "frequent", "frequently", "often", "constant", "constantly", "multiple", "experience", "make",
    "makes", "making", "get", "gets", "use", "using", "used", "need", "needs", "due", "leading",
    "leads", "despite", "without", "out", "every", "new", "time", "feel", "feels", "overly",
]);

const COMPETITOR_TOKENS = new Set(
    COMPETITORS.flatMap((c) => [c.name, ...c.aliases]).flatMap((a) => a.toLowerCase().split(/\s+/))
);

function stem(token) {
    if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
    if (token.length > 3 && token.endsWith("s") && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
    return token;
}

function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
        .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !COMPETITOR_TOKENS.has(t) && !/^\d+$/.test(t))
        .map(stem);
}

/** Adjacent-word pairs, as a set (document frequency, not term frequency). */
function bigramsOf(text) {
    const tokens = tokenize(text);
    const pairs = new Set();
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i] !== tokens[i + 1]) pairs.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return pairs;
}

function matchTheme(c, themes = THEMES) {
    const text = `${c.painSummary || ""}\n${c.quote || ""}`;
    return themes.find((t) => t.patterns.some((re) => re.test(text))) || null;
}

function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function summarize({ id, kind, label, members, asOfMs, cfg }) {
    const tally = (keyFn, nameFn) => {
        const map = new Map();
        for (const c of members) {
            const key = keyFn(c);
            const entry = map.get(key) || { key, name: nameFn(c), count: 0 };
            entry.count++;
            map.set(key, entry);
        }
        return [...map.values()].sort((a, b) => b.count - a.count);
    };

    return {
        id,
        kind,
        label,
        count: members.length,
        hot: members.filter((c) => c.leadTier === "Hot").length,
        considering: members.filter((c) => c.switchingIntent === "considering").length,
        competitors: tally((c) => c.competitorKey, (c) => c.competitorName)
            .map(({ key, name, count }) => ({ competitorKey: key, competitorName: name, count })),
        painCategories: tally((c) => c.painCategory, (c) => c.painCategoryLabel)
            .map(({ key, name, count }) => ({ painCategory: key, painCategoryLabel: name, count })),
        trend: windowCounts(members, asOfMs),
        examples: [...members]
            .sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0))
            .slice(0, cfg.examplesPerCluster)
            .map((c) => ({
                quote: c.quote,
                competitorName: c.competitorName,
                sourceLabel: c.sourceLabel,
                url: c.url,
                publishedAt: c.publishedAt || null,
                leadTier: c.leadTier,
            })),
    };
}

/** Recurring phrases among complaints no known theme matched, per pain category. */
function emergingGroups(leftovers, cfg) {
    const byCategory = new Map();
    for (const c of leftovers) {
        if (!byCategory.has(c.painCategory)) byCategory.set(c.painCategory, []);
        byCategory.get(c.painCategory).push(c);
    }

    const groups = [];
    for (const [category, list] of byCategory) {
        const docs = list.map((c) => ({ c, phrases: bigramsOf(c.painSummary || c.quote) }));
        const df = new Map();
        for (const d of docs) for (const p of d.phrases) df.set(p, (df.get(p) || 0) + 1);
        const phrases = [...df.entries()]
            .filter(([, n]) => n >= cfg.minEmergingSize)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, cfg.maxEmergingPerCategory)
            .map(([p]) => p);

        const buckets = new Map([...phrases, null].map((p) => [p, []]));
        for (const d of docs) buckets.get(phrases.find((p) => d.phrases.has(p)) || null).push(d.c);
        for (const [phrase, members] of buckets) {
            if (members.length) groups.push({ category, label: list[0].painCategoryLabel, phrase, members });
        }
    }
    return groups;
}

/** @returns {object[]} clusters: known themes first by size, then emerging, then other */
function buildClusters(complaints, { asOf, cfg = CLUSTERS, themes = THEMES } = {}) {
    const asOfMs = asOf ? new Date(asOf).getTime() : defaultAsOf(complaints);
    const byTheme = new Map();
    const leftovers = [];
    for (const c of complaints) {
        const theme = matchTheme(c, themes);
        if (!theme) {
            leftovers.push(c);
            continue;
        }
        if (!byTheme.has(theme.key)) byTheme.set(theme.key, { theme, members: [] });
        byTheme.get(theme.key).members.push(c);
    }

    const known = [...byTheme.values()].map(({ theme, members }) =>
        summarize({ id: theme.key, kind: "known", label: theme.label, members, asOfMs, cfg }));

    const rest = emergingGroups(leftovers, cfg).map(({ category, label, phrase, members }) =>
        phrase
            ? summarize({ id: `emerging:${category}:${slug(phrase)}`, kind: "emerging", label: `${label}: "${phrase}"`, members, asOfMs, cfg })
            : summarize({ id: `other:${category}`, kind: "other", label: `Other ${label.toLowerCase()} issues`, members, asOfMs, cfg }));

    const order = { known: 0, emerging: 1, other: 2 };
    return [...known, ...rest].sort((a, b) => order[a.kind] - order[b.kind] || b.count - a.count || b.hot - a.hot);
}

module.exports = { buildClusters, matchTheme, tokenize, bigramsOf };
