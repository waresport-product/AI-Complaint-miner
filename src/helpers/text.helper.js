"use strict";

const crypto = require("crypto");

/** Fold curly quotes/dashes/whitespace so LLM quotes can be matched against source text. */
function normalizeForMatch(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/[‘’‚‛′]/g, "'")
        .replace(/[“”„‟″]/g, "\"")
        .replace(/[–—−]/g, "-")
        .replace(/…/g, "...")
        .replace(/[*_`>#]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive alias regex; "Court Reserve" also matches "Court-Reserve". */
function aliasRegex(alias) {
    const parts = String(alias).trim().split(/\s+/).map(escapeRegex);
    return new RegExp(`(^|[^a-z0-9])${parts.join("[\\s\\-_]*")}([^a-z0-9]|$)`, "i");
}

/** Keys of competitors whose aliases appear in the text. */
function findMentionedCompetitors(text, competitors) {
    const haystack = String(text || "");
    return competitors
        .filter((c) => c.aliases.some((alias) => aliasRegex(alias).test(haystack)))
        .map((c) => c.key);
}

/**
 * True when the quote appears verbatim (after normalization) in the source.
 * Guards against the LLM paraphrasing or inventing complaints.
 */
function isVerbatimQuote(quote, sourceText) {
    const q = normalizeForMatch(quote);
    if (q.length < 12) return false;
    return normalizeForMatch(sourceText).includes(q);
}

/** Split long text on paragraph boundaries into chunks of at most maxChars. */
function chunkText(text, maxChars) {
    const value = String(text || "");
    if (value.length <= maxChars) return value ? [value] : [];

    const chunks = [];
    let current = "";
    for (const para of value.split(/\n{2,}/)) {
        if (para.length > maxChars) {
            if (current) {
                chunks.push(current);
                current = "";
            }
            for (let i = 0; i < para.length; i += maxChars) {
                chunks.push(para.slice(i, i + maxChars));
            }
            continue;
        }
        if (current.length + para.length + 2 > maxChars) {
            chunks.push(current);
            current = para;
        } else {
            current = current ? `${current}\n\n${para}` : para;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function shortHash(...parts) {
    return crypto
        .createHash("sha1")
        .update(parts.map((p) => String(p ?? "")).join("|"))
        .digest("hex")
        .slice(0, 16);
}

function hostnameOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch (_) {
        return "";
    }
}

function domainMatches(url, domains) {
    const host = hostnameOf(url);
    if (!host) return false;
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Canonical key for grouping leads: "The Pickleball Club, LLC" -> "pickleball club". */
function normalizeOrgName(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\b(the|llc|inc|ltd|co|corp|club inc)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Parse a post/review date the LLM read off the page ("2025-03-14", "2025-03", "2025") or an
 * ISO timestamp. Partial dates resolve to the start of the period. Future dates are rejected.
 * @returns {string|null} ISO string
 */
function parsePostedDate(value, now = Date.now()) {
    const v = String(value ?? "").trim();
    if (!v) return null;
    const partial = v.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    const date = partial
        ? new Date(Date.UTC(Number(partial[1]), Number(partial[2] || 1) - 1, Number(partial[3] || 1)))
        : new Date(v);
    const time = date.getTime();
    if (Number.isNaN(time) || date.getUTCFullYear() < 2000 || time > now + 86400000) return null;
    return date.toISOString();
}

function isOlderThan(iso, days, now = Date.now()) {
    if (!iso || !days) return false;
    const time = new Date(iso).getTime();
    return Number.isFinite(time) && now - time > days * 86400000;
}

module.exports = {
    parsePostedDate,
    isOlderThan,
    normalizeForMatch,
    aliasRegex,
    findMentionedCompetitors,
    isVerbatimQuote,
    chunkText,
    shortHash,
    hostnameOf,
    domainMatches,
    normalizeOrgName,
};
