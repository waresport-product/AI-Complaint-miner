"use strict";

/**
 * App Store collector agent — low-star iOS reviews of competitor apps (Apple's public feed).
 * Reviews are batched into one document per app so the analyzer makes fewer LLM calls;
 * each review is kept as a segment so a quote can be traced back to its review.
 */

const AppStore = require("../clients/app-store-client");
const { DEFAULTS, SOURCES, getMaxReviewAgeDays } = require("../constants");
const { shortHash, normalizeForMatch, isOlderThan } = require("../helpers/text.helper");

function pickApp(apps, competitor) {
    const terms = competitor.appStore.match.map(normalizeForMatch);
    return (
        apps.find((app) => {
            const haystack = normalizeForMatch(`${app.name} ${app.seller}`);
            return terms.some((t) => haystack.includes(t));
        }) || null
    );
}

function formatReview(review) {
    const date = review.updatedAt ? review.updatedAt.slice(0, 10) : "unknown date";
    return `### Review (${review.rating} stars, ${date})\n${review.title}\n${review.text}`;
}

class AppStoreCollector {
    constructor({ store, log, limits = {} }) {
        this.store = store;
        this.log = log;
        this.limits = { ...DEFAULTS, ...limits };
        this.stats = { apps: 0, reviewsFetched: 0, lowStarReviews: 0, documents: 0, skippedProcessed: 0, skippedOld: 0 };
        this.errors = [];
        this.warnings = [];
    }

    isAvailable() {
        return true;
    }

    async collectCompetitor(competitor) {
        const docs = [];
        let app = null;

        for (const country of this.limits.appStoreCountries) {
            try {
                if (!app) {
                    app = pickApp(await AppStore.findApps(competitor.appStore.term, country), competitor);
                    if (!app) {
                        this.log(`appstore: no iOS app matched for ${competitor.name}`);
                        return docs;
                    }
                    this.stats.apps++;
                }

                const reviews = [];
                for (let page = 1; page <= this.limits.appStorePages; page++) {
                    const batch = await AppStore.fetchReviews(app.appId, { country, page });
                    this.stats.reviewsFetched += batch.length;
                    reviews.push(...batch);
                    if (batch.length < 50) break;
                }
                // Apple sometimes serves an empty feed when throttling; don't mistake it for "no complaints".
                if (!reviews.length && app.ratingCount > 0) {
                    const warning = `App Store feed for ${competitor.name} (${country}) came back empty although the app has ${app.ratingCount} ratings — Apple may be throttling; re-run later.`;
                    this.warnings.push(warning);
                    this.log(`appstore: ${warning}`);
                }

                const maxAgeDays = getMaxReviewAgeDays();
                const fresh = reviews.filter((r) => {
                    if (!r.rating || r.rating > this.limits.appStoreMaxRating) return false;
                    this.stats.lowStarReviews++;
                    if (isOlderThan(r.updatedAt, maxAgeDays)) {
                        this.stats.skippedOld++;
                        return false;
                    }
                    if (this.store.hasProcessed(shortHash(SOURCES.appstore, r.id))) {
                        this.stats.skippedProcessed++;
                        return false;
                    }
                    return true;
                });

                for (let i = 0; i < fresh.length; i += this.limits.appStoreReviewsPerDoc) {
                    const group = fresh.slice(i, i + this.limits.appStoreReviewsPerDoc);
                    docs.push({
                        id: shortHash(SOURCES.appstore, app.appId, country, group.map((r) => r.id).join(",")),
                        source: SOURCES.appstore,
                        sourceLabel: `App Store (${country.toUpperCase()})`,
                        url: app.url,
                        title: `${app.name} — iOS reviews`,
                        text: group.map(formatReview).join("\n\n"),
                        publishedAt: null,
                        competitorKeys: [competitor.key],
                        competitorHint: competitor.name,
                        processKeys: group.map((r) => shortHash(SOURCES.appstore, r.id)),
                        segments: group.map((r) => ({
                            text: `${r.title}\n${r.text}`,
                            url: app.url,
                            publishedAt: r.updatedAt,
                            rating: r.rating,
                        })),
                    });
                }
            } catch (err) {
                this.errors.push({ source: SOURCES.appstore, context: `${competitor.name} ${country}`, message: err.message });
                this.log(`appstore: ${competitor.name} (${country}) failed: ${err.message}`);
            }
        }
        return docs;
    }

    async collect(competitors) {
        const documents = [];
        for (const competitor of competitors.filter((c) => c.appStore)) {
            documents.push(...(await this.collectCompetitor(competitor)));
        }
        this.stats.documents = documents.length;
        this.log(`appstore: ${this.stats.lowStarReviews} low-star review(s), ${documents.length} batch(es) to analyze`);
        return documents;
    }
}

module.exports = { AppStoreCollector, pickApp };
