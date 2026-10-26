"use strict";

/**
 * Firecrawl REST client (search + scrape). Works anywhere with network access,
 * including servers and containers. Requires FIRECRAWL_API_KEY.
 */

const axios = require("axios");
const { sleep } = require("../helpers/async.helper");

const BASE_URL = process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev/v2";
const TIMEOUT_MS = 60000;
// The plan's per-minute limit is easy to hit during a full run: back off and retry instead of losing pages.
const MAX_ATTEMPTS = 4;
const BACKOFF_SECONDS = [15, 30, 60];

function getApiKey() {
    return process.env.FIRECRAWL_API_KEY || "";
}

function isConfigured() {
    return Boolean(getApiKey());
}

async function post(path, body, attempt = 1) {
    try {
        const res = await axios.post(`${BASE_URL}${path}`, body, {
            headers: {
                Authorization: `Bearer ${getApiKey()}`,
                "Content-Type": "application/json",
            },
            timeout: TIMEOUT_MS,
        });
        return res.data;
    } catch (err) {
        const status = err.response?.status;
        if (attempt < MAX_ATTEMPTS && (status === 429 || (status >= 500 && status < 600))) {
            const retryAfter = Number(err.response?.headers?.["retry-after"]);
            const waitSeconds = retryAfter > 0 ? retryAfter : BACKOFF_SECONDS[attempt - 1];
            await sleep(Math.min(waitSeconds, 90) * 1000);
            return post(path, body, attempt + 1);
        }
        const detail = err.response?.data?.error || err.message;
        const wrapped = new Error(`Firecrawl ${path} failed (${status || "network"}): ${detail}`);
        wrapped.status = status;
        throw wrapped;
    }
}

/**
 * @param {string} [options.tbs] Google time filter, e.g. "qdr:y" = past year
 * @returns {Promise<Array<{ url: string, title: string, description: string }>>}
 */
async function search(query, { limit = 8, tbs } = {}) {
    const data = await post("/search", { query, limit, sources: ["web"], ...(tbs ? { tbs } : {}) });
    // v2 returns { data: { web: [...] } }; v1 returned { data: [...] }.
    const list = Array.isArray(data?.data) ? data.data : data?.data?.web || [];
    return list
        .filter((r) => r && r.url)
        .map((r) => ({ url: r.url, title: r.title || "", description: r.description || "" }));
}

/** @returns {Promise<{ markdown: string, title: string, publishedAt: string|null }>} */
async function scrape(url) {
    const data = await post("/scrape", {
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
    });
    const doc = data?.data || {};
    const meta = doc.metadata || {};
    return {
        markdown: doc.markdown || "",
        title: meta.title || meta.ogTitle || "",
        publishedAt: meta.publishedTime || meta["article:published_time"] || null,
    };
}

module.exports = { isConfigured, search, scrape };
