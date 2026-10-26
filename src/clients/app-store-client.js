"use strict";

/**
 * Apple's public iTunes Search API + customer-review RSS feed. No key required.
 * The feed exposes up to 10 pages x 50 most recent reviews per app per country.
 */

const axios = require("axios");

const TIMEOUT_MS = 30000;

async function findApps(term, country = "us") {
    const res = await axios.get("https://itunes.apple.com/search", {
        params: { term, entity: "software", country, limit: 10 },
        timeout: TIMEOUT_MS,
    });
    return (res.data?.results || []).map((r) => ({
        appId: String(r.trackId),
        name: r.trackName || "",
        seller: r.sellerName || "",
        url: r.trackViewUrl || "",
        rating: r.averageUserRating ?? null,
        ratingCount: r.userRatingCount ?? null,
    }));
}

async function fetchReviews(appId, { country = "us", page = 1 } = {}) {
    const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`;
    const res = await axios.get(url, { timeout: TIMEOUT_MS });
    const entries = res.data?.feed?.entry || [];
    // A single-entry feed comes back as an object, not an array.
    const list = Array.isArray(entries) ? entries : [entries];
    return list
        .filter((e) => e && e["im:rating"])
        .map((e) => ({
            id: e.id?.label || "",
            rating: Number(e["im:rating"]?.label) || null,
            title: e.title?.label || "",
            text: e.content?.label || "",
            updatedAt: e.updated?.label || null,
            version: e["im:version"]?.label || null,
        }));
}

module.exports = { findApps, fetchReviews };
