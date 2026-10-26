"use strict";

/**
 * Competitor Complaint Miner — static configuration.
 *
 * Competitors, pain categories and WareSport talking points live here so sales/product
 * can extend them without touching collector or analyzer code.
 */

const SEGMENTS = Object.freeze({
    racquet: "racquet",
    team_league: "team_league",
    facility: "facility",
});

/**
 * aliases     — spellings people actually write; used for search queries AND the
 *               relevance filter (a document must mention one of them).
 * domains     — the competitor's own sites; never treated as user complaints.
 * appStore    — terms used to find the iOS app; matched against app/seller name.
 * contextTerms — words added to Reddit searches to cut noise for generic names.
 */
const COMPETITORS = Object.freeze([
    {
        key: "courtreserve",
        name: "CourtReserve",
        segment: SEGMENTS.racquet,
        aliases: ["CourtReserve", "Court Reserve"],
        domains: ["courtreserve.com"],
        appStore: { term: "CourtReserve", match: ["courtreserve", "ashtow"] },
        contextTerms: ["pickleball", "tennis", "club"],
    },
    {
        key: "podplay",
        name: "PodPlay",
        segment: SEGMENTS.racquet,
        aliases: ["PodPlay", "Pod Play"],
        domains: ["podplay.app", "podplay.com"],
        appStore: { term: "PodPlay", match: ["podplay"] },
        contextTerms: ["pickleball", "padel", "club"],
    },
    {
        key: "playbypoint",
        name: "Playbypoint",
        segment: SEGMENTS.racquet,
        aliases: ["Playbypoint", "Play by Point", "PlayByPoint"],
        domains: ["playbypoint.com"],
        appStore: { term: "Playbypoint", match: ["playbypoint", "play by point"] },
        contextTerms: ["pickleball", "tennis", "club"],
    },
    {
        key: "playtomic",
        name: "Playtomic",
        segment: SEGMENTS.racquet,
        aliases: ["Playtomic"],
        domains: ["playtomic.io", "playtomic.com"],
        appStore: { term: "Playtomic", match: ["playtomic"] },
        contextTerms: ["padel", "pickleball", "tennis"],
    },
    {
        key: "clubautomation",
        name: "Club Automation",
        segment: SEGMENTS.racquet,
        aliases: ["Club Automation", "ClubAutomation"],
        domains: ["clubautomation.com"],
        appStore: { term: "Club Automation", match: ["club automation", "clubautomation"] },
        contextTerms: ["club", "tennis", "software"],
    },
    {
        key: "skedda",
        name: "Skedda",
        segment: SEGMENTS.racquet,
        aliases: ["Skedda"],
        domains: ["skedda.com"],
        appStore: null,
        contextTerms: ["booking", "court"],
    },
    {
        key: "teamsnap",
        name: "TeamSnap",
        segment: SEGMENTS.team_league,
        aliases: ["TeamSnap", "Team Snap"],
        domains: ["teamsnap.com"],
        appStore: { term: "TeamSnap", match: ["teamsnap"] },
        contextTerms: ["club", "league", "coach"],
    },
    {
        key: "leagueapps",
        name: "LeagueApps",
        segment: SEGMENTS.team_league,
        aliases: ["LeagueApps", "League Apps"],
        domains: ["leagueapps.com"],
        appStore: { term: "LeagueApps", match: ["leagueapps"] },
        contextTerms: ["club", "league", "registration"],
    },
    {
        key: "sportsengine",
        name: "SportsEngine",
        segment: SEGMENTS.team_league,
        aliases: ["SportsEngine", "Sports Engine"],
        domains: ["sportsengine.com"],
        appStore: { term: "SportsEngine", match: ["sportsengine", "sports engine"] },
        contextTerms: ["club", "league", "registration"],
    },
    {
        key: "jerseywatch",
        name: "Jersey Watch",
        segment: SEGMENTS.team_league,
        aliases: ["Jersey Watch", "JerseyWatch"],
        domains: ["jerseywatch.com"],
        appStore: null,
        contextTerms: ["league", "website", "registration"],
    },
    {
        key: "upperhand",
        name: "Upper Hand",
        segment: SEGMENTS.team_league,
        aliases: ["Upper Hand software", "UpperHand"],
        domains: ["upperhand.com"],
        appStore: { term: "Upper Hand", match: ["upper hand", "upperhand"] },
        contextTerms: ["facility", "software", "booking"],
    },
    {
        key: "clubready",
        name: "ClubReady",
        segment: SEGMENTS.facility,
        aliases: ["ClubReady", "Club Ready"],
        domains: ["clubready.com"],
        appStore: { term: "ClubReady", match: ["clubready"] },
        contextTerms: ["gym", "software", "billing"],
    },
    {
        key: "jonasclub",
        name: "Jonas Club",
        segment: SEGMENTS.facility,
        aliases: ["Jonas Club", "Jonas Club Software"],
        domains: ["jonasclub.com"],
        appStore: null,
        contextTerms: ["club", "software"],
    },
    {
        key: "mindbody",
        name: "Mindbody",
        segment: SEGMENTS.facility,
        aliases: ["Mindbody", "MindBody", "Mind Body Online"],
        domains: ["mindbodyonline.com", "mindbody.io"],
        appStore: { term: "Mindbody Business", match: ["mindbody"] },
        contextTerms: ["gym", "studio", "software"],
    },
    // ── Added Oct 2026: more club/league/facility platforms in WareSport's space ──
    {
        key: "playmetrics",
        name: "PlayMetrics",
        segment: SEGMENTS.team_league,
        aliases: ["PlayMetrics", "Play Metrics"],
        domains: ["playmetrics.com"],
        appStore: { term: "PlayMetrics", match: ["playmetrics"] },
        contextTerms: ["soccer", "club", "registration"],
    },
    {
        key: "gotsport",
        name: "GotSport",
        segment: SEGMENTS.team_league,
        aliases: ["GotSport", "Got Sport"],
        domains: ["gotsport.com"],
        appStore: { term: "GotSport", match: ["gotsport"] },
        contextTerms: ["soccer", "club", "tournament"],
    },
    {
        key: "teamlinkt",
        name: "TeamLinkt",
        segment: SEGMENTS.team_league,
        aliases: ["TeamLinkt"],
        domains: ["teamlinkt.com"],
        appStore: { term: "TeamLinkt", match: ["teamlinkt"] },
        contextTerms: ["league", "club", "registration"],
    },
    {
        key: "demosphere",
        name: "Demosphere",
        segment: SEGMENTS.team_league,
        aliases: ["Demosphere"],
        domains: ["demosphere.com"],
        appStore: null,
        contextTerms: ["soccer", "league", "website"],
    },
    {
        key: "clubspark",
        name: "ClubSpark",
        segment: SEGMENTS.racquet,
        aliases: ["ClubSpark", "Club Spark"],
        domains: ["clubspark.com", "clubspark.lta.org.uk"],
        appStore: { term: "ClubSpark", match: ["clubspark"] },
        contextTerms: ["tennis", "club", "booking"],
    },
    {
        key: "matchi",
        name: "MATCHi",
        segment: SEGMENTS.racquet,
        aliases: ["MATCHi"],
        domains: ["matchi.se", "matchi.com"],
        appStore: { term: "MATCHi", match: ["matchi"] },
        contextTerms: ["padel", "tennis", "booking"],
    },
    {
        key: "pike13",
        name: "Pike13",
        segment: SEGMENTS.facility,
        aliases: ["Pike13", "Pike 13"],
        domains: ["pike13.com"],
        appStore: { term: "Pike13", match: ["pike13"] },
        contextTerms: ["studio", "gym", "software"],
    },
    {
        key: "daxko",
        name: "Daxko",
        segment: SEGMENTS.facility,
        aliases: ["Daxko"],
        domains: ["daxko.com"],
        appStore: null,
        contextTerms: ["ymca", "gym", "software"],
    },
]);

