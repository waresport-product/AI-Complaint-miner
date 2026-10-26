'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const mockRedditSearch = jest.fn();
const mockRedditRead = jest.fn();
const mockCompleteJson = jest.fn();

jest.mock('../src/clients/agent-reach-client', () => {
    const actual = jest.requireActual('../src/clients/agent-reach-client');
    return {
        ...actual,
        isAvailable: async () => true,
        redditSearch: (...args) => mockRedditSearch(...args),
        redditRead: (...args) => mockRedditRead(...args),
    };
});

jest.mock('../src/clients/llm-client', () => ({
    isConfigured: () => true,
    getProvider: () => 'gemini',
    getModel: () => 'test-model',
    completeJson: (...args) => mockCompleteJson(...args),
}));

const { AgentReachError, parseEnvelope } = require('../src/clients/agent-reach-client');
const { RedditCollector, normalizeRedditUrl } = require('../src/collectors/reddit-collector');
const { classifyUrl, sourceLabelFor } = require('../src/collectors/web-collector');
const { pickApp } = require('../src/collectors/app-store-collector');
const { FileStore } = require('../src/stores/file-store');
const { ComplaintMinerService } = require('../src/services');
const { COMPETITORS } = require('../src/constants');

const courtreserve = COMPETITORS.find((c) => c.key === 'courtreserve');
const noLog = () => {};
const fastLimits = { agentReachSearchSpacingMs: 0, agentReachReadSpacingMs: 0, agentReachRetryWaitMs: 0, redditQueriesPerCompetitor: 1 };

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'complaint-miner-'));
}

const POST_URL = 'https://www.reddit.com/r/Pickleball/comments/abc/court_reserve_rant/';
const POST_TEXT = 'Title: Court Reserve rant\n\nOur club Sunset Pickleball Club pays a fortune and CourtReserve still double-books courts every week.';

beforeEach(() => {
    mockRedditSearch.mockReset();
    mockRedditRead.mockReset();
    mockCompleteJson.mockReset();
});

describe('agent-reach client', () => {
    test('parses the JSON envelope even with leading log noise', () => {
        expect(parseEnvelope('warming up...\n{"ok":true,"items":[]}')).toEqual({ ok: true, items: [] });
        expect(parseEnvelope('')).toBeNull();
        expect(parseEnvelope('not json')).toBeNull();
    });

    test('login/block/rate-limit errors stop the channel', () => {
        expect(new AgentReachError('NEED_LOGIN').stopChannel).toBe(true);
        expect(new AgentReachError('RATE_LIMITED').stopChannel).toBe(true);
        expect(new AgentReachError('NOT_FOUND').stopChannel).toBe(false);
    });
});

describe('reddit collector', () => {
    test('filters noisy search hits, reads relevant posts and skips processed ones', async () => {
        mockRedditSearch.mockResolvedValue([
            { title: 'Court Reserve rant', url: POST_URL, raw: { subreddit: 'r/Pickleball', selftext: 'CourtReserve again', comments: 40, created_utc: 1768692617 } },
            { title: 'Supreme Court and the Federal Reserve', url: 'https://www.reddit.com/r/law/comments/zzz/x/', raw: { selftext: '', comments: 900 } },
        ]);
        mockRedditRead.mockResolvedValue({ text: POST_TEXT });

        const store = new FileStore(tmpDir()).load();
        const collector = new RedditCollector({ store, log: noLog, limits: fastLimits });
        const docs = await collector.collect([courtreserve]);

        expect(mockRedditRead).toHaveBeenCalledTimes(1);
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({ source: 'reddit', sourceLabel: 'Reddit r/Pickleball', competitorKeys: ['courtreserve'] });

        store.markProcessed([docs[0].id]);
        mockRedditRead.mockClear();
        const again = await new RedditCollector({ store, log: noLog, limits: fastLimits }).collect([courtreserve]);
        expect(again).toEqual([]);
        expect(mockRedditRead).not.toHaveBeenCalled();
    });

    test('stops calling Reddit after a NEED_LOGIN error', async () => {
        mockRedditSearch.mockRejectedValue(new AgentReachError('NEED_LOGIN', 'login required', 'agent-reach login reddit'));
        const collector = new RedditCollector({ store: new FileStore(tmpDir()).load(), log: noLog, limits: { ...fastLimits, redditQueriesPerCompetitor: 3 } });
        const docs = await collector.collect([courtreserve]);
        expect(docs).toEqual([]);
        expect(mockRedditSearch).toHaveBeenCalledTimes(1);
        expect(collector.stopped).toMatchObject({ code: 'NEED_LOGIN' });
    });

    test('retries a timed-out read once, but not a missing post', async () => {
        mockRedditSearch.mockResolvedValue([
            { title: 'Court Reserve rant', url: POST_URL, raw: { subreddit: 'r/Pickleball', selftext: 'CourtReserve', comments: 9 } },
            { title: 'CourtReserve gone', url: 'https://www.reddit.com/r/Pickleball/comments/gone/x/', raw: { selftext: 'CourtReserve', comments: 1 } },
        ]);
        mockRedditRead
            .mockRejectedValueOnce(new AgentReachError('TIMEOUT', 'backend did not answer'))
            .mockResolvedValueOnce({ text: POST_TEXT })
            .mockRejectedValueOnce(new AgentReachError('NOT_FOUND', 'deleted'));

        const collector = new RedditCollector({ store: new FileStore(tmpDir()).load(), log: noLog, limits: fastLimits });
        const docs = await collector.collect([courtreserve]);

        expect(docs).toHaveLength(1);
        expect(collector.stats.retries).toBe(1);
        expect(mockRedditRead).toHaveBeenCalledTimes(3);
    });

    test('normalizes reddit URLs for dedupe', () => {
        expect(normalizeRedditUrl('https://old.reddit.com/r/a/comments/1/x?utm=1')).toBe('https://www.reddit.com/r/a/comments/1/x/');
    });
});

