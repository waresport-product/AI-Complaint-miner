'use strict';

const mockSearch = jest.fn();

jest.mock('../src/clients/firecrawl-client', () => ({
    isConfigured: () => true,
    search: (...args) => mockSearch(...args),
    scrape: async () => ({ markdown: '', title: '', publishedAt: null }),
}));

const { parsePostedDate, isOlderThan } = require('../src/helpers/text.helper');
const { validateComplaints } = require('../src/services/complaint-analyzer-service');
const { WebCollector } = require('../src/collectors/web-collector');
const { COMPETITORS } = require('../src/constants');

const NOW = Date.UTC(2026, 9, 25);
const CHUNK = 'Booking is broken every single weekend for our members. Support never answers the phone at all.';
const doc = { source: 'web', sourceLabel: 'Capterra', url: 'https://www.capterra.com/p/1/reviews/', title: 't', publishedAt: null };

function complaint(overrides) {
    return {
        competitor: 'CourtReserve',
        quote: 'Booking is broken every single weekend for our members.',
        painCategory: 'booking_scheduling',
        severity: 5,
        ...overrides,
    };
}

describe('posted-date parsing', () => {
    test('accepts full, month and year dates; rejects junk and future dates', () => {
        expect(parsePostedDate('2025-03-14', NOW)).toBe('2025-03-14T00:00:00.000Z');
        expect(parsePostedDate('2019-05', NOW)).toBe('2019-05-01T00:00:00.000Z');
        expect(parsePostedDate('2024', NOW)).toBe('2024-01-01T00:00:00.000Z');
        expect(parsePostedDate('2026-10-22T08:58:20-07:00', NOW)).toBe('2026-10-22T15:58:20.000Z');
        expect(parsePostedDate('recently', NOW)).toBeNull();
        expect(parsePostedDate('2030-01-01', NOW)).toBeNull();
        expect(parsePostedDate(null, NOW)).toBeNull();
    });

    test('isOlderThan ignores missing dates', () => {
        expect(isOlderThan('2019-05-01T00:00:00Z', 730, NOW)).toBe(true);
        expect(isOlderThan('2026-01-01T00:00:00Z', 730, NOW)).toBe(false);
        expect(isOlderThan(null, 730, NOW)).toBe(false);
    });
});

describe('analyzer freshness + trust rules', () => {
    const ctx = { doc, chunk: CHUNK, competitors: COMPETITORS, foundAt: '2026-10-25T00:00:00Z', maxAgeDays: 730 };

    test('drops complaints whose review date is older than the cutoff', () => {
        const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const { complaints, tooOld } = validateComplaints([
            complaint({ postedDate: '2019-05' }),
            complaint({ quote: 'Support never answers the phone at all.', postedDate: recent }),
        ], ctx);
        expect(tooOld).toBe(1);
        expect(complaints).toHaveLength(1);
        expect(complaints[0].publishedAt.slice(0, 10)).toBe(recent);
    });

    test('keeps undated complaints (date unknown, not old)', () => {
        const { complaints, tooOld } = validateComplaints([complaint({ postedDate: null })], ctx);
        expect(tooOld).toBe(0);
        expect(complaints[0].publishedAt).toBeNull();
    });

    test('caps severity for cons in 4-5 star reviews and records the rating', () => {
        const { complaints } = validateComplaints([
            complaint({ reviewRating: 5, severity: 4 }),
            complaint({ quote: 'Support never answers the phone at all.', reviewRating: 2, severity: 4 }),
        ], ctx);
        expect(complaints[0]).toMatchObject({ reviewRating: 5, severity: 2 });
        expect(complaints[1]).toMatchObject({ reviewRating: 2, severity: 4 });
    });

    test('collector dates and ratings (App Store segments) win over LLM guesses', () => {
        const segDoc = {
            ...doc,
            segments: [{ text: CHUNK, url: 'https://apps.apple.com/x', publishedAt: '2026-09-01T00:00:00Z', rating: 1 }],
        };
        const { complaints } = validateComplaints([complaint({ postedDate: '2019-01', reviewRating: 5 })], { ...ctx, doc: segDoc });
        expect(complaints[0]).toMatchObject({ publishedAt: '2026-09-01T00:00:00Z', reviewRating: 1, severity: 5 });
    });
});

describe('web collector recency filter', () => {
    test('forum searches are limited to the past year; review-site search is not', async () => {
        mockSearch.mockResolvedValue([]);
        const store = { hasProcessed: () => false };
        const collector = new WebCollector({ store, log: () => {} });
        await collector.searchCompetitor(COMPETITORS.find((c) => c.key === 'podplay'));

        const tbsByQuery = mockSearch.mock.calls.map(([query, opts]) => [query.slice(0, 20), opts.tbs]);
        expect(tbsByQuery[0][1]).toBeUndefined();
        expect(tbsByQuery[1][1]).toBe('qdr:y');
        expect(tbsByQuery[2][1]).toBe('qdr:y');
        expect(mockSearch.mock.calls[0][0]).toContain('"PodPlay"');
    });
});
