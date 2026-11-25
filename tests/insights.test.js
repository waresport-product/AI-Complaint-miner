'use strict';

const { enrichComplaint, deriveSport, deriveRegion } = require('../src/insights/enrich');
const { applyFilters } = require('../src/insights/filters');
const { trendStatus, windowCounts, buildTrends } = require('../src/insights/trends');
const { buildClusters, matchTheme } = require('../src/insights/clusters');
const { hotAccounts, hotConversations } = require('../src/insights/accounts');
const { buildPlaybooks } = require('../src/insights/playbooks');
const { buildInsights } = require('../src/insights');
const { verifyOrganization } = require('../src/services/complaint-analyzer-service');

const AS_OF = '2026-10-31T00:00:00.000Z';
const daysAgo = (n) => new Date(new Date(AS_OF).getTime() - n * 86400000).toISOString();

let seq = 0;
function complaint(overrides = {}) {
    seq += 1;
    return {
        id: `c${seq}`,
        competitorKey: 'teamsnap',
        competitorName: 'TeamSnap',
        quote: `Quote number ${seq} about the app being frustrating.`,
        painSummary: 'App is frustrating',
        painCategory: 'usability',
        painCategoryLabel: 'Ease of use',
        severity: 3,
        switchingIntent: 'none',
        authorType: 'player',
        source: 'reddit',
        sourceLabel: 'Reddit r/youthsoccer',
        url: `https://www.reddit.com/r/youthsoccer/comments/${seq}/x/`,
        publishedAt: daysAgo(5),
        foundAt: AS_OF,
        ...overrides,
    };
}

describe('enrichment: sport and region', () => {
    test('uses the stated sport, ignores non-sports, and infers from subreddit/text', () => {
        expect(deriveSport({ sport: 'Pickleball' })).toEqual({ sportTag: 'pickleball', sportSource: 'stated' });
        expect(deriveSport({ sport: 'sports', sourceLabel: 'Reddit r/tennis' })).toEqual({ sportTag: 'tennis', sportSource: 'inferred' });
        expect(deriveSport({ quote: 'Our yoga studio lost bookings' })).toEqual({ sportTag: 'fitness', sportSource: 'inferred' });
        expect(deriveSport({ quote: 'The app is slow' })).toEqual({ sportTag: null, sportSource: null });
    });

    test('derives region from stated location first, then the App Store storefront', () => {
        expect(deriveRegion({ location: 'Exton, Pennsylvania' })).toEqual({ region: 'US', regionSource: 'stated' });
        expect(deriveRegion({ location: 'Austin, TX' })).toEqual({ region: 'US', regionSource: 'stated' });
        expect(deriveRegion({ location: 'Madrid' })).toEqual({ region: 'Spain', regionSource: 'stated' });
        expect(deriveRegion({ sourceLabel: 'App Store (US)' })).toEqual({ region: 'US', regionSource: 'app_store_country' });
        expect(deriveRegion({ sourceLabel: 'App Store (CA)' })).toEqual({ region: 'Canada', regionSource: 'app_store_country' });
        expect(deriveRegion({ sourceLabel: 'App Store (GB)' })).toEqual({ region: 'UK', regionSource: 'app_store_country' });
        expect(applyFilters([enrichComplaint(complaint({ sourceLabel: 'App Store (CA)' })), enrichComplaint(complaint({ location: 'Toronto' }))], { region: 'Canada' })).toHaveLength(2);
        expect(deriveRegion({ sourceLabel: 'Trustpilot' })).toEqual({ region: null, regionSource: null });
    });

    test('adds segment and posted month', () => {
        const e = enrichComplaint(complaint({ publishedAt: '2026-09-14T00:00:00Z' }));
        expect(e).toMatchObject({ segment: 'team_league', postedMonth: '2026-09', sportTag: 'soccer' });
    });
});

describe('filters', () => {
    const list = [
        enrichComplaint(complaint({ leadTier: 'Hot' })),
        enrichComplaint(complaint({ competitorKey: 'mindbody', competitorName: 'Mindbody', sourceLabel: 'App Store (US)', source: 'appstore', leadTier: 'Cold' })),
    ];

    test('filter by competitor, segment, sport, region, tier (case-insensitive, comma lists)', () => {
        expect(applyFilters(list, { competitor: 'TEAMSNAP' })).toHaveLength(1);
        expect(applyFilters(list, { segment: 'facility' })[0].competitorKey).toBe('mindbody');
        expect(applyFilters(list, { sport: 'soccer' })).toHaveLength(1);
        expect(applyFilters(list, { region: 'us' })[0].competitorKey).toBe('mindbody');
        expect(applyFilters(list, { tier: 'hot,warm' })).toHaveLength(1);
        expect(applyFilters(list, {})).toHaveLength(2);
    });

    test('since filter uses post date', () => {
        const old = enrichComplaint(complaint({ publishedAt: '2025-01-01T00:00:00Z' }));
        expect(applyFilters([...list, old], { since: '2026-01-01' })).toHaveLength(2);
    });
});

