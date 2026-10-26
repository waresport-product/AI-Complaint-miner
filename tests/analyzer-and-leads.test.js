'use strict';

const mockCompleteJson = jest.fn();

jest.mock('../src/clients/llm-client', () => ({
    isConfigured: () => true,
    getProvider: () => 'gemini',
    getModel: () => 'test-model',
    completeJson: (...args) => mockCompleteJson(...args),
}));

const { analyzeDocument, resolveCompetitor } = require('../src/services/complaint-analyzer-service');
const { scoreComplaint, buildLeads } = require('../src/services/lead-builder-service');
const { COMPETITORS } = require('../src/constants');

const SOURCE_TEXT = [
    'Title: Court Reserve rant',
    'I run Sunset Pickleball Club in Austin. CourtReserve double-booked our courts three times this month and support took a week to reply.',
    'We are seriously looking at other platforms before our renewal.',
].join('\n');

function doc(overrides = {}) {
    return {
        id: 'doc1',
        source: 'reddit',
        sourceLabel: 'Reddit r/Pickleball',
        url: 'https://www.reddit.com/r/Pickleball/comments/abc/court_reserve_rant/',
        title: 'Court Reserve rant',
        text: SOURCE_TEXT,
        publishedAt: new Date().toISOString(),
        competitorKeys: ['courtreserve'],
        ...overrides,
    };
}

beforeEach(() => mockCompleteJson.mockReset());

describe('complaint analyzer', () => {
    test('keeps verbatim quotes, drops paraphrased/unknown ones and coerces enums', async () => {
        mockCompleteJson.mockResolvedValue({
            tokens: 500,
            json: {
                documentType: 'user_content',
                complaints: [
                    {
                        competitor: 'Court Reserve',
                        quote: 'CourtReserve double-booked our courts three times this month and support took a week to reply.',
                        painSummary: 'Double bookings and slow support',
                        painCategory: 'booking_scheduling',
                        severity: 9,
                        switchingIntent: 'considering',
                        authorType: 'club_owner_admin',
                        organization: 'Sunset Pickleball Club',
                        location: 'Austin',
                        sport: 'pickleball',
                    },
                    { competitor: 'CourtReserve', quote: 'Their software is the worst thing ever made.', painCategory: 'usability' },
                    { competitor: 'SomeOtherTool', quote: 'We are seriously looking at other platforms before our renewal.' },
                    { competitor: 'courtreserve', quote: 'We are seriously looking at other platforms before our renewal.', painCategory: 'nonsense', authorType: 'ceo' },
                ],
            },
        });

        const result = await analyzeDocument(doc(), COMPETITORS);

        expect(result.complaints).toHaveLength(2);
        expect(result.rejected).toBe(2);
        const [first, second] = result.complaints;
        expect(first).toMatchObject({
            competitorKey: 'courtreserve',
            competitorName: 'CourtReserve',
            severity: 5,
            organization: 'Sunset Pickleball Club',
            painCategoryLabel: 'Booking & scheduling',
            url: doc().url,
        });
        expect(first.waresportAngle).toBeTruthy();
        expect(second).toMatchObject({ painCategory: 'other', authorType: 'unknown', organization: null });
    });

    test('discards vendor marketing pages entirely', async () => {
        mockCompleteJson.mockResolvedValue({
            tokens: 100,
            json: {
                documentType: 'vendor_marketing',
                complaints: [{ competitor: 'CourtReserve', quote: 'CourtReserve double-booked our courts three times this month' }],
            },
        });
        const result = await analyzeDocument(doc(), COMPETITORS);
        expect(result.documentType).toBe('vendor_marketing');
        expect(result.complaints).toEqual([]);
    });

    test('maps batched app-store quotes back to their review segment', async () => {
        const segments = [
            { text: 'Fine\nWorks ok for me.', url: 'https://apps.apple.com/app/1', publishedAt: '2026-01-01T00:00:00Z' },
            { text: 'Crashes\nThe app crashes every time I try to pay for a court.', url: 'https://apps.apple.com/app/1', publishedAt: '2026-02-02T00:00:00Z' },
        ];
        mockCompleteJson.mockResolvedValue({
            tokens: 100,
            json: {
                documentType: 'user_content',
                complaints: [{ competitor: '', quote: 'The app crashes every time I try to pay for a court.', painCategory: 'reliability_bugs' }],
            },
        });
        const result = await analyzeDocument(
            doc({ source: 'appstore', text: segments.map((s) => s.text).join('\n\n'), segments, competitorHint: 'CourtReserve', publishedAt: null }),
            COMPETITORS
        );
        expect(result.complaints).toHaveLength(1);
        expect(result.complaints[0]).toMatchObject({ competitorKey: 'courtreserve', publishedAt: '2026-02-02T00:00:00Z' });
    });

    test('resolveCompetitor matches names, keys and aliases loosely', () => {
        expect(resolveCompetitor('court reserve', COMPETITORS).key).toBe('courtreserve');
        expect(resolveCompetitor('Play By Point', COMPETITORS).key).toBe('playbypoint');
        expect(resolveCompetitor('', COMPETITORS)).toBeNull();
    });
});

describe('lead builder', () => {
    const base = {
        competitorName: 'CourtReserve',
        painCategory: 'booking_scheduling',
        sourceLabel: 'Reddit',
        url: 'https://example.com',
        foundAt: '2026-10-01T00:00:00Z',
        publishedAt: null,
    };

    test('scores owners who are considering switching as Hot and players as lower', () => {
        const owner = scoreComplaint({ ...base, severity: 4, authorType: 'club_owner_admin', switchingIntent: 'considering', organization: 'X' });
        const player = scoreComplaint({ ...base, severity: 2, authorType: 'player', switchingIntent: 'none', organization: null });
        expect(owner.leadTier).toBe('Hot');
        expect(player.leadTier).toBe('Cold');
        expect(owner.leadScore).toBeGreaterThan(player.leadScore);
    });

    test('groups complaints per organization and ignores ones without an org', () => {
        const complaints = [
            { ...base, id: '1', severity: 3, authorType: 'player', switchingIntent: 'none', organization: 'Sunset Pickleball Club', quote: 'q1' },
            { ...base, id: '2', severity: 5, authorType: 'club_staff', switchingIntent: 'considering', organization: 'The Sunset Pickleball Club LLC', quote: 'q2', painCategory: 'payments_billing' },
            { ...base, id: '3', severity: 5, authorType: 'player', switchingIntent: 'none', organization: null, quote: 'q3' },
        ].map((c) => scoreComplaint(c));

        const leads = buildLeads(complaints);
        expect(leads).toHaveLength(1);
        expect(leads[0]).toMatchObject({
            complaintCount: 2,
            topQuote: 'q2',
            switchingIntent: 'considering',
            painPoints: ['Booking & scheduling', 'Payments & billing'],
        });
    });
});
