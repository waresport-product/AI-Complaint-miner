"use strict";

/**
 * Analyst agent — turns a collected document into structured, verified complaints.
 *
 * The LLM proposes complaints; this service then enforces the contract:
 *   - the quote must appear verbatim in the source (no paraphrase / hallucination)
 *   - the competitor must be one we track
 *   - enums are coerced to known values
 *   - vendor marketing pages (competitor "alternatives" blogs etc.) are discarded
 *   - complaints older than the max review age are dropped
 *   - cons from 4-5 star reviews are capped at low severity
 */

const LlmClient = require("../clients/llm-client");
const {
    DEFAULTS,
    PAIN_CATEGORIES,
    WARESPORT_ANGLES,
    AUTHOR_TYPES,
    SWITCHING_INTENT,
    getMaxReviewAgeDays,
} = require("../constants");
const {
    chunkText,
    isVerbatimQuote,
    normalizeForMatch,
    shortHash,
    parsePostedDate,
    isOlderThan,
} = require("../helpers/text.helper");

const USER_CONTENT_TYPES = Object.freeze(["user_content", "mixed"]);

function buildSystemPrompt(competitors) {
    return [
        "You extract genuine customer complaints about sports club management software from scraped web content.",
        `Track only these products: ${competitors.map((c) => `${c.name} (also written: ${c.aliases.join(", ")})`).join("; ")}.`,
        "",
        "Rules:",
        "1. Only first-hand negative experiences, frustrations or unmet needs from users of the product (club owners, staff, coaches, players, parents). Ignore praise, neutral mentions, questions with no complaint, and jokes.",
        "2. Ignore marketing/comparison content written by software vendors (e.g. \"X alternatives\" articles, vendor blogs, press releases). Set documentType to \"vendor_marketing\" for such pages and return no complaints.",
        "3. \"quote\" MUST be copied EXACTLY, character for character, from the text: 1-3 consecutive sentences that state the pain most specifically. Never paraphrase, merge separate sentences, fix typos or add words.",
        "4. One entry per distinct pain point. Do not return the same quote twice.",
        "5. \"organization\": the club/facility/league/organization the author belongs to or describes as using the product — ONLY if the text names it explicitly. Otherwise null. Never guess.",
        "6. \"location\": city/state/country only if stated. \"sport\": e.g. pickleball, tennis, padel, soccer — only if stated or obvious.",
        `7. "painCategory" is one of: ${Object.keys(PAIN_CATEGORIES).join(", ")}.`,
        `8. "authorType" is one of: ${AUTHOR_TYPES.join(", ")}.`,
        `9. "switchingIntent" is one of: ${SWITCHING_INTENT.join(", ")} (considering = evaluating/asking for alternatives; switched_away = already left).`,
        "10. \"severity\": 1 = minor annoyance, 3 = recurring problem hurting operations, 5 = losing money/members or leaving the product.",
        "11. \"painSummary\": max 15 words, neutral, describing the problem.",
        "12. \"postedDate\": the date THIS specific review/post/comment was written, as shown on the page (e.g. \"Reviewed May 2019\" -> \"2019-05\", \"March 3, 2025\" -> \"2025-03-03\"). Format YYYY-MM-DD, YYYY-MM or YYYY. null if the page does not show it — never guess or use today's date.",
        "13. \"reviewRating\": the star rating (1-5) the author gave in THIS review, if the page shows one. null for forum posts or when not shown. Remember a 5-star review can still list cons.",
        "",
        "Respond with JSON only:",
        "{\"documentType\": \"user_content\" | \"mixed\" | \"vendor_marketing\" | \"news\" | \"other\", \"complaints\": [{\"competitor\": string, \"quote\": string, \"painSummary\": string, \"painCategory\": string, \"severity\": number, \"switchingIntent\": string, \"authorType\": string, \"organization\": string|null, \"location\": string|null, \"sport\": string|null, \"postedDate\": string|null, \"reviewRating\": number|null}]}",
    ].join("\n");
}

function resolveCompetitor(value, competitors) {
    const needle = normalizeForMatch(value).replace(/[^a-z0-9]/g, "");
    if (!needle) return null;
    return (
        competitors.find((c) =>
            [c.key, c.name, ...c.aliases].some((alias) => normalizeForMatch(alias).replace(/[^a-z0-9]/g, "") === needle)
        ) || null
    );
}

function pickEnum(value, allowed, fallback) {
    const v = String(value || "").trim().toLowerCase();
    return allowed.includes(v) ? v : fallback;
}

function cleanText(value, max) {
    const v = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!v || /^(null|none|n\/a|unknown)$/i.test(v)) return null;
    return v.slice(0, max);
}

function clampSeverity(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 2;
    return Math.min(5, Math.max(1, n));
}

