'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { buildAlerts, deliverAlerts, processAlerts } = require('../src/alerts');
const { AlertStore } = require('../src/stores/alert-store');
const { createApiServer, publicComplaint } = require('../src/api/server');
const { buildInsights, prepare } = require('../src/insights');
const { ExcelExporter } = require('../src/exporters/excel-exporter');

const AS_OF = '2026-10-31T00:00:00.000Z';
const daysAgo = (n) => new Date(new Date(AS_OF).getTime() - n * 86400000).toISOString();
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'complaint-miner-'));

let seq = 0;
function complaint(overrides = {}) {
    seq += 1;
    return {
        id: `a${seq}`,
        competitorKey: 'mindbody',
        competitorName: 'Mindbody',
        quote: `They locked us into a contract and support never answers (${seq}).`,
        painSummary: 'Locked into contract with unresponsive support',
        painCategory: 'contract_lockin',
        painCategoryLabel: 'Contract & lock-in',
        severity: 5,
        switchingIntent: 'considering',
        authorType: 'club_owner_admin',
        source: 'reddit',
        sourceLabel: 'Reddit r/gymowner',
        url: `https://www.reddit.com/r/gymowner/comments/${seq}/x/`,
        publishedAt: daysAgo(3),
        foundAt: AS_OF,
        ...overrides,
    };
}

describe('alerts', () => {
    test('raises hot / switching alerts for recent complaints and rising-trend alerts, high priority first', () => {
        const complaints = prepare([
            complaint(),
            complaint({ severity: 2, authorType: 'player' }), // considering but not Hot
            complaint({ publishedAt: daysAgo(60) }), // too old to alert
            complaint({ switchingIntent: 'none', severity: 1, authorType: 'player' }), // nothing to alert
        ], new Date(AS_OF).getTime());
        const movers = [{ competitorKey: 'mindbody', competitorName: 'Mindbody', painCategory: 'pricing_fees', painCategoryLabel: 'Pricing & fees', recent: 5, priorAvg: 1, changePct: 400, status: 'rising' }];

        const alerts = buildAlerts({ complaints, movers, asOf: AS_OF });
        expect(alerts.map((a) => a.type)).toEqual(['hot_complaint', 'switching_intent', 'rising_trend']);
        expect(alerts[0]).toMatchObject({ priority: 'high', competitorName: 'Mindbody', sourceUrl: expect.stringContaining('reddit.com') });
        expect(alerts[0].crm.tags).toEqual(expect.arrayContaining(['competitor-intel', 'mindbody']));
        expect(alerts[2].dedupeKey).toBe('trend:mindbody:pricing_fees:2026-10');
    });

    test('never raises the same alert twice', () => {
        const complaints = prepare([complaint()], new Date(AS_OF).getTime());
        const first = buildAlerts({ complaints, asOf: AS_OF });
        const sent = new Set(first.map((a) => a.dedupeKey));
        expect(buildAlerts({ complaints, asOf: AS_OF, isSent: (k) => sent.has(k) })).toEqual([]);
    });

    test('delivers to the webhook with a Slack/Teams-compatible text summary', async () => {
        const post = jest.fn().mockResolvedValue({ status: 200 });
        const alerts = buildAlerts({ complaints: prepare([complaint()], new Date(AS_OF).getTime()), asOf: AS_OF });
        const result = await deliverAlerts(alerts, { webhookUrl: 'https://hooks.example/x', http: { post } });
        expect(result).toEqual({ delivered: true, status: 200 });
        const [url, body] = post.mock.calls[0];
        expect(url).toBe('https://hooks.example/x');
        expect(body.text).toContain('1 new competitor alert');
        expect(body.alerts).toHaveLength(1);
    });

    test('a failed webhook does not mark alerts as sent, so they retry next run', async () => {
        const dir = tmpDir();
        const alertStore = new AlertStore(dir).load();
        const complaints = prepare([complaint()], new Date(AS_OF).getTime());
        const insights = buildInsights(complaints, { asOf: AS_OF });
        const failing = { post: jest.fn().mockRejectedValue(new Error('boom')) };

        const failed = await processAlerts({ alertStore, insights, complaints, webhookUrl: 'https://hooks.example/x', http: failing });
        expect(failed.delivery.delivered).toBe(false);
        expect(alertStore.recent()).toHaveLength(0);

        const ok = { post: jest.fn().mockResolvedValue({ status: 200 }) };
        const sent = await processAlerts({ alertStore, insights, complaints, webhookUrl: 'https://hooks.example/x', http: ok });
        expect(sent.alerts.length).toBeGreaterThan(0);
        expect(new AlertStore(dir).load().recent().length).toBe(sent.alerts.length);
    });

    test('without a webhook, alerts are just recorded', async () => {
        const alertStore = new AlertStore(tmpDir()).load();
        const complaints = prepare([complaint()], new Date(AS_OF).getTime());
        const insights = buildInsights(complaints, { asOf: AS_OF });
        const { alerts } = await processAlerts({ alertStore, insights, complaints, webhookUrl: '' });
        expect(alertStore.recent()).toHaveLength(alerts.length);
    });
});

