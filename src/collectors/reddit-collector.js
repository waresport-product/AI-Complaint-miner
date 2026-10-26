"use strict";

/**
 * Reddit collector agent — Agent Reach (logged-in browser) search + read.
 *
 * Reddit blocks Firecrawl/WebFetch/curl, so this is the only working path today.
 * Search is noisy ("Court Reserve" also matches "Supreme Court ... Federal Reserve"),
 * so posts must mention a competitor alias in title/body before we spend a read on them.
 */

const AgentReach = require("../clients/agent-reach-client");
const { DEFAULTS, SOURCES, getMaxReviewAgeDays } = require("../constants");
const { findMentionedCompetitors, shortHash, isOlderThan } = require("../helpers/text.helper");
const { sleep, mapWithConcurrency } = require("../helpers/async.helper");

const REPROCESS_AFTER_DAYS = 30;
const RETRYABLE_CODES = Object.freeze(["TIMEOUT", "UPSTREAM_BROKEN"]);

function normalizeRedditUrl(url) {
    try {
        const u = new URL(url);
        u.hostname = "www.reddit.com";
        u.search = "";
        u.hash = "";
        return u.toString().replace(/\/?$/, "/");
    } catch (_) {
        return url;
    }
}

function buildQueries(competitor, limit) {
    const primary = competitor.aliases[0];
    const queries = [`"${primary}"`];
    for (const term of competitor.contextTerms || []) {
        queries.push(`${primary} ${term}`);
    }
    if (competitor.aliases[1]) queries.push(`"${competitor.aliases[1]}"`);
    return queries.slice(0, limit);
}

