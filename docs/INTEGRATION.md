# Integrating the AI Complaint Miner into the WareSport website

This guide is for the WareSport dev team. It explains how to show the miner's market
intelligence (competitor map, trends, issue clusters, playbooks, alerts) inside the WareSport
website or admin, **without merging the miner's code into the WareSport backend**. The miner
stays a separate service that the website reads from.

---

## 1. Integration options

| Option | How | Best for |
|---|---|---|
| **A. Insights API** *(recommended)* | Run the miner and its API (`npm run api`) on an always-on machine. The WareSport backend calls the API server-to-server and the admin UI renders it | Live data, filters, no code coupling |
| **B. Read `insights.json`** | After each run the miner writes `output/complaint-miner/insights.json`. Copy it to S3 (or similar) and have the website read it | Simplest, no extra service; one fixed dataset (no per-request filters) |
| **C. Import the module** | `require("<miner>/src/insights").buildInsights(complaints, { filters })`. Pure functions, no network | Building your own API layer around the data |

Collection (Reddit via Agent Reach) needs a real browser profile, so **the collector can't run in
AWS Lambda**. Run collection on a VM or always-on machine. The API itself is a small Node HTTP
server and can run anywhere.

---

## 2. Running the API

```bash
npm install
npm run api          # http://127.0.0.1:8787  (try /health and /api/insights)
```

| Env variable | Default | Purpose |
|---|---|---|
| `COMPLAINT_MINER_API_PORT` | `8787` | Port |
| `COMPLAINT_MINER_API_HOST` | `127.0.0.1` | Listen address. `0.0.0.0` exposes it beyond the machine |
| `COMPLAINT_MINER_API_TOKEN` | *(none)* | If set, every route except `/health` needs `Authorization: Bearer <token>`. **Required whenever the API is exposed** |
| `COMPLAINT_MINER_API_CORS_ORIGIN` | *(none)* | Allow browser calls from one origin, e.g. `https://admin.waresport.com`. Prefer server-to-server calls instead |
| `COMPLAINT_MINER_OUTPUT_DIR` | `output/complaint-miner` | Where the miner's data lives |

**Security:** the API is GET-only, compares tokens in constant time, sends `no-store` and
`nosniff` headers, and never returns club names that weren't verified against the source. The
data is third-party public content, so keep it internal (admin or sales area), not on public
marketing pages, unless legal has reviewed the use.

---

## 3. Endpoints

All `/api/*` routes accept these **filters** as query parameters (all optional, comma-separated
lists allowed, case-insensitive):

| Param | Values | Example |
|---|---|---|
| `competitor` | competitor keys (`npm run mine -- --list`) | `teamsnap,mindbody` |
| `segment` | `racquet`, `team_league`, `facility` | `team_league` |
| `sport` | sport tags, see `/api/filters` | `soccer` |
| `region` | `US`, `Canada`, `UK`, `Spain`, … | `US` |
| `source` | `reddit`, `web`, `appstore` | `reddit` |
| `tier` | `Hot`, `Warm`, `Cold` | `hot,warm` |
| `intent` | `considering`, `switched_away`, `none` | `considering` |
| `pain` | pain category keys | `pricing_fees` |
| `since` | ISO date, by post date | `2026-06-01` |

| Endpoint | Returns |
|---|---|
| `GET /health` | `{ ok, complaints, lastCollected }` (no token needed) |
| `GET /api/filters` | Distinct values for each filter, for dropdowns |
| `GET /api/insights` | The full payload (section 4) |
| `GET /api/competitors` | `competitorMap` |
| `GET /api/competitors/:key` | `{ competitor, playbook, clusters, trends, hotConversations }` for one competitor |
| `GET /api/trends` | `{ asOf, windowDays, competitors[], categories[], movers[] }` |
| `GET /api/clusters` | Issue clusters |
| `GET /api/accounts` | `{ hotAccounts, hotConversations }` |
| `GET /api/playbooks`, `/api/playbooks/:key` | Playbooks |
| `GET /api/complaints?limit=50&offset=0` | `{ total, limit, offset, items[] }`, best first, max 200 per page |
| `GET /api/alerts?limit=50` | `{ items[] }`, most recent alerts |

