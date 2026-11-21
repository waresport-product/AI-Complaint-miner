"use strict";

/**
 * Read-only JSON API over the collected complaints + market insights, for the WareSport website
 * (or any dashboard) to consume. Node's built-in http module — no extra dependencies.
 *
 *   GET /health
 *   GET /api/filters                    distinct values for filter dropdowns
 *   GET /api/insights                   everything below in one payload
 *   GET /api/competitors                competitor map
 *   GET /api/competitors/:key           one competitor: map entry + playbook + its issue clusters
 *   GET /api/trends
 *   GET /api/clusters
 *   GET /api/accounts                   verified hot accounts + hot conversations
 *   GET /api/playbooks                  all playbooks
 *   GET /api/playbooks/:key             one competitor's playbook
 *   GET /api/complaints?limit=&offset=  paged complaints, best first
 *   GET /api/alerts?limit=              recent alerts
 *
 * Every insights route accepts the filters in ../insights/filters.js as query parameters,
 * e.g. /api/insights?competitor=teamsnap&sport=soccer&region=US&since=2026-01-01
 *
 * Security: GET only; optional bearer token (COMPLAINT_MINER_API_TOKEN); CORS only for the
 * configured origin; unverified organization names are never returned.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { FileStore } = require("../stores/file-store");
const { AlertStore } = require("../stores/alert-store");
const { buildInsights, prepare, applyFilters, filterOptions } = require("../insights");

const MAX_PAGE = 200;

function publicComplaint(c) {
    const { organization, organizationEvidence, organizationVerified, ...rest } = c;
    return organizationVerified ? { ...rest, organization, organizationEvidence, organizationVerified } : rest;
}

function tokenMatches(expected, header) {
    const given = String(header || "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Reloads complaints only when complaints.json changes. */
function createDataSource(outputDir) {
    const file = path.join(outputDir, "complaints.json");
    let cache = { mtimeMs: -1, complaints: [] };
    return {
        complaints() {
            let mtimeMs = 0;
            try {
                mtimeMs = fs.statSync(file).mtimeMs;
            } catch (_) {
                return [];
            }
            if (mtimeMs !== cache.mtimeMs) {
                cache = { mtimeMs, complaints: prepare(new FileStore(outputDir).load().allComplaints()) };
            }
            return cache.complaints;
        },
        alerts(limit) {
            return new AlertStore(outputDir).load().recent(limit);
        },
    };
}

/**
 * @param {object} options
 * @param {string} options.outputDir
 * @param {string} [options.token]       require "Authorization: Bearer <token>"
 * @param {string} [options.corsOrigin]  e.g. "https://admin.waresport.com"
 * @param {object} [options.dataSource]  for tests: { complaints(), alerts(limit) }
 */
function createApiServer({ outputDir, token, corsOrigin, dataSource } = {}) {
    const data = dataSource || createDataSource(outputDir);

    const send = (res, status, body) => {
        const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
        if (corsOrigin) {
            headers["Access-Control-Allow-Origin"] = corsOrigin;
            headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
            headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
            headers.Vary = "Origin";
        }
        res.writeHead(status, headers);
        res.end(body === undefined ? "" : JSON.stringify(body));
    };

    const routes = [
        [/^\/health$/, () => {
            const all = data.complaints();
            const last = all.reduce((m, c) => (c.foundAt > m ? c.foundAt : m), "");
            return { ok: true, complaints: all.length, lastCollected: last || null };
        }],
        [/^\/api\/filters$/, () => filterOptions(data.complaints())],
        [/^\/api\/insights$/, (q) => buildInsights(data.complaints(), { filters: q })],
        [/^\/api\/competitors$/, (q) => buildInsights(data.complaints(), { filters: q }).competitorMap],
        [/^\/api\/competitors\/([a-z0-9_-]+)$/, (q, [key]) => {
            const insights = buildInsights(data.complaints(), { filters: { ...q, competitor: key } });
            const entry = insights.competitorMap[0];
            if (!entry) return null;
            return {
                competitor: entry,
                playbook: insights.playbooks[0] || null,
                clusters: insights.clusters,
                trends: insights.trends.movers,
                hotConversations: insights.hotConversations,
            };
        }],
        [/^\/api\/trends$/, (q) => buildInsights(data.complaints(), { filters: q }).trends],
        [/^\/api\/clusters$/, (q) => buildInsights(data.complaints(), { filters: q }).clusters],
        [/^\/api\/accounts$/, (q) => {
            const insights = buildInsights(data.complaints(), { filters: q });
            return { hotAccounts: insights.hotAccounts, hotConversations: insights.hotConversations };
        }],
        [/^\/api\/playbooks$/, (q) => buildInsights(data.complaints(), { filters: q }).playbooks],
        [/^\/api\/playbooks\/([a-z0-9_-]+)$/, (q, [key]) =>
            buildInsights(data.complaints(), { filters: { ...q, competitor: key } }).playbooks[0] || null],
        [/^\/api\/complaints$/, (q) => {
            const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), MAX_PAGE);
            const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
            const matched = applyFilters(data.complaints(), q).sort((a, b) => b.leadScore - a.leadScore);
            return { total: matched.length, limit, offset, items: matched.slice(offset, offset + limit).map(publicComplaint) };
        }],
        [/^\/api\/alerts$/, (q) => {
            const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), MAX_PAGE);
            return { items: data.alerts(limit) };
        }],
    ];

    return http.createServer((req, res) => {
        if (req.method === "OPTIONS" && corsOrigin) return send(res, 204);
        if (req.method !== "GET") return send(res, 405, { error: "Method not allowed. This API is read-only." });

        const url = new URL(req.url, "http://localhost");
        if (url.pathname !== "/health" && token && !tokenMatches(token, req.headers.authorization)) {
            return send(res, 401, { error: "Missing or invalid bearer token." });
        }

        for (const [pattern, handler] of routes) {
            const match = url.pathname.match(pattern);
            if (!match) continue;
            try {
                const body = handler(Object.fromEntries(url.searchParams), match.slice(1));
                return body === null ? send(res, 404, { error: "Not found." }) : send(res, 200, body);
            } catch (err) {
                return send(res, 500, { error: "Internal error.", detail: err.message });
            }
        }
        return send(res, 404, { error: "Unknown route. See GET /health and docs/INTEGRATION.md." });
    });
}

module.exports = { createApiServer, publicComplaint };