function parseRating(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

// Cons listed in a 4-5 star review are wishes from a happy customer, not a buying signal.
const POSITIVE_REVIEW_RATING = 4;
const POSITIVE_REVIEW_MAX_SEVERITY = 2;

/** For batched documents (app reviews), find the segment the quote came from. */
function locateSegment(quote, segments) {
    if (!Array.isArray(segments)) return null;
    return segments.find((s) => isVerbatimQuote(quote, s.text)) || null;
}

/**
 * Validate and normalize raw LLM complaints for one chunk.
 * @returns {{ complaints: object[], rejected: number, tooOld: number }}
 */
function validateComplaints(rawList, { doc, chunk, competitors, foundAt, maxAgeDays = getMaxReviewAgeDays() }) {
    const complaints = [];
    let rejected = 0;
    let tooOld = 0;
    const seenQuotes = new Set();

    for (const raw of Array.isArray(rawList) ? rawList : []) {
        const competitor =
            resolveCompetitor(raw?.competitor, competitors) ||
            (doc.competitorHint ? resolveCompetitor(doc.competitorHint, competitors) : null);
        const quote = String(raw?.quote || "").trim();
        const quoteKey = normalizeForMatch(quote);

        if (!competitor || !isVerbatimQuote(quote, chunk) || seenQuotes.has(quoteKey)) {
            rejected++;
            continue;
        }
        seenQuotes.add(quoteKey);

        const painCategory = pickEnum(raw.painCategory, Object.keys(PAIN_CATEGORIES), "other");
        const segment = locateSegment(quote, doc.segments);
        // Collector-provided dates (App Store, Reddit post) beat dates the LLM read off the page.
        const publishedAt = segment?.publishedAt || parsePostedDate(raw.postedDate) || doc.publishedAt || null;
        if (isOlderThan(publishedAt, maxAgeDays)) {
            tooOld++;
            continue;
        }
        const reviewRating = segment?.rating ?? parseRating(raw.reviewRating);
        let severity = clampSeverity(raw.severity);
        if (reviewRating >= POSITIVE_REVIEW_RATING) severity = Math.min(severity, POSITIVE_REVIEW_MAX_SEVERITY);

        complaints.push({
            // Same quote about the same product = same complaint, even if syndicated on two sites.
            id: shortHash(competitor.key, quoteKey),
            competitorKey: competitor.key,
            competitorName: competitor.name,
            quote,
            painSummary: cleanText(raw.painSummary, 160),
            painCategory,
            painCategoryLabel: PAIN_CATEGORIES[painCategory],
            severity,
            reviewRating,
            switchingIntent: pickEnum(raw.switchingIntent, SWITCHING_INTENT, "none"),
            authorType: pickEnum(raw.authorType, AUTHOR_TYPES, "unknown"),
            organization: cleanText(raw.organization, 120),
            location: cleanText(raw.location, 120),
            sport: cleanText(raw.sport, 60),
            source: doc.source,
            sourceLabel: doc.sourceLabel,
            url: segment?.url || doc.url,
            title: doc.title || null,
            publishedAt,
            foundAt,
            waresportAngle: WARESPORT_ANGLES[painCategory],
        });
    }
    return { complaints, rejected, tooOld };
}

/**
 * @param {object} doc - collected document
 * @param {object[]} competitors - competitor configs in scope
 * @returns {Promise<{ complaints: object[], documentType: string, rejected: number, tokens: number }>}
 */
async function analyzeDocument(doc, competitors) {
    const system = buildSystemPrompt(competitors);
    const maxChunks = Math.max(1, Math.floor(DEFAULTS.maxDocCharsTotal / DEFAULTS.llmMaxCharsPerChunk));
    const chunks = chunkText(doc.text, DEFAULTS.llmMaxCharsPerChunk).slice(0, maxChunks);
    const foundAt = new Date().toISOString();

    const result = { complaints: [], documentType: "other", rejected: 0, tooOld: 0, tokens: 0 };
    for (const chunk of chunks) {
        const { json, tokens } = await LlmClient.completeJson({
            system,
            user: JSON.stringify({
                source: doc.sourceLabel,
                url: doc.url,
                title: doc.title,
                productHint: doc.competitorHint || null,
                text: chunk,
            }),
        });
        result.tokens += tokens;

        const documentType = String(json?.documentType || "other");
        if (result.documentType === "other" || USER_CONTENT_TYPES.includes(documentType)) {
            result.documentType = documentType;
        }
        if (!USER_CONTENT_TYPES.includes(documentType)) continue;

        const { complaints, rejected, tooOld } = validateComplaints(json?.complaints, { doc, chunk, competitors, foundAt });
        result.complaints.push(...complaints);
        result.rejected += rejected;
        result.tooOld += tooOld;
    }
    return result;
}

module.exports = {
    analyzeDocument,
    validateComplaints,
    resolveCompetitor,
    buildSystemPrompt,
};
