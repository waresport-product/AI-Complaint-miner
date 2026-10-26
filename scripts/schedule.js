"use strict";

/**
 * Local twice-weekly schedule for testing (keep this process running, e.g. in a terminal).
 * Default: Monday and Thursday 08:00 machine time. Override with COMPLAINT_MINER_CRON.
 *
 *   npm run schedule
 *   npm run schedule -- --now     (also run once immediately)
 */

require("dotenv").config();

const cron = require("node-cron");
const { main } = require("./run");

const EXPRESSION = process.env.COMPLAINT_MINER_CRON || "0 8 * * 1,4";
let running = false;

async function tick() {
    if (running) {
        console.log("[complaint-miner] previous run still in progress — skipping this slot");
        return;
    }
    running = true;
    try {
        await main([]);
    } catch (err) {
        console.error(`[complaint-miner] scheduled run failed: ${err.message}`);
    } finally {
        running = false;
    }
}

if (!cron.validate(EXPRESSION)) {
    console.error(`[complaint-miner] invalid COMPLAINT_MINER_CRON: ${EXPRESSION}`);
    process.exit(1);
}

cron.schedule(EXPRESSION, tick);
console.log(`[complaint-miner] scheduled with "${EXPRESSION}" — leave this process running.`);

if (process.argv.includes("--now")) tick();
