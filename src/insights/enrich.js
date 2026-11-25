"use strict";

/**
 * Adds the fields the insights layer filters on. Never guesses beyond what the source shows:
 *   sportTag  — from the AI's stated sport, else sport words in the quote/title/subreddit
 *   region    — from a stated location, else the App Store storefront country
 * Each value carries its provenance (*Source) so the UI can show how sure it is.
 */

const { COMPETITORS } = require("../constants");
const { SPORT_PATTERNS, NON_SPORTS, US_STATES, US_STATE_CODES, REGION_PATTERNS, STOREFRONT_REGIONS } = require("./config");

const COMPETITOR_BY_KEY = new Map(COMPETITORS.map((c) => [c.key, c]));
const SPORTS = Object.keys(SPORT_PATTERNS);

function matchSport(text) {
    if (!text) return null;
    return SPORTS.find((sport) => SPORT_PATTERNS[sport].some((re) => re.test(text))) || null;
}

/** @returns {{ sportTag: string|null, sportSource: "stated"|"inferred"|null }} */
function deriveSport(c) {
    const raw = c.sport ? String(c.sport).trim().toLowerCase() : "";
    const stated = matchSport(raw) || (raw && !NON_SPORTS.includes(raw) ? raw : null);
    if (stated) return { sportTag: stated, sportSource: "stated" };
    const inferred = matchSport([c.sourceLabel, c.title, c.quote, c.painSummary].filter(Boolean).join(" \n "));
    return inferred ? { sportTag: inferred, sportSource: "inferred" } : { sportTag: null, sportSource: null };
}

function regionFromLocation(location) {
    const text = String(location || "").trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    if (US_STATES.some((s) => new RegExp(`\\b${s}\\b`).test(lower))) return "US";
    const codes = text.match(/\b[A-Z]{2}\b/g) || [];
    if (codes.some((code) => US_STATE_CODES.includes(code))) return "US";
    return Object.keys(REGION_PATTERNS).find((region) => REGION_PATTERNS[region].some((re) => re.test(text))) || null;
}

/** @returns {{ region: string|null, regionSource: "stated"|"app_store_country"|null }} */
function deriveRegion(c) {
    const stated = regionFromLocation(c.location);
    if (stated) return { region: stated, regionSource: "stated" };
    const storefront = String(c.sourceLabel || "").match(/^App Store \(([A-Z]{2})\)$/);
    if (storefront) return { region: STOREFRONT_REGIONS[storefront[1]] || storefront[1], regionSource: "app_store_country" };
    return { region: null, regionSource: null };
}

function monthOf(iso) {
    return iso ? String(iso).slice(0, 7) : null;
}

function enrichComplaint(c) {
    const competitor = COMPETITOR_BY_KEY.get(c.competitorKey);
    return {
        ...c,
        segment: competitor ? competitor.segment : null,
        ...deriveSport(c),
        ...deriveRegion(c),
        postedMonth: monthOf(c.publishedAt),
    };
}

module.exports = { enrichComplaint, deriveSport, deriveRegion, regionFromLocation, matchSport };
