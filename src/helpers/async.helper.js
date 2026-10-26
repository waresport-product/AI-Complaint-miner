"use strict";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Promise.allSettled-style map with bounded concurrency; preserves input order. */
async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;

    async function run() {
        while (next < items.length) {
            const index = next++;
            try {
                results[index] = { status: "fulfilled", value: await worker(items[index], index) };
            } catch (reason) {
                results[index] = { status: "rejected", reason };
            }
        }
    }

    const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
    await Promise.all(runners);
    return results;
}

module.exports = { sleep, mapWithConcurrency };
