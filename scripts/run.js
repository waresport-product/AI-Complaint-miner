"use strict";

/**
 * Competitor Complaint Miner — one run.
 *
 * Usage:
 *   npm run mine -- [options]
 *   node scripts/run.js --competitors courtreserve,podplay --sources reddit,appstore
 *
 * Options:
 *   --sources reddit,web,appstore   (default: all)
 *   --competitors key1,key2         (default: all in src/constants.js)
 *   --dry-run                       collect only, write documents.xlsx, no LLM calls
 *   --export-only                   rebuild complaint-miner.xlsx from saved results (no scraping)
 *   --out <dir>                     output directory (default: output/complaint-miner)
 *   --reddit-reads <n>              posts read per competitor (default 5)
 *   --reddit-searches <n>           Reddit searches per competitor (default 2; 0 = only read Reddit
 *                                   links found by web search, e.g. when Reddit search is down)
 *   --web-pages <n>                 pages scraped per competitor (default 6)
 *   --list                          print competitor keys and exit
 */

require("dotenv").config();

const { ComplaintMinerService } = require("../src/services");
const { COMPETITORS } = require("../src/constants");

function parseArgs(argv) {
    const args = { limits: {} };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const next = () => argv[++i];
        const list = () => String(next() || "").split(",").map((s) => s.trim()).filter(Boolean);
        switch (flag) {
            case "--sources": args.sources = list(); break;
            case "--competitors": args.competitors = list(); break;
            case "--dry-run": args.dryRun = true; break;
            case "--export-only": args.exportOnly = true; break;
            case "--out": args.outputDir = next(); break;
            case "--reddit-reads": args.limits.redditReadsPerCompetitor = Number(next()); break;
            case "--reddit-searches": args.limits.redditQueriesPerCompetitor = Number(next()); break;
            case "--web-pages": args.limits.webScrapesPerCompetitor = Number(next()); break;
            case "--list": args.list = true; break;
            default:
                throw new Error(`Unknown option: ${flag}`);
        }
    }
    return args;
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (args.list) {
        COMPETITORS.forEach((c) => console.log(`${c.key.padEnd(16)} ${c.name} (${c.segment})`));
        return null;
    }

    const report = await ComplaintMinerService.run(args);
    console.log("\n=== Complaint Miner run complete ===");
    console.log(JSON.stringify({
        documentsCollected: report.documentsCollected,
        analysis: report.analysis,
        totals: report.totals,
        warnings: report.warnings,
        errors: report.errors.length,
        files: report.files,
    }, null, 2));
    return report;
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`[complaint-miner] failed: ${err.message}`);
        process.exitCode = 1;
    });
}

module.exports = { main, parseArgs };
