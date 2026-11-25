"use strict";

/**
 * Starts the read-only insights API (see docs/INTEGRATION.md).
 *
 *   npm run api
 *
 * Env: COMPLAINT_MINER_API_PORT (default 8787), COMPLAINT_MINER_API_HOST (default 127.0.0.1 —
 * this machine only; use 0.0.0.0 to expose it), COMPLAINT_MINER_API_TOKEN (recommended whenever
 * exposed), COMPLAINT_MINER_API_CORS_ORIGIN, COMPLAINT_MINER_OUTPUT_DIR.
 */

require("dotenv").config();

const path = require("path");
const { createApiServer } = require("../src/api/server");
const { DEFAULTS } = require("../src/constants");

const port = Number(process.env.COMPLAINT_MINER_API_PORT) || 8787;
const host = process.env.COMPLAINT_MINER_API_HOST || "127.0.0.1";
const token = process.env.COMPLAINT_MINER_API_TOKEN || "";
const outputDir = path.resolve(process.env.COMPLAINT_MINER_OUTPUT_DIR || DEFAULTS.outputDir);

if (host !== "127.0.0.1" && host !== "localhost" && !token) {
    console.warn("[complaint-miner] WARNING: API exposed beyond this machine without COMPLAINT_MINER_API_TOKEN.");
}

createApiServer({ outputDir, token, corsOrigin: process.env.COMPLAINT_MINER_API_CORS_ORIGIN || "" })
    .listen(port, host, () => {
        console.log(`[complaint-miner] insights API on http://${host}:${port}  (try /health, /api/insights)`);
    });
