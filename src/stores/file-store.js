"use strict";

/**
 * Local JSON store for testing runs: remembers processed documents (so twice-weekly
 * runs don't re-pay for the same pages) and accumulates complaints across runs.
 *
 * Same interface a future database store should implement:
 *   load(), hasProcessed(key, maxAgeDays?), markProcessed(keys), addComplaints(list),
 *   allComplaints(), save()
 */

const fs = require("fs");
const path = require("path");

class FileStore {
    constructor(dir) {
        this.dir = dir;
        this.statePath = path.join(dir, "state.json");
        this.complaintsPath = path.join(dir, "complaints.json");
        this.processed = {};
        this.complaints = new Map();
    }

    load() {
        fs.mkdirSync(this.dir, { recursive: true });
        this.processed = readJson(this.statePath, {}).processed || {};
        for (const c of readJson(this.complaintsPath, [])) {
            if (c && c.id) this.complaints.set(c.id, c);
        }
        return this;
    }

    hasProcessed(key, maxAgeDays = null) {
        const at = this.processed[key];
        if (!at) return false;
        if (!maxAgeDays) return true;
        return Date.now() - new Date(at).getTime() < maxAgeDays * 86400000;
    }

    markProcessed(keys) {
        const now = new Date().toISOString();
        for (const key of keys) this.processed[key] = now;
    }

    /** @returns {object[]} complaints that were not already stored */
    addComplaints(list) {
        const added = [];
        for (const c of list) {
            if (this.complaints.has(c.id)) continue;
            this.complaints.set(c.id, c);
            added.push(c);
        }
        return added;
    }

    allComplaints() {
        return [...this.complaints.values()];
    }

    save() {
        writeJsonAtomic(this.statePath, { processed: this.processed });
        writeJsonAtomic(this.complaintsPath, this.allComplaints());
    }
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
        return fallback;
    }
}

function writeJsonAtomic(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
}

module.exports = { FileStore };