describe('web + app store collectors', () => {
    test('classifies URLs: reddit hand-off, competitor/own sites skipped, review sites kept', () => {
        expect(classifyUrl('https://www.reddit.com/r/x/comments/1/y/')).toBe('reddit');
        expect(classifyUrl('https://courtreserve.com/blog')).toBe('skip');
        expect(classifyUrl('https://www.waresport.com/blog/x')).toBe('skip');
        expect(classifyUrl('https://www.capterra.com/p/152562/CourtReserve/reviews/')).toBe('page');
        expect(classifyUrl('https://www.facebook.com/groups/123/posts/456')).toBe('skip');
        expect(classifyUrl('https://www.instagram.com/p/abc/')).toBe('skip');
        expect(classifyUrl('https://www.softwareadvice.com/scheduling/courtreserve-profile/vs/wix/')).toBe('skip');
        expect(classifyUrl('https://www.capterra.com/compare/152562-172591/CourtReserve-vs-Jackrabbit-Gymnastics')).toBe('skip');
        expect(sourceLabelFor('https://www.capterra.com/p/1')).toBe('Capterra');
    });

    test('pickApp matches on app or seller name, not just search rank', () => {
        const apps = [
            { appId: '1', name: 'Pickleball+', seller: 'Kyle' },
            { appId: '2', name: 'CourtReserve', seller: 'ASHTOW TECHNOLOGY GROUP LLC' },
        ];
        expect(pickApp(apps, courtreserve).appId).toBe('2');
        expect(pickApp([apps[0]], courtreserve)).toBeNull();
    });
});

describe('complaint miner pipeline', () => {
    test('end-to-end: collects, verifies quotes, builds leads, writes Excel and dedupes next run', async () => {
        mockRedditSearch.mockResolvedValue([
            { title: 'Court Reserve rant', url: POST_URL, raw: { subreddit: 'r/Pickleball', selftext: 'CourtReserve', comments: 5 } },
        ]);
        mockRedditRead.mockResolvedValue({ text: POST_TEXT });
        mockCompleteJson.mockResolvedValue({
            tokens: 321,
            json: {
                documentType: 'user_content',
                complaints: [{
                    competitor: 'CourtReserve',
                    quote: 'CourtReserve still double-books courts every week.',
                    painCategory: 'booking_scheduling',
                    severity: 4,
                    switchingIntent: 'none',
                    authorType: 'club_owner_admin',
                    organization: 'Sunset Pickleball Club',
                }],
            },
        });

        const outputDir = tmpDir();
        const options = { sources: ['reddit'], competitors: ['courtreserve'], outputDir, limits: fastLimits, log: noLog };
        const report = await ComplaintMinerService.run(options);

        expect(report.totals).toMatchObject({ newComplaints: 1, allComplaints: 1 });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(path.join(outputDir, 'complaint-miner.xlsx'));
        expect(wb.getWorksheet('Complaints').getCell('F2').value).toBe('CourtReserve still double-books courts every week.');
        expect(wb.getWorksheet('Leads')).toBeUndefined();

        // Second run: post already processed → nothing new, cumulative files kept.
        const second = await ComplaintMinerService.run(options);
        expect(second.totals).toMatchObject({ newComplaints: 0, allComplaints: 1 });
        expect(mockCompleteJson).toHaveBeenCalledTimes(1);

        // Export-only: rebuilds the workbook from the store without collecting.
        mockRedditSearch.mockClear();
        const exported = await ComplaintMinerService.run({ outputDir, exportOnly: true, log: noLog });
        expect(exported.totals).toMatchObject({ allComplaints: 1 });
        expect(mockRedditSearch).not.toHaveBeenCalled();
    });

    test('rejects unknown competitor keys', async () => {
        await expect(ComplaintMinerService.run({ competitors: ['nope'], outputDir: tmpDir(), log: noLog })).rejects.toThrow(/Unknown competitor/);
    });
});