Errors are JSON: `401` (token), `404` (unknown route or competitor), `405` (non-GET), `500`.

---

## 4. Insights payload (`schemaVersion: 1`)

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-21T05:04:52.000Z",
  "asOf": "2026-10-26T20:10:59.817Z",      // trends are relative to the latest collection
  "filters": { "competitor": null, "sport": ["soccer"], ... },
  "filterOptions": { "competitor": [...], "sport": [...], "region": [...], ... },
  "totals": { "complaints": 809, "hot": 78, "considering": 74, "competitors": 20,
              "datedPct": 82, "sportKnownPct": 22, "regionKnownPct": 43, "verifiedAccounts": 0 },
  "competitorMap": [{
    "competitorKey": "mindbody", "competitorName": "Mindbody", "segment": "facility",
    "complaints": 100, "hot": 30, "warm": 42, "considering": 17, "decisionMakers": 78, "avgSeverity": 3.2,
    "topPains": [{ "painCategory": "customer_support", "painCategoryLabel": "Customer support", "count": 17, "sharePct": 17 }],
    "sources": { "web": 58, "reddit": 27, "appstore": 15 }, "sports": {...}, "regions": {...},
    "latestPost": "2026-10-22T00:00:00.000Z",
    "trend": { "recent": 10, "priorAvg": 2.5, "changePct": 300, "status": "rising" },
    "series": [{ "month": "2025-11", "count": 4 }, ...]          // 12 months, for a chart
  }],
  "trends": { "asOf": "...", "windowDays": 30, "competitors": [...], "categories": [...],
              "movers": [{ "competitorKey", "competitorName", "painCategory", "painCategoryLabel",
                           "recent", "priorAvg", "changePct", "status": "rising" | "new" }] },
  "clusters": [{
    "id": "fees-price-increases", "kind": "known" | "emerging" | "other",
    "label": "Fees & price increases", "count": 51, "hot": 13, "considering": 9,
    "competitors": [{ "competitorKey", "competitorName", "count" }],
    "painCategories": [{ "painCategory", "painCategoryLabel", "count" }],
    "trend": { "recent", "priorAvg", "changePct", "status" },
    "examples": [{ "quote", "competitorName", "sourceLabel", "url", "publishedAt", "leadTier" }]
  }],
  "hotAccounts": [ /* verified clubs only: organization, location, sport, competitors, topQuote, … */ ],
  "hotConversations": [{ "url", "title", "sourceLabel", "competitors", "complaintCount", "hot",
                         "considering", "decisionMakers", "topQuote", "latestPost", "score" }],
  "playbooks": [{
    "competitorKey", "competitorName", "segment", "complaintCount", "hot",
    "consideringPct", "decisionMakerPct", "trend",
    "opener": "Public reviews and posts about Mindbody often mention …",
    "topPains": [{ "painCategory", "painCategoryLabel", "count", "sharePct", "hot", "trend",
                   "proof": [{ "quote", "authorType", "sourceLabel", "url", "publishedAt" }],
                   "waresportAngle", "discoveryQuestions": ["…"] }]
  }]
}
```

A **complaint** item (from `/api/complaints`) has: `id, competitorKey, competitorName, segment,
quote, painSummary, painCategory, painCategoryLabel, severity, reviewRating, switchingIntent,
authorType, location, sportTag, sportSource, region, regionSource, source, sourceLabel, url,
title, publishedAt, postedMonth, foundAt, leadScore, leadTier, waresportAngle`. It also has
`organization` and `organizationEvidence`, but only when `organizationVerified` is true.

`sportSource` / `regionSource` say how sure a value is: `stated` (the source says so),
`inferred` (sport words or subreddit) or `app_store_country` (the App Store storefront).

**Versioning:** additive changes keep `schemaVersion: 1`. Breaking changes bump it.

---

## 5. Example: WareSport backend proxy (Express)

The WareSport backend is Express. Proxy the miner server-to-server so the token never reaches
the browser, and limit it to super-admin or sales roles:

```js
// routes/admin: router.use("/competitor-intel", require("./competitor-intel"))
const express = require("express");
const axios = require("axios");
const router = express.Router();

