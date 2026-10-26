"use strict";

/**
 * Orchestrator for the Competitor Complaint Miner.
 *
 *   collectors (parallel)          analyst (LLM, bounded concurrency)    scoring → exporter
 *   reddit | web | appstore  ──▶   verified complaints per document  ──▶ scored complaints
 *          └─ web hands Reddit links to the reddit collector
 *
 * Store/exporter are injected so the same pipeline can later run with a database + Google Sheets.
 */

const path = require("path");
const { COMPETITORS, DEFAULTS, SOURCES, getMaxReviewAgeDays } = require("../constants");
const { RedditCollector, WebCollector, AppStoreCollector } = require("../collectors");
const { analyzeDocument } = require("./complaint-analyzer-service");
const { scoreComplaint } = require("./lead-builder-service");
const LlmClient = require("../clients/llm-client");
const { FileStore } = require("../stores/file-store");
const { ExcelExporter } = require("../exporters/excel-exporter");
const { mapWithConcurrency } = require("../helpers/async.helper");

function defaultLog(message) {
    console.log(`[complaint-miner] ${message}`);
}

function resolveCompetitors(keys) {
    if (!keys || !keys.length) return [...COMPETITORS];
    const wanted = keys.map((k) => String(k).trim().toLowerCase());
    const unknown = wanted.filter((k) => !COMPETITORS.some((c) => c.key === k));
    if (unknown.length) {
        throw new Error(`Unknown competitor key(s): ${unknown.join(", ")}. Known: ${COMPETITORS.map((c) => c.key).join(", ")}`);
    }
    return COMPETITORS.filter((c) => wanted.includes(c.key));
}

function timestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * @param {object} options
 * @param {string[]} [options.sources]       subset of SOURCES (default: all)
 * @param {string[]} [options.competitors]   competitor keys (default: all)
 * @param {boolean}  [options.dryRun]        collect only; no LLM, no store writes
 * @param {boolean}  [options.exportOnly]    rebuild the workbook from stored complaints; no collection
 * @param {string}   [options.outputDir]
 * @param {object}   [options.limits]        overrides for DEFAULTS
 * @param {object}   [options.store]         defaults to FileStore(outputDir)
 * @param {object}   [options.exporter]      defaults to ExcelExporter(outputDir)
 * @param {Function} [options.log]
 */
