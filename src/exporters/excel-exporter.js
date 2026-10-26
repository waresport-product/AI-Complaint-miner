"use strict";

/**
 * Writes the sales-facing Excel workbooks. Swap for a Google Sheets exporter later — same write() input.
 *
 *   <dir>/complaint-miner.xlsx                 sheet "Complaints" (cumulative, best first)
 *
 * Club/organization is still extracted and stored, but not exported until it is verified against
 * the source text (see README "Club names").
 *   <dir>/runs/<stamp>/new-complaints.xlsx     what this run added
 *   <dir>/runs/<stamp>/report.json             per-source stats, warnings, errors
 *
 * Cells are written as plain strings (never formulas), so scraped text can't execute in Excel.
 */

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const TIER_FILLS = Object.freeze({ Hot: "FFF8CBAD", Warm: "FFFFE699", Cold: "FFEDEDED" });
const HEADER_FILL = "FF1F3864";

const AUTHOR_TYPES_NOTE =
    "club_owner_admin = runs or manages the club (decision-maker); club_staff = front desk/pro/manager; " +
    "coach; player; parent; unknown = not clear from the text.";

const SWITCHING_NOTE =
    "considering = evaluating or asking for alternatives (strongest buying signal); " +
    "switched_away = already left the product; none = complaining but no sign of leaving.";

const TIER_NOTE =
    "Hot / Warm / Cold — the system's suggested priority, based on how serious the complaint is, who said it " +
    "(owner/admin counts most), whether they want to switch, and how recent it is.";

// `note` is shown as a hover comment on each header cell in Excel.
const COMPLAINT_COLUMNS = Object.freeze([
    { key: "foundOn", header: "Found On", width: 11, note: "Date our tool first collected this complaint." },
    { key: "leadTier", header: "Lead Tier", width: 9, note: TIER_NOTE },
    { key: "leadScore", header: "Lead Score", width: 10, note: "Number behind the Lead Tier (0-23). Hot = 16+, Warm = 10-15, Cold = below 10." },
    { key: "competitorName", header: "Competitor", width: 15, note: "The competing software the person is complaining about (e.g. CourtReserve)." },
    { key: "painCategoryLabel", header: "Pain Category", width: 22, note: "Type of problem, e.g. Booking & scheduling, Payments & billing, Customer support, Ease of use." },
    { key: "quote", header: "Exact Quote", width: 70, wrap: true, note: "Word-for-word text from the source. Checked automatically against the original page, so it is never paraphrased or invented." },
    { key: "painSummary", header: "Pain Summary", width: 35, wrap: true, note: "Short neutral summary of the problem, written by the AI (not a quote)." },
    { key: "severity", header: "Severity (1-5)", width: 12, note: "1 = minor annoyance, 3 = recurring problem hurting the club's operations, 5 = losing money/members or leaving the product. Capped at 2 when the complaint comes from a 4-5 star review." },
    { key: "reviewRating", header: "Review Rating", width: 12, note: "Stars (1-5) the author gave in this review. 4-5 stars = a mostly happy customer listing a minor con. Blank for forum/Reddit/Facebook posts or when the site doesn't show a rating." },
    { key: "switchingIntent", header: "Switching Intent", width: 15, note: SWITCHING_NOTE },
    { key: "authorType", header: "Author Type", width: 16, note: `Who wrote the complaint. ${AUTHOR_TYPES_NOTE}` },
    { key: "location", header: "Location", width: 16, note: "City/state/country, only if stated in the source." },
    { key: "sport", header: "Sport", width: 12, note: "Sport mentioned or obvious from the source (pickleball, tennis, padel, …)." },
    { key: "sourceLabel", header: "Source", width: 20, note: "Where it was found: Reddit (with subreddit), App Store, Capterra, Software Advice, G2, Trustpilot, Facebook, etc." },
    { key: "url", header: "Source URL", width: 40, link: true, note: "Click to open the original post/review and read the full context." },
    { key: "postedOn", header: "Posted On", width: 11, note: "Date the original post/review was published, when the source shows it." },
    { key: "waresportAngle", header: "WareSport Angle", width: 50, wrap: true, note: "Suggested WareSport talking point for this type of problem. Verify the wording before using it with a prospect." },
    { key: "id", header: "Complaint ID", width: 18, note: "Internal ID used to avoid duplicates between runs. Not needed by sales." },
]);

const DOCUMENT_COLUMNS = Object.freeze([
    { key: "sourceLabel", header: "Source", width: 20, note: "Where the page/post was collected from." },
    { key: "competitors", header: "Competitors Mentioned", width: 22, note: "Competitors named in the page text." },
    { key: "title", header: "Title", width: 50, wrap: true, note: "Page or post title." },
    { key: "url", header: "URL", width: 45, link: true, note: "Link to the collected page/post." },
    { key: "chars", header: "Text Length", width: 11, note: "Characters of text collected (the AI reads this text)." },
    { key: "preview", header: "Preview", width: 80, wrap: true, note: "First 300 characters of the collected text." },
]);