const PAIN_CATEGORIES = Object.freeze({
    booking_scheduling: "Booking & scheduling",
    payments_billing: "Payments & billing",
    pricing_fees: "Pricing & fees",
    customer_support: "Customer support",
    reliability_bugs: "Reliability & bugs",
    usability: "Ease of use",
    communication: "Communication & notifications",
    membership_management: "Membership management",
    reporting: "Reporting & analytics",
    integrations: "Integrations",
    onboarding_migration: "Onboarding & migration",
    contract_lockin: "Contract & lock-in",
    missing_features: "Missing features",
    other: "Other",
});

/**
 * One-line talking point per pain category, drawn from WareSport features (as of the
 * WareSport backend, Oct 2026). Sales should verify wording before quoting it to a prospect.
 */
const WARESPORT_ANGLES = Object.freeze({
    booking_scheduling: "AI schedule generation with conflict/blackout detection, facility calendar with double-booking checks, waitlists.",
    payments_billing: "Built-in Stripe payments: autopay memberships, installments, ACH/Apple Pay/Google Pay, refunds and credits.",
    pricing_fees: "Configurable fee pass-through and transparent subscription plans.",
    customer_support: "Guided onboarding checklist, in-app help center and support playbook.",
    reliability_bugs: "Modern serverless platform with a native mobile app for admins, coaches, players and parents.",
    usability: "One admin panel for programs, facility, payments, website and comms — plus a mobile app.",
    communication: "Email, SMS and WhatsApp messaging with scheduling, smart tags and newsletters.",
    membership_management: "Memberships, passes, packs/credits, family accounts and promo codes.",
    reporting: "AI reporting agent (ask in plain English), dashboards and revenue reporting.",
    integrations: "QuickBooks sync, Google Meet, Discord, access control and a public integrations API.",
    onboarding_migration: "Guided onboarding checklist and bulk athlete/team imports.",
    contract_lockin: "Flexible plans — lead with an easy migration offer.",
    missing_features: "All-in-one: events, leagues, ladders, tryouts, facility booking, pro shop, website builder, AI employees.",
    other: "All-in-one sports club platform — tailor the pitch to the quote.",
});

