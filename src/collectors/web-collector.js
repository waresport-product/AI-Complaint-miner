"use strict";

/**
 * Web collector agent — Firecrawl search + scrape across review sites (Capterra, G2,
 * Software Advice, GetApp, Trustpilot), public Facebook pages/groups and forums.
 * Reddit links found here are handed off to the Reddit collector (Firecrawl can't read them).
 */

const Firecrawl = require("../clients/firecrawl-client");
const {
    DEFAULTS,
    SOURCES,
    COMPETITORS,
    WEB_QUERY_TEMPLATES,
    WEB_EXCLUDED_DOMAINS,
} = require("../constants");
const {
    findMentionedCompetitors,
    shortHash,
    hostnameOf,
    domainMatches,
} = require("../helpers/text.helper");
const { mapWithConcurrency } = require("../helpers/async.helper");

const REPROCESS_AFTER_DAYS = 14;

const SOURCE_LABELS = Object.freeze({
    "capterra.com": "Capterra",
    "g2.com": "G2",
    "softwareadvice.com": "Software Advice",
    "getapp.com": "GetApp",
    "trustpilot.com": "Trustpilot",
    "facebook.com": "Facebook",
    "play.google.com": "Google Play",
});

function sourceLabelFor(url) {
    const host = hostnameOf(url);
    const match = Object.keys(SOURCE_LABELS).find((d) => host === d || host.endsWith(`.${d}`));
    return match ? SOURCE_LABELS[match] : host;
}

/** @returns {Array<{ query: string, label: string, recent: boolean }>} */
function buildQueries(competitor) {
    const name = `"${competitor.aliases[0]}"`;
    const exclude = competitor.domains.map((d) => `-site:${d}`).join(" ");
    return WEB_QUERY_TEMPLATES.map((t) => ({
        ...t,
        query: t.query.replace("{name}", name).replace("{exclude}", exclude).trim(),
    }));
}

const ALL_COMPETITOR_DOMAINS = COMPETITORS.flatMap((c) => c.domains);

// Review-site "X vs Y" pages repeat reviews already on the product's review page.
const COMPARISON_PATH = /\/(vs|compare|comparison|alternatives)\/|-vs-/i;

// Firecrawl refuses these (403), so don't spend a scrape attempt on them.
const UNSCRAPABLE_DOMAINS = Object.freeze(["facebook.com", "instagram.com", "fb.com", "tiktok.com", "x.com", "twitter.com"]);

/** "reddit" | "skip" | "page" */
function classifyUrl(url) {
    const host = hostnameOf(url);
    if (!host) return "skip";
    if (host === "reddit.com" || host.endsWith(".reddit.com") || host === "redd.it") return "reddit";
    if (domainMatches(url, UNSCRAPABLE_DOMAINS)) return "skip";
    if (domainMatches(url, WEB_EXCLUDED_DOMAINS) || domainMatches(url, ALL_COMPETITOR_DOMAINS)) return "skip";
    if (COMPARISON_PATH.test(new URL(url).pathname)) return "skip";
    return "page";
}

class WebCollector {
    constructor({ store, log, limits = {} }) {
        this.store = store;
        this.log = log;
        this.limits = { ...DEFAULTS, ...limits };
        this.stats = { searches: 0, scrapes: 0, documents: 0, skippedProcessed: 0, redditHandoffs: 0 };
        this.errors = [];
    }

    isAvailable() {
        return Firecrawl.isConfigured();
    }

    async searchCompetitor(competitor) {
        const pages = [];
        const reddit = [];
        for (const { query, recent } of buildQueries(competitor)) {
            try {
                this.stats.searches++;
                const results = await Firecrawl.search(query, {
                    limit: this.limits.webSearchLimit,
                    tbs: recent ? this.limits.webRecentTbs : undefined,
                });
                for (const r of results) {
                    const kind = classifyUrl(r.url);
                    if (kind === "reddit") reddit.push(r.url);
                    if (kind === "page") pages.push({ ...r, competitorKey: competitor.key });
                }
            } catch (err) {
                this.errors.push({ source: SOURCES.web, context: `search ${query}`, message: err.message });
                this.log(`web: search failed for ${competitor.name}: ${err.message}`);
            }
        }
        return { pages, reddit };
    }

    async collect(competitors) {
        const searched = await mapWithConcurrency(competitors, 2, (c) => this.searchCompetitor(c));

        const seen = new Set();
        const toScrape = [];
        const redditUrls = [];
        settledValues(searched).forEach(({ pages, reddit }) => {
            redditUrls.push(...reddit);
            let taken = 0;
            for (const page of pages) {
                if (taken >= this.limits.webScrapesPerCompetitor) break;
                if (seen.has(page.url)) continue;
                seen.add(page.url);
                if (this.store.hasProcessed(shortHash(SOURCES.web, page.url), REPROCESS_AFTER_DAYS)) {
                    this.stats.skippedProcessed++;
                    continue;
                }
                toScrape.push(page);
                taken++;
            }
        });
        this.stats.redditHandoffs = redditUrls.length;
        this.log(`web: scraping ${toScrape.length} page(s); ${redditUrls.length} Reddit link(s) handed off`);

        const scraped = await mapWithConcurrency(toScrape, 2, async (page) => {
            try {
                this.stats.scrapes++;
                const result = await Firecrawl.scrape(page.url);
                const text = (result.markdown || "").slice(0, this.limits.maxDocCharsTotal);
                const mentioned = findMentionedCompetitors(text, competitors);
                if (!mentioned.length) return null;
                return {
                    id: shortHash(SOURCES.web, page.url),
                    source: SOURCES.web,
                    sourceLabel: sourceLabelFor(page.url),
                    url: page.url,
                    title: result.title || page.title,
                    text,
                    publishedAt: result.publishedAt || null,
                    competitorKeys: mentioned,
                };
            } catch (err) {
                this.errors.push({ source: SOURCES.web, context: `scrape ${page.url}`, message: err.message });
                return null;
            }
        });

        const documents = settledValues(scraped).filter(Boolean);
        this.stats.documents = documents.length;
        return { documents, redditUrls };
    }
}

function settledValues(settled) {
    return settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
}

module.exports = { WebCollector, buildQueries, classifyUrl, sourceLabelFor };