describe('trends', () => {
    test('status rules', () => {
        expect(trendStatus(4, 0)).toBe('new');
        expect(trendStatus(6, 2)).toBe('rising');
        expect(trendStatus(1, 4)).toBe('falling');
        expect(trendStatus(2, 2)).toBe('steady');
        expect(trendStatus(2, 0)).toBe('steady'); // too few to call
    });

    test('counts the recent window vs the average of the two before; ignores undated', () => {
        const asOfMs = new Date(AS_OF).getTime();
        const list = [
            ...[1, 3, 5, 7, 9, 11].map((d) => complaint({ publishedAt: daysAgo(d) })),
            ...[40, 70].map((d) => complaint({ publishedAt: daysAgo(d) })),
            complaint({ publishedAt: null }),
        ];
        expect(windowCounts(list, asOfMs)).toMatchObject({ recent: 6, priorAvg: 1, status: 'rising', changePct: 500 });
    });

    test('movers list only rising/new competitor × pain combinations', () => {
        const list = [
            ...[1, 2, 3, 4].map((d) => complaint({ painCategory: 'pricing_fees', painCategoryLabel: 'Pricing & fees', publishedAt: daysAgo(d) })),
            complaint({ publishedAt: daysAgo(50) }),
        ];
        const trends = buildTrends(list, { asOf: AS_OF });
        expect(trends.movers).toHaveLength(1);
        expect(trends.movers[0]).toMatchObject({ competitorKey: 'teamsnap', painCategory: 'pricing_fees', status: 'new' });
        expect(trends.competitors[0].series).toHaveLength(12);
        expect(trends.competitors[0].series[11]).toMatchObject({ month: '2026-10', count: 4 });
    });
});

describe('issue clusters', () => {
    test('matches named themes from summary or quote', () => {
        expect(matchTheme({ painSummary: 'Only an AI chatbot, no human support' }).key).toBe('ai-chatbot-support');
        expect(matchTheme({ painSummary: 'Refund denied after cancellation' }).key).toBe('refunds');
        expect(matchTheme({ quote: 'Way too many ads in the app' }).key).toBe('ads');
        expect(matchTheme({ painSummary: 'Something unrelated entirely' })).toBeNull();
    });

    test('groups across competitors; leftovers become emerging or other clusters', () => {
        const list = [
            complaint({ painSummary: 'Refund refused' }),
            complaint({ competitorKey: 'playtomic', competitorName: 'Playtomic', painSummary: 'Refund never arrived' }),
            ...[1, 2, 3, 4].map(() => complaint({ painCategory: 'missing_features', painCategoryLabel: 'Missing features', painSummary: 'No waitlist automation for classes' })),
            complaint({ painCategory: 'missing_features', painCategoryLabel: 'Missing features', painSummary: 'Wants a darker theme' }),
        ].map((c) => ({ ...c, leadScore: 5, leadTier: 'Cold' }));

        const clusters = buildClusters(list, { asOf: AS_OF });
        const refunds = clusters.find((c) => c.id === 'refunds');
        expect(refunds).toMatchObject({ kind: 'known', count: 2 });
        expect(refunds.competitors.map((x) => x.competitorKey).sort()).toEqual(['playtomic', 'teamsnap']);
        expect(clusters.find((c) => c.kind === 'emerging')).toMatchObject({ count: 4 });
        expect(clusters.find((c) => c.kind === 'other')).toMatchObject({ count: 1 });
        expect(clusters[0].kind).toBe('known');
    });
});