describe('insights API', () => {
    const complaints = prepare([
        complaint({ organization: 'Iron Gym', organizationVerified: true, organizationEvidence: 'I own Iron Gym in Denver.' }),
        complaint({ organization: 'Unverified Studio', organizationVerified: false, competitorKey: 'teamsnap', competitorName: 'TeamSnap', sourceLabel: 'App Store (US)', source: 'appstore' }),
    ], new Date(AS_OF).getTime());
    const dataSource = { complaints: () => complaints, alerts: () => [{ title: 'x' }] };

    async function withServer(options, fn) {
        const server = createApiServer({ dataSource, ...options });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        try {
            await fn(base);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    }

    test('serves insights with filters, and is read-only', async () => {
        await withServer({}, async (base) => {
            const health = await (await fetch(`${base}/health`)).json();
            expect(health).toMatchObject({ ok: true, complaints: 2 });

            const insights = await (await fetch(`${base}/api/insights?region=US`)).json();
            expect(insights.totals.complaints).toBe(1);

            const one = await (await fetch(`${base}/api/competitors/mindbody`)).json();
            expect(one.competitor.competitorKey).toBe('mindbody');

            expect((await fetch(`${base}/api/competitors/nobody`)).status).toBe(404);
            expect((await fetch(`${base}/api/insights`, { method: 'POST' })).status).toBe(405);
            expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
        });
    });

    test('requires the bearer token when configured (health stays open)', async () => {
        await withServer({ token: 'secret' }, async (base) => {
            expect((await fetch(`${base}/health`)).status).toBe(200);
            expect((await fetch(`${base}/api/insights`)).status).toBe(401);
            expect((await fetch(`${base}/api/insights`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
            expect((await fetch(`${base}/api/insights`, { headers: { Authorization: 'Bearer secret' } })).status).toBe(200);
        });
    });

    test('complaints are paged and never expose unverified organizations', async () => {
        await withServer({ corsOrigin: 'https://www.waresport.com' }, async (base) => {
            const res = await fetch(`${base}/api/complaints?limit=1`);
            expect(res.headers.get('access-control-allow-origin')).toBe('https://www.waresport.com');
            const page = await res.json();
            expect(page).toMatchObject({ total: 2, limit: 1, offset: 0 });
            expect(page.items).toHaveLength(1);
        });
        expect(publicComplaint(complaints[1]).organization).toBeUndefined();
        expect(publicComplaint(complaints[0]).organization).toBe('Iron Gym');
    });
});

describe('workbook intelligence sheets', () => {
    test('adds the market-intelligence sheets after Complaints and writes insights.json', async () => {
        const dir = tmpDir();
        const complaints = prepare([complaint(), complaint(), complaint(), complaint(), complaint()], new Date(AS_OF).getTime());
        const insights = buildInsights(complaints, { asOf: AS_OF });
        const files = await new ExcelExporter(dir).write({
            stamp: 't', allComplaints: complaints, newComplaints: [], insights, alerts: [{ title: 'Hot · Mindbody', priority: 'high', createdAt: AS_OF }], report: {},
        });

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(files.workbook);
        expect(wb.worksheets.map((s) => s.name)).toEqual(['Complaints', 'Competitor Map', 'Issue Clusters', 'Trends', 'Playbooks', 'Hot Conversations', 'Alerts']);
        for (const sheet of wb.worksheets) sheet.getRow(1).eachCell((cell) => expect(cell.note).toBeTruthy());
        expect(wb.getWorksheet('Competitor Map').getCell('A2').value).toBe('Mindbody');
        expect(JSON.parse(fs.readFileSync(files.insights, 'utf8')).schemaVersion).toBe(1);
    });
});
