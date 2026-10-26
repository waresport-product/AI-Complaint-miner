'use strict';

const {
    findMentionedCompetitors,
    isVerbatimQuote,
    chunkText,
    normalizeOrgName,
    domainMatches,
} = require('../src/helpers/text.helper');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { ExcelExporter } = require('../src/exporters/excel-exporter');
const { mapWithConcurrency } = require('../src/helpers/async.helper');
const { COMPETITORS } = require('../src/constants');

describe('complaint-miner text helpers', () => {
    test('matches competitor aliases as whole words, including spacing variants', () => {
        expect(findMentionedCompetitors('Our club moved to Court Reserve last year', COMPETITORS)).toEqual(['courtreserve']);
        expect(findMentionedCompetitors('courtreserve keeps crashing', COMPETITORS)).toEqual(['courtreserve']);
        expect(findMentionedCompetitors('Court-Reserve support never answered', COMPETITORS)).toEqual(['courtreserve']);
    });

    test('ignores Reddit search noise that only shares words', () => {
        const noise = 'Supreme Court lets Lisa Cook remain as a Federal Reserve governor';
        expect(findMentionedCompetitors(noise, COMPETITORS)).toEqual([]);
    });

    test('verbatim quote check tolerates curly quotes and whitespace but not paraphrase', () => {
        const source = 'Honestly the app’s booking   page  is “broken” every Monday.\nWe lose members.';
        expect(isVerbatimQuote("the app's booking page is \"broken\" every Monday.", source)).toBe(true);
        expect(isVerbatimQuote('the booking page is always broken on Mondays', source)).toBe(false);
        expect(isVerbatimQuote('short', source)).toBe(false);
    });

    test('chunkText keeps paragraphs together and respects the limit', () => {
        const text = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n\n');
        const chunks = chunkText(text, 90);
        expect(chunks).toHaveLength(2);
        chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(90));
        expect(chunkText('', 90)).toEqual([]);
    });

    test('normalizeOrgName groups the same club written differently', () => {
        expect(normalizeOrgName('The Dink Pickleball Club, LLC')).toBe(normalizeOrgName('dink pickleball club'));
        expect(normalizeOrgName(null)).toBe('');
    });

    test('domainMatches handles subdomains', () => {
        expect(domainMatches('https://app.courtreserve.com/x', ['courtreserve.com'])).toBe(true);
        expect(domainMatches('https://notcourtreserve.com/x', ['courtreserve.com'])).toBe(false);
    });
});

describe('complaint-miner excel exporter', () => {
    const complaint = {
        id: 'abc',
        foundAt: '2026-10-25T00:00:00Z',
        publishedAt: '2026-10-01T00:00:00Z',
        leadTier: 'Hot',
        leadScore: 18,
        competitorName: 'CourtReserve',
        painCategoryLabel: 'Booking & scheduling',
        quote: '=HYPERLINK("http://evil") the calendar is broken',
        url: 'https://www.reddit.com/r/x/comments/1/y/',
    };

    test('writes a Complaints sheet only, with text-only cells, links, tier colours and header notes', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaint-miner-xlsx-'));
        const report = { warnings: [] };
        const files = await new ExcelExporter(dir).write({
            stamp: 'test',
            allComplaints: [{ ...complaint, organization: 'Unverified Club' }],
            newComplaints: [complaint],
            report,
        });

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(files.workbook);
        expect(wb.worksheets.map((s) => s.name)).toEqual(['Complaints']);

        const complaints = wb.getWorksheet('Complaints');
        const headers = complaints.getRow(1).values.filter(Boolean);
        expect(headers).not.toContain('Club / Organization');
        complaints.getRow(1).eachCell((cell) => expect(cell.note).toBeTruthy());

        const quoteCell = complaints.getCell('F2');
        expect(quoteCell.value).toBe(complaint.quote);
        expect(quoteCell.formula).toBeUndefined();
        expect(complaints.getCell('O2').value).toMatchObject({ hyperlink: complaint.url });
        expect(complaints.getCell('B2').fill.fgColor.argb).toBe('FFF8CBAD');
        expect(complaints.getCell('A2').value).toBe('2026-10-25');

        expect(fs.existsSync(files.newComplaints)).toBe(true);
        expect(JSON.parse(fs.readFileSync(files.report, 'utf8')).files.workbook).toBe(files.workbook);
    });

    test('strips markdown bold from quotes in the sheet', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaint-miner-xlsx-'));
        const bold = { ...complaint, id: 'b', quote: 'for my opening **the links were broken** and fees were **4.4%!!!**' };
        const files = await new ExcelExporter(dir).write({ stamp: 't', allComplaints: [bold], newComplaints: [], report: {} });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(files.workbook);
        expect(wb.getWorksheet('Complaints').getCell('F2').value).toBe('for my opening the links were broken and fees were 4.4%!!!');
    });
});

describe('complaint-miner async helper', () => {
    test('mapWithConcurrency preserves order, bounds concurrency and captures failures', async () => {
        let active = 0;
        let peak = 0;
        const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            if (n === 3) throw new Error('boom');
            return n * 10;
        });
        expect(peak).toBeLessThanOrEqual(2);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
        expect(results[4].value).toBe(50);
    });
});