function toIso(value) {
    if (!value) return null;
    const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

class RedditCollector {
    constructor({ store, log, limits = {} }) {
        this.store = store;
        this.log = log;
        this.limits = { ...DEFAULTS, ...limits };
        this.stopped = null;
        this.stats = { searches: 0, candidates: 0, reads: 0, retries: 0, documents: 0, skippedProcessed: 0, skippedOld: 0 };
        this.errors = [];
        this.seenUrls = new Set();
    }

    async isAvailable() {
        return AgentReach.isAvailable();
    }

    handleError(err, context) {
        const code = err.code || "ERROR";
        this.errors.push({ source: SOURCES.reddit, context, code, message: err.message });
        if (err.stopChannel) {
            // Agent Reach rule: stop on login/block/rate-limit instead of hammering the site.
            this.stopped = { code, hint: err.hint || null };
            this.log(`reddit: stopping channel (${code})${err.hint ? ` — ${err.hint}` : ""}`);
        } else {
            this.log(`reddit: ${context} failed (${code}): ${err.message}`);
        }
    }

    /** Search each competitor and return candidate posts worth reading. */
    async searchCandidates(competitors) {
        const candidates = new Map();
        let first = true;

        for (const competitor of competitors) {
            for (const query of buildQueries(competitor, this.limits.redditQueriesPerCompetitor)) {
                if (this.stopped) return [...candidates.values()];
                if (!first) await sleep(this.limits.agentReachSearchSpacingMs);
                first = false;

                let items = [];
                try {
                    this.stats.searches++;
                    items = await AgentReach.redditSearch(query, { limit: this.limits.redditSearchLimit });
                } catch (err) {
                    this.handleError(err, `search ${query}`);
                    continue;
                }

                for (const item of items) {
                    const raw = item.raw || {};
                    const url = normalizeRedditUrl(item.url || raw.url || "");
                    if (!url || candidates.has(url)) continue;
                    const text = `${item.title || raw.title || ""}\n${raw.selftext || item.text || ""}`;
                    if (!findMentionedCompetitors(text, [competitor]).length) continue;
                    candidates.set(url, {
                        url,
                        competitorKey: competitor.key,
                        title: item.title || raw.title || "",
                        subreddit: raw.subreddit || "",
                        publishedAt: toIso(raw.created_utc || item.published_at),
                        commentCount: Number(raw.comments) || 0,
                    });
                }
            }
        }
        this.stats.candidates = candidates.size;
        return [...candidates.values()];
    }

    /** Pick the most-discussed recent, unprocessed posts per competitor. */
    selectForReading(candidates) {
        const maxAgeDays = getMaxReviewAgeDays();
        const byCompetitor = new Map();
        for (const c of candidates) {
            if (isOlderThan(c.publishedAt, maxAgeDays)) {
                this.stats.skippedOld++;
                continue;
            }
            const docId = shortHash(SOURCES.reddit, c.url);
            if (this.store.hasProcessed(docId, REPROCESS_AFTER_DAYS)) {
                this.stats.skippedProcessed++;
                continue;
            }
            if (!byCompetitor.has(c.competitorKey)) byCompetitor.set(c.competitorKey, []);
            byCompetitor.get(c.competitorKey).push(c);
        }
        const selected = [];
        for (const list of byCompetitor.values()) {
            list.sort((a, b) => b.commentCount - a.commentCount);
            selected.push(...list.slice(0, this.limits.redditReadsPerCompetitor));
        }
        return selected;
    }

    /** Transient failures (timeouts, dropped fetches) get one retry after a longer pause. */
    async readWithRetry(url) {
        try {
            return await AgentReach.redditRead(url);
        } catch (err) {
            if (err.stopChannel || !RETRYABLE_CODES.includes(err.code)) throw err;
            this.stats.retries++;
            await sleep(this.limits.agentReachRetryWaitMs);
            return AgentReach.redditRead(url);
        }
    }

    async readPosts(posts, competitors) {
        const fresh = posts.filter((p) => !this.seenUrls.has(p.url));
        fresh.forEach((p) => this.seenUrls.add(p.url));

        // One read at a time with a pause: parallel reads made Reddit stall ("Failed to fetch") late in long runs.
        let first = true;
        const settled = await mapWithConcurrency(fresh, 1, async (post) => {
            if (this.stopped) return null;
            if (!first) await sleep(this.limits.agentReachReadSpacingMs);
            first = false;
            try {
                this.stats.reads++;
                const item = await this.readWithRetry(post.url);
                const text = item?.text || "";
                const mentioned = findMentionedCompetitors(text, competitors);
                if (!text || !mentioned.length) return null;
                const titleLine = text.match(/^Title:\s*(.+)$/m);
                return {
                    id: shortHash(SOURCES.reddit, post.url),
                    source: SOURCES.reddit,
                    sourceLabel: post.subreddit ? `Reddit ${post.subreddit}` : "Reddit",
                    url: post.url,
                    title: post.title || (titleLine ? titleLine[1] : ""),
                    text,
                    publishedAt: post.publishedAt || null,
                    competitorKeys: mentioned,
                };
            } catch (err) {
                this.handleError(err, `read ${post.url}`);
                return null;
            }
        });

        const docs = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
        this.stats.documents += docs.length;
        return docs;
    }

    async collect(competitors) {
        const candidates = await this.searchCandidates(competitors);
        const selected = this.selectForReading(candidates);
        this.log(`reddit: ${candidates.length} relevant post(s) found, reading ${selected.length}`);
        return this.readPosts(selected, competitors);
    }

    /** Read Reddit URLs discovered by other collectors (e.g. Firecrawl web search). */
    async collectUrls(urls, competitors) {
        const posts = [...new Set(urls.map(normalizeRedditUrl))]
            .filter((url) => !this.store.hasProcessed(shortHash(SOURCES.reddit, url), REPROCESS_AFTER_DAYS))
            .map((url) => ({ url, title: "", subreddit: "", publishedAt: null }));
        if (!posts.length) return [];
        this.log(`reddit: reading ${posts.length} post(s) handed off from web search`);
        return this.readPosts(posts, competitors);
    }
}

module.exports = { RedditCollector, normalizeRedditUrl, buildQueries };