const AUTHOR_TYPES = Object.freeze([
    "club_owner_admin",
    "club_staff",
    "coach",
    "player",
    "parent",
    "unknown",
]);

const SWITCHING_INTENT = Object.freeze(["considering", "switched_away", "none"]);

const SOURCES = Object.freeze({
    reddit: "reddit",
    web: "web",
    appstore: "appstore",
});

/**
 * Firecrawl web search templates. {name} = quoted alias, {exclude} = -site: for the
 * competitor's own domains. Kept to three queries per competitor to bound credit use.
 * recent: restrict to the past year (review-site product pages are evergreen, so not filtered;
 * individual review dates are checked by the analyzer instead).
 */
const WEB_QUERY_TEMPLATES = Object.freeze([
    {
        label: "Review sites search",
        query: "{name} reviews cons (site:capterra.com OR site:g2.com OR site:softwareadvice.com OR site:getapp.com OR site:trustpilot.com)",
        recent: false,
    },
    {
        label: "Complaint keywords search",
        query: "{name} (frustrating OR terrible OR worst OR glitch OR \"switching from\" OR \"moving away\") club {exclude}",
        recent: true,
    },
    {
        // Facebook/Instagram pages can't be scraped, so look for forum/community threads instead
        // (Reddit hits are handed to the Reddit collector).
        label: "Forums search",
        query: "{name} (problems OR \"customer service\" OR \"looking for\" OR alternative) (forum OR community OR reddit) {exclude}",
        recent: true,
    },
]);

/** Domains that are never user complaints (our own site, video, generic aggregators). */
const WEB_EXCLUDED_DOMAINS = Object.freeze([
    "waresport.com",
    "youtube.com",
    "youtu.be",
    "linkedin.com",
    "wikipedia.org",
    "apps.apple.com",
]);

const DEFAULTS = Object.freeze({
    outputDir: "output/complaint-miner",
    // Complaints posted longer ago than this are dropped (override: COMPLAINT_MINER_MAX_AGE_DAYS).
    maxReviewAgeDays: 730,
    // Firecrawl/Google time filter for forum + Facebook searches ("qdr:y" = past year).
    webRecentTbs: "qdr:y",
    llmModels: Object.freeze({ gemini: "gemini-3.5-flash", openai: "gpt-4o-mini" }),
    llmTimeoutMs: 90000,
    llmConcurrency: 3,
    llmMaxCharsPerChunk: 12000,
    maxDocCharsTotal: 36000,
    redditQueriesPerCompetitor: 2,
    redditReadsPerCompetitor: 5,
    redditSearchLimit: 10,
    webSearchLimit: 8,
    webScrapesPerCompetitor: 6,
    appStoreCountries: ["us"],
    appStorePages: 2,
    appStoreMaxRating: 3,
    appStoreReviewsPerDoc: 25,
    agentReachTimeoutMs: 240000,
    agentReachSearchSpacingMs: 11000,
    agentReachReadSpacingMs: 4000,
    agentReachRetryWaitMs: 20000,
});

function getMaxReviewAgeDays() {
    const fromEnv = Number(process.env.COMPLAINT_MINER_MAX_AGE_DAYS);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULTS.maxReviewAgeDays;
}

module.exports = {
    getMaxReviewAgeDays,
    SEGMENTS,
    COMPETITORS,
    PAIN_CATEGORIES,
    WARESPORT_ANGLES,
    AUTHOR_TYPES,
    SWITCHING_INTENT,
    SOURCES,
    WEB_QUERY_TEMPLATES,
    WEB_EXCLUDED_DOMAINS,
    DEFAULTS,
};