function day(iso) {
    return iso ? String(iso).slice(0, 10) : "";
}

function cellValue(value, column) {
    if (value === null || value === undefined || value === "") return null;
    if (Array.isArray(value)) return value.join("; ");
    if (typeof value === "number") return value;
    const text = String(value);
    if (column.link && /^https?:\/\//i.test(text)) return { text, hyperlink: text };
    return text;
}

function addSheet(workbook, name, columns, rows) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = columns.map((c) => ({ key: c.key, header: c.header, width: c.width }));

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    header.alignment = { vertical: "middle" };
    columns.forEach((c, i) => {
        if (c.note) header.getCell(i + 1).note = c.note;
    });

    for (const row of rows) {
        const values = {};
        columns.forEach((c) => { values[c.key] = cellValue(row[c.key], c); });
        const added = sheet.addRow(values);
        added.alignment = { vertical: "top" };
        columns.forEach((c, i) => {
            const cell = added.getCell(i + 1);
            if (c.wrap) cell.alignment = { vertical: "top", wrapText: true };
            if (c.link && cell.value && cell.value.hyperlink) cell.font = { color: { argb: "FF0563C1" }, underline: true };
            if (c.key === "leadTier" && TIER_FILLS[row.leadTier]) {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TIER_FILLS[row.leadTier] } };
                cell.font = { bold: true };
            }
        });
    }

    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return sheet;
}

/** Reddit/markdown emphasis (**bold**, __bold__) is noise in a spreadsheet cell. */
function stripMarkdownEmphasis(text) {
    return typeof text === "string" ? text.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/\*\*/g, "") : text;
}

function toComplaintRow(c) {
    return { ...c, quote: stripMarkdownEmphasis(c.quote), foundOn: day(c.foundAt), postedOn: day(c.publishedAt) };
}

function sortComplaints(list) {
    return [...list].sort(
        (a, b) => b.leadScore - a.leadScore || String(b.foundAt).localeCompare(String(a.foundAt))
    );
}

/**
 * Excel locks open workbooks on Windows. If the main file is open, save a timestamped copy
 * instead of failing the whole run.
 */
async function writeWorkbook(workbook, file, stamp, warnings) {
    try {
        await workbook.xlsx.writeFile(file);
        return file;
    } catch (err) {
        if (!["EBUSY", "EPERM", "EACCES"].includes(err.code)) throw err;
        const fallback = file.replace(/\.xlsx$/, `-${stamp}.xlsx`);
        await workbook.xlsx.writeFile(fallback);
        warnings.push(`${path.basename(file)} is open in another program; saved ${path.basename(fallback)} instead.`);
        return fallback;
    }
}

class ExcelExporter {
    constructor(dir) {
        this.dir = dir;
    }

    runDir(stamp) {
        const dir = path.join(this.dir, "runs", stamp);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    /** @returns {Promise<object>} paths written */
    async write({ stamp, allComplaints, newComplaints, report }) {
        fs.mkdirSync(this.dir, { recursive: true });
        const runDir = this.runDir(stamp);
        const warnings = report.warnings || (report.warnings = []);

        const main = new ExcelJS.Workbook();
        addSheet(main, "Complaints", COMPLAINT_COLUMNS, sortComplaints(allComplaints).map(toComplaintRow));

        const fresh = new ExcelJS.Workbook();
        addSheet(fresh, "New Complaints", COMPLAINT_COLUMNS, sortComplaints(newComplaints).map(toComplaintRow));

        const files = {
            workbook: await writeWorkbook(main, path.join(this.dir, "complaint-miner.xlsx"), stamp, warnings),
            newComplaints: await writeWorkbook(fresh, path.join(runDir, "new-complaints.xlsx"), stamp, warnings),
            report: path.join(runDir, "report.json"),
        };
        fs.writeFileSync(files.report, JSON.stringify({ ...report, files }, null, 2), "utf8");
        return files;
    }

    /** Dry runs: list what would be analyzed, without calling the LLM. */
    async writeDocuments({ stamp, documents, report }) {
        const runDir = this.runDir(stamp);
        const workbook = new ExcelJS.Workbook();
        addSheet(workbook, "Documents", DOCUMENT_COLUMNS, documents.map((d) => ({
            sourceLabel: d.sourceLabel,
            competitors: d.competitorKeys,
            title: d.title,
            url: d.url,
            chars: d.text.length,
            preview: d.text.slice(0, 300).replace(/\s+/g, " "),
        })));
        const files = {
            documents: await writeWorkbook(workbook, path.join(runDir, "documents.xlsx"), stamp, report.warnings || []),
            report: path.join(runDir, "report.json"),
        };
        fs.writeFileSync(files.report, JSON.stringify({ ...report, files }, null, 2), "utf8");
        return files;
    }
}

module.exports = { ExcelExporter, COMPLAINT_COLUMNS };