const MINER = process.env.COMPLAINT_MINER_API_URL;        // e.g. http://intel.internal:8787
const TOKEN = process.env.COMPLAINT_MINER_API_TOKEN;
const ALLOWED = new Set(["insights", "competitors", "trends", "clusters", "accounts", "playbooks", "complaints", "alerts", "filters"]);

router.get("/:resource/:key?", async (req, res, next) => {
    try {
        if (!ALLOWED.has(req.params.resource)) return res.status(404).json({ error: "Not found" });
        const path = `/api/${req.params.resource}${req.params.key ? `/${encodeURIComponent(req.params.key)}` : ""}`;
        const { data } = await axios.get(`${MINER}${path}`, {
            params: req.query,                               // pass filters through
            headers: { Authorization: `Bearer ${TOKEN}` },
            timeout: 15000,
        });
        res.json(data);
    } catch (err) {
        if (err.response) return res.status(err.response.status).json(err.response.data);
        next(err);
    }
});

module.exports = router;
```

---

## 6. Suggested admin pages

| Page | Data | Notes |
|---|---|---|
| **Competitor map** | `GET /api/competitors` (+ filter bar from `/api/filters`) | Table or cards: Hot, switching, top pains, trend arrow, 12-month sparkline from `series` |
| **Competitor detail** | `GET /api/competitors/:key` | Playbook, that competitor's issue clusters, rising pains, hot conversations |
| **Trends** | `GET /api/trends` | "Movers this month" list from `movers` |
| **Issue clusters** | `GET /api/clusters` | Group by `kind`; show example quotes with source links |
| **Playbooks** | `GET /api/playbooks/:key` | Opener, ranked pains, proof quotes, discovery questions |
| **Alerts feed** | `GET /api/alerts` | Priority badges; link to source |

Always link quotes to `url`. Quotes are verbatim public text and should be shown as quotes,
never edited.

---

## 7. Alerts to Slack, Teams or CRM

Set `COMPLAINT_MINER_WEBHOOK_URL`. After each run, new alerts are POSTed once:

```jsonc
{
  "source": "ai-complaint-miner",
  "generatedAt": "2026-11-21T05:04:52.000Z",
  "count": 2,
  "text": "AI Complaint Miner: 2 new competitor alert(s)\n• *Hot · Mindbody · Contract & lock-in* — …",
  "alerts": [{
    "alertId": "3f2a9c1d0b7e4a55", "dedupeKey": "complaint:…",
    "type": "hot_complaint" | "switching_intent" | "rising_trend",
    "priority": "high" | "medium" | "low",
    "createdAt": "…", "competitorKey": "mindbody", "competitorName": "Mindbody",
    "painCategory": "contract_lockin", "painCategoryLabel": "Contract & lock-in",
    "title": "Hot · Mindbody · Contract & lock-in", "message": "…", "quote": "…",
    "sourceLabel": "Reddit r/gymowner", "sourceUrl": "https://…", "postedAt": "…" | null,
    "dateKnown": true | false, // complaint alerts only
    "suggestedAction": "Prioritise Mindbody prospects this week: …",
    "playbook": { "competitorKey": "mindbody", "painCategory": "contract_lockin" },
    "crm": { "subject": "[Competitor intel] Mindbody: Contract & lock-in", "body": "…", "tags": ["competitor-intel", "mindbody", "contract_lockin", "hot"] }
  }]
}
```

- **Undated complaints:** many sources show no post date. Those alerts have `dateKnown: false`,
  rank one priority lower, and say to check the source first. Treat them as newly *found*.
- **Slack / Teams:** the payload has a `text` summary in their format, but delivery has only been
  tested with simulated calls. Test with your real webhook first; Teams may need its own format.
- **HubSpot / Salesforce:** point the webhook at a Zapier or Make scenario (or a small handler)
  that turns each `alerts[]` item into a note or task, using `crm.subject`, `crm.body` and `crm.tags`.
- If delivery fails, alerts are **not** marked as sent and retry on the next run. Each alert is
  delivered once (`dedupeKey`).
