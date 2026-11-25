"use strict";

/**
 * Remembers which alerts were already raised (so each fires once) and keeps a short history
 * for the API. File: <outputDir>/alerts.json
 */

const fs = require("fs");
const path = require("path");
const { withDateConfidence } = require("../alerts/confidence");

const HISTORY_LIMIT = 500;

class AlertStore {
    constructor(dir) {
        this.file = path.join(dir, "alerts.json");
        this.sent = {};
        this.history = [];
    }

    load() {
        try {
            const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
            this.sent = data.sent || {};
            // Also corrects alerts saved before post dates were taken into account.
            this.history = (Array.isArray(data.history) ? data.history : []).map(withDateConfidence);
        } catch (_) {
            // First run or unreadable file: start empty.
        }
        return this;
    }

    isSent(key) {
        return Boolean(this.sent[key]);
    }

    record(alerts) {
        const now = new Date().toISOString();
        for (const a of alerts) this.sent[a.dedupeKey] = now;
        this.history = [...alerts, ...this.history].slice(0, HISTORY_LIMIT);
    }

    recent(limit = 100) {
        return this.history.slice(0, limit);
    }

    save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ sent: this.sent, history: this.history }, null, 2), "utf8");
        fs.renameSync(tmp, this.file);
    }
}

module.exports = { AlertStore };
