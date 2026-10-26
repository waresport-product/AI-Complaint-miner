"use strict";

/**
 * Thin wrapper over the local `agent-reach` CLI (https://github.com/Panniantong/Agent-Reach).
 *
 * Agent Reach drives a logged-in browser on the machine it runs on, so this client only
 * works where the CLI is installed (local/dev box or a dedicated worker) — not in serverless functions.
 * Every command prints one JSON envelope: { ok, channel, action, backend, items, meta, error }.
 */

const { execFile } = require("child_process");
const { DEFAULTS } = require("../constants");

/** Codes after which the channel must not be hit again this run (per Agent Reach rules). */
const STOP_CODES = Object.freeze(["NEED_LOGIN", "PLATFORM_BLOCKED", "RATE_LIMITED", "BUSY", "NEED_SETUP"]);

class AgentReachError extends Error {
    constructor(code, message, hint) {
        super(message || code);
        this.name = "AgentReachError";
        this.code = code || "UNKNOWN";
        this.hint = hint || null;
        this.stopChannel = STOP_CODES.includes(this.code);
    }
}

function getBin() {
    return process.env.AGENT_REACH_BIN || "agent-reach";
}

function parseEnvelope(stdout) {
    const text = String(stdout || "").trim();
    if (!text) return null;
    // The CLI prints a single JSON line; tolerate stray log lines before it.
    const start = text.indexOf("{");
    if (start < 0) return null;
    try {
        return JSON.parse(text.slice(start));
    } catch (_) {
        return null;
    }
}

function run(args, { timeoutMs = DEFAULTS.agentReachTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
        execFile(
            getBin(),
            args,
            {
                timeout: timeoutMs,
                maxBuffer: 32 * 1024 * 1024,
                windowsHide: true,
                encoding: "utf8",
                env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
            },
            (err, stdout) => {
                const envelope = parseEnvelope(stdout);
                if (envelope) {
                    if (envelope.ok) return resolve(envelope);
                    const e = envelope.error || {};
                    return reject(new AgentReachError(e.code, e.message, e.hint));
                }
                if (err && err.code === "ENOENT") {
                    return reject(new AgentReachError("NOT_INSTALLED", `agent-reach CLI not found (${getBin()})`));
                }
                if (err && err.killed) {
                    return reject(new AgentReachError("TIMEOUT", `agent-reach timed out after ${timeoutMs}ms`));
                }
                return reject(new AgentReachError("BAD_OUTPUT", err ? err.message : "agent-reach returned no JSON"));
            }
        );
    });
}

async function isAvailable() {
    try {
        await run(["version"], { timeoutMs: 30000 });
        return true;
    } catch (_) {
        return false;
    }
}

async function redditSearch(query, { limit = DEFAULTS.redditSearchLimit } = {}) {
    const envelope = await run(["reddit", "search", query, "--limit", String(limit), "--backend", "opencli"]);
    return Array.isArray(envelope.items) ? envelope.items : [];
}

async function redditRead(url) {
    const envelope = await run(["reddit", "read", url, "--backend", "opencli"]);
    return Array.isArray(envelope.items) ? envelope.items[0] || null : null;
}

module.exports = {
    AgentReachError,
    STOP_CODES,
    parseEnvelope,
    isAvailable,
    redditSearch,
    redditRead,
};