async function run(options = {}) {
    const startedAt = new Date();
    const log = options.log || defaultLog;
    const sources = options.sources && options.sources.length ? options.sources : Object.values(SOURCES);
    const competitors = resolveCompetitors(options.competitors);
    const outputDir = path.resolve(options.outputDir || process.env.COMPLAINT_MINER_OUTPUT_DIR || DEFAULTS.outputDir);
    const limits = options.limits || {};
    const store = options.store || new FileStore(outputDir).load();
    const exporter = options.exporter || new ExcelExporter(outputDir);

    if (options.exportOnly) {
        const report = { startedAt: startedAt.toISOString(), exportOnly: true, warnings: [], errors: [] };
        return exportResults({ store, exporter, stamp: timestamp(startedAt), newComplaints: [], report });
    }

    if (!options.dryRun && !LlmClient.isConfigured()) {
        throw new Error("Set GEMINI_API_KEY (or OPENAI_API_KEY) to analyze complaints (use --dry-run to only collect).");
    }

    const report = {
        startedAt: startedAt.toISOString(),
        dryRun: Boolean(options.dryRun),
        llm: options.dryRun ? null : `${LlmClient.getProvider()}/${LlmClient.getModel()}`,
        competitors: competitors.map((c) => c.key),
        sources: {},
        warnings: [],
        errors: [],
    };

    // ── 1. Collector agents ───────────────────────────────────────────────
    const reddit = new RedditCollector({ store, log, limits });
    const web = new WebCollector({ store, log, limits });
    const appstore = new AppStoreCollector({ store, log, limits });

    const enabled = {
        reddit: sources.includes(SOURCES.reddit) && (await reddit.isAvailable()),
        web: sources.includes(SOURCES.web) && web.isAvailable(),
        appstore: sources.includes(SOURCES.appstore),
    };
    if (sources.includes(SOURCES.reddit) && !enabled.reddit) {
        report.warnings.push("Reddit skipped: agent-reach CLI not available on this machine.");
    }
    if (sources.includes(SOURCES.web) && !enabled.web) {
        report.warnings.push("Web skipped: FIRECRAWL_API_KEY is not set.");
    }
    report.warnings.forEach((w) => log(w));

    const [webResult, redditDocs, appDocs] = await Promise.all([
        enabled.web ? web.collect(competitors) : { documents: [], redditUrls: [] },
        enabled.reddit ? reddit.collect(competitors) : [],
        enabled.appstore ? appstore.collect(competitors) : [],
    ]);
    const handoffDocs = enabled.reddit && !reddit.stopped
        ? await reddit.collectUrls(webResult.redditUrls, competitors)
        : [];

    const documents = [...redditDocs, ...handoffDocs, ...webResult.documents, ...appDocs];
    report.sources = {
        reddit: { enabled: enabled.reddit, ...reddit.stats, stopped: reddit.stopped },
        web: { enabled: enabled.web, ...web.stats },
        appstore: { enabled: enabled.appstore, ...appstore.stats },
    };
    report.errors.push(...reddit.errors, ...web.errors, ...appstore.errors);
    report.warnings.push(...appstore.warnings);
    report.maxReviewAgeDays = getMaxReviewAgeDays();
    report.documentsCollected = documents.length;
    log(`collected ${documents.length} document(s) to analyze`);

    const stamp = timestamp(startedAt);
    if (options.dryRun) {
        report.finishedAt = new Date().toISOString();
        report.files = await exporter.writeDocuments({ stamp, documents, report });
        return report;
    }

    // ── 2. Analyst agent ──────────────────────────────────────────────────
    const analysis = { analyzed: 0, failed: 0, vendorPagesSkipped: 0, quotesRejected: 0, tooOldDropped: 0, tokens: 0 };
    const found = [];
    const concurrency = Number(process.env.COMPLAINT_MINER_LLM_CONCURRENCY) || DEFAULTS.llmConcurrency;

    await mapWithConcurrency(documents, concurrency, async (doc) => {
        try {
            const result = await analyzeDocument(doc, competitors);
            analysis.analyzed++;
            analysis.tokens += result.tokens;
            analysis.quotesRejected += result.rejected;
            analysis.tooOldDropped += result.tooOld;
            if (result.documentType === "vendor_marketing") analysis.vendorPagesSkipped++;
            found.push(...result.complaints);
            store.markProcessed(doc.processKeys || [doc.id]);
        } catch (err) {
            // Not marked processed, so the next run retries it.
            analysis.failed++;
            report.errors.push({ source: doc.source, context: `analyze ${doc.url}`, message: err.message });
        }
    });
    report.analysis = analysis;
    log(
        `analyzed ${analysis.analyzed} doc(s): ${found.length} verified complaint(s), ` +
        `${analysis.quotesRejected} unverifiable quote(s) and ${analysis.tooOldDropped} too-old complaint(s) dropped`
    );

    // ── 3. Lead builder + export ──────────────────────────────────────────
    const newComplaints = store.addComplaints(found);
    store.save();
    return exportResults({ store, exporter, stamp, newComplaints, report });
}

/** Re-score everything in the store (recency changes over time) and write the workbook. */
async function exportResults({ store, exporter, stamp, newComplaints, report }) {
    const now = Date.now();
    const allScored = store.allComplaints().map((c) => scoreComplaint(c, now));
    const newIds = new Set(newComplaints.map((c) => c.id));

    report.totals = {
        newComplaints: newComplaints.length,
        allComplaints: allScored.length,
        hotComplaints: allScored.filter((c) => c.leadTier === "Hot").length,
    };
    report.finishedAt = new Date().toISOString();
    report.files = await exporter.write({
        stamp,
        allComplaints: allScored,
        newComplaints: allScored.filter((c) => newIds.has(c.id)),
        report,
    });
    return report;
}

module.exports = { run, resolveCompetitors };