describe('accounts and conversations', () => {
    test('only verified organizations become hot accounts', () => {
        const list = [
            complaint({ organization: 'Sunset Club', organizationVerified: true, leadScore: 18, leadTier: 'Hot' }),
            complaint({ organization: 'The HOP', organizationVerified: false, leadScore: 20, leadTier: 'Hot' }),
            complaint({ organization: 'Legacy Club', leadScore: 20, leadTier: 'Hot' }),
        ];
        const accounts = hotAccounts(list);
        expect(accounts.map((a) => a.organization)).toEqual(['Sunset Club']);
    });

    test('conversations group by thread, skip App Store, rank by intent', () => {
        const thread = 'https://www.reddit.com/r/gymowner/comments/abc/leaving_mindbody/';
        const list = [
            complaint({ url: thread, switchingIntent: 'considering', authorType: 'club_owner_admin', leadScore: 19, leadTier: 'Hot' }),
            complaint({ url: thread, switchingIntent: 'considering', leadScore: 12, leadTier: 'Warm' }),
            complaint({ url: 'https://apps.apple.com/app/1', source: 'appstore', leadScore: 20, leadTier: 'Hot' }),
            complaint({ leadScore: 4, leadTier: 'Cold' }),
        ];
        const conversations = hotConversations(list);
        expect(conversations).toHaveLength(1);
        expect(conversations[0]).toMatchObject({ url: thread, complaintCount: 2, considering: 2, decisionMakers: 1 });
    });
});

describe('playbooks', () => {
    test('rank pains by weighted evidence with proof quotes, angle and discovery questions', () => {
        const list = [
            ...[1, 2, 3].map(() => complaint({ painCategory: 'usability', painCategoryLabel: 'Ease of use', leadScore: 6, leadTier: 'Cold' })),
            ...[1, 2].map(() => complaint({ painCategory: 'pricing_fees', painCategoryLabel: 'Pricing & fees', leadScore: 18, leadTier: 'Hot', switchingIntent: 'considering' })),
        ];
        const [playbook] = buildPlaybooks(list, { asOf: AS_OF });
        expect(playbook.competitorName).toBe('TeamSnap');
        expect(playbook.topPains[0].painCategory).toBe('pricing_fees');
        expect(playbook.topPains[0].proof[0].quote).toBeTruthy();
        expect(playbook.topPains[0].waresportAngle).toBeTruthy();
        expect(playbook.topPains[0].discoveryQuestions.length).toBeGreaterThan(0);
        expect(playbook.opener).toContain('pricing & fees');
        expect(playbook.opener).toMatch(/^Public reviews and posts about /);
        expect(playbook.consideringPct).toBe(40);
    });

    test('skips competitors with too little evidence', () => {
        expect(buildPlaybooks([complaint()], { asOf: AS_OF })).toEqual([]);
    });
});

describe('buildInsights', () => {
    test('scores, enriches, filters and returns a versioned payload', () => {
        const list = [
            complaint({ severity: 5, authorType: 'club_owner_admin', switchingIntent: 'considering' }),
            complaint({ competitorKey: 'mindbody', competitorName: 'Mindbody' }),
        ];
        const all = buildInsights(list, { asOf: AS_OF });
        expect(all).toMatchObject({ schemaVersion: 1, asOf: AS_OF });
        expect(all.totals).toMatchObject({ complaints: 2, hot: 1, considering: 1, competitors: 2 });
        expect(all.competitorMap[0].competitorKey).toBe('teamsnap');
        expect(all.filterOptions.competitor).toEqual(['mindbody', 'teamsnap']);

        const one = buildInsights(list, { asOf: AS_OF, filters: { competitor: 'mindbody' } });
        expect(one.totals.complaints).toBe(1);
        expect(one.filterOptions.competitor).toHaveLength(2); // options always reflect all data
    });
});

describe('organization verification', () => {
    const chunk = [
        'Reviewed May 2019',
        'The HOP',
        'Cons: We would like the software to provide a point of sale option.',
        'I run Sunset Pickleball Club in Austin and the booking page keeps failing.',
    ].join('\n');

    test('accepts a verbatim sentence that names the club', () => {
        const r = verifyOrganization({ organization: 'Sunset Pickleball Club', organizationEvidence: 'I run Sunset Pickleball Club in Austin and the booking page keeps failing.' }, chunk);
        expect(r).toMatchObject({ organization: 'Sunset Pickleball Club', organizationVerified: true });
    });

    test('rejects a bare headline, a paraphrase, or missing evidence (keeps the name, unverified)', () => {
        expect(verifyOrganization({ organization: 'The HOP', organizationEvidence: 'The HOP' }, chunk).organizationVerified).toBe(false);
        expect(verifyOrganization({ organization: 'Sunset Pickleball Club', organizationEvidence: 'The author runs Sunset Pickleball Club.' }, chunk).organizationVerified).toBe(false);
        expect(verifyOrganization({ organization: 'Sunset Pickleball Club' }, chunk)).toMatchObject({ organizationVerified: false, organizationEvidence: null });
        expect(verifyOrganization({ organization: null }, chunk)).toEqual({ organization: null, organizationVerified: false, organizationEvidence: null });
    });
});
