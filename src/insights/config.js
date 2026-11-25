"use strict";

/**
 * Market-intelligence settings: trend thresholds, sport/region inference, discovery questions.
 * Collection settings stay in ../constants.js.
 */

const INSIGHTS_SCHEMA_VERSION = 1;

const TRENDS = Object.freeze({
    // Recent window vs. the average of the two windows before it.
    windowDays: 30,
    priorWindows: 2,
    // Ignore movements on tiny numbers.
    minRecent: 3,
    risingRatio: 1.5,
    fallingRatio: 0.5,
    // Monthly series length for charts.
    seriesMonths: 12,
});

const CLUSTERS = Object.freeze({
    // Leftovers (no known theme) are grouped by recurring 2-word phrases within their category;
    // a phrase needs this many complaints to become an emerging theme.
    minEmergingSize: 4,
    maxEmergingPerCategory: 3,
    examplesPerCluster: 3,
});

/**
 * Known issue themes, matched against each complaint's pain summary + quote. First match wins,
 * so specific themes come before broad ones. Add a theme here when a new issue keeps showing up
 * under "Emerging" clusters.
 */
const THEMES = Object.freeze([
    { key: "ai-chatbot-support", label: "AI chatbot instead of human support", patterns: [/chat\s?bot/i, /\bbot\b/i, /\bai (support|agent|assistant)\b/i, /\b(no|any|reach|real|a) human\b/i] },
    { key: "slow-no-support", label: "Poor, slow or no support", patterns: [/unresponsive/i, /no (response|reply|answer)/i, /never (respond|repl|answer|got back)/i, /ignor(ed|ing)/i, /slow (customer )?(support|service|response)/i, /(can'?t|unable to|hard to|impossible to) (reach|contact|get hold)/i, /\bticket/i, /\b(poor|bad|terrible|awful|horrible|lack of|no|unhelpful)\b.{0,15}\b(customer )?(support|service)\b/i] },
    { key: "refunds", label: "Refunds refused or delayed", patterns: [/refund/i] },
    { key: "contract-cancellation", label: "Contracts, cancellation & auto-renewal", patterns: [/contract/i, /cancel(l?ation|l?ing)? (fee|policy|subscription|membership|plan)/i, /auto[\s-]?renew/i, /\brenew(al|ed)\b/i, /lock(ed)?[\s-]in/i, /buy (them|us) out/i] },
    { key: "fees-price-increases", label: "Fees & price increases", patterns: [/\bfees?\b/i, /price (increase|hike)/i, /expensive/i, /pric(e|ey|ing) (went|go(es)?) up/i, /overpriced/i, /\bcost(ly|s)?\b/i, /surcharge/i] },
    { key: "billing-errors", label: "Wrong or double charges", patterns: [/(double|over|wrong(ly)?|incorrect(ly)?|unauthori[sz]ed) charg/i, /charged (twice|again|full)/i, /billing error/i, /payment (failed|failure|declined)/i] },
    { key: "ads", label: "In-app ads", patterns: [/\bads?\b/i, /advert/i] },
    { key: "outages", label: "Outages & downtime", patterns: [/outage/i, /\b(went|is|was|goes) down\b/i, /downtime/i, /\boffline\b/i] },
    { key: "crashes", label: "Crashes, freezes & slowness", patterns: [/crash/i, /freez/i, /blank screen/i, /\blag(s|gy|ging)?\b/i, /\bslow\b/i, /won'?t (load|open)/i, /not loading/i] },
    { key: "login-account", label: "Login & account access", patterns: [/log\s?-?in/i, /sign[\s-]?in/i, /password/i, /locked out/i, /account access/i, /\b2fa\b|two[\s-]factor|verification code/i] },
    { key: "notifications", label: "Notifications", patterns: [/notification/i, /\balerts?\b/i, /reminder/i] },
    { key: "double-booking-calendar", label: "Calendar & double bookings", patterns: [/double[\s-]?book/i, /calendar/i, /\bschedul(e|ing) (conflict|error)/i] },
    { key: "ratings-algorithm", label: "Player rating & ranking algorithm", patterns: [/rating algorithm|ranking algorithm|level(ing)? algorithm/i, /\b(player|skill) (rating|level)/i, /\branking/i] },
    { key: "streaming-video", label: "Streaming & video", patterns: [/stream/i, /\bvideo/i] },
    { key: "messaging", label: "Messaging & team chat", patterns: [/messag/i, /\bchats?\b/i, /\bgroup chat/i] },
    { key: "registration-forms", label: "Registration & forms", patterns: [/registr/i, /\bsign[\s-]?ups?\b/i, /\bforms?\b/i, /waiver/i] },
    { key: "reporting-exports", label: "Reporting & exports", patterns: [/report/i, /export/i, /analytics/i, /dashboard/i] },
    { key: "integrations-sync", label: "Integrations & sync", patterns: [/integrat/i, /\bsync/i, /quickbooks/i, /outlook|google calendar/i, /\bapi\b/i] },
    { key: "onboarding-setup", label: "Onboarding, setup & migration", patterns: [/onboard/i, /\bset[\s-]?up\b/i, /migrat/i, /implementation/i, /oversold|sales (team|process)/i] },
    { key: "mobile-app", label: "Mobile app quality", patterns: [/\bandroid\b/i, /\biphone|ios\b/i, /mobile/i] },
    { key: "clunky-ui", label: "Clunky, confusing or outdated interface", patterns: [/clunky/i, /confus/i, /unintuitive|not intuitive/i, /outdated|old[\s-]fashioned|dated/i, /navigat/i, /interface|\bui\b|\bux\b|user experience/i, /too many (clicks|steps)/i, /complicated|complex/i] },
]);

const ALERTS = Object.freeze({
    // Only complaints posted (or, if undated, found) this recently can raise an alert.
    lookbackDays: 14,
    maxPerRun: 50,
});

const PLAYBOOKS = Object.freeze({
    minComplaints: 5,
    topPains: 3,
    quotesPerPain: 2,
});

/** Canonical sport → patterns matched against the complaint's sport, quote, title and subreddit. */
const SPORT_PATTERNS = Object.freeze({
    pickleball: [/pickle\s*ball/i],
    padel: [/\bpadel\b/i],
    tennis: [/\btennis\b/i],
    squash: [/\bsquash\b/i],
    badminton: [/\bbadminton\b/i],
    soccer: [/\bsoccer\b/i, /\bfutsal\b/i, /youthsoccer/i],
    basketball: [/\bbasketball\b/i, /\bhoops\b/i],
    baseball: [/\bbaseball\b/i, /\blittle league\b/i],
    softball: [/\bsoftball\b/i],
    volleyball: [/\bvolleyball\b/i],
    lacrosse: [/\blacrosse\b/i],
    hockey: [/\bhockey\b/i],
    football: [/\bflag football\b/i, /\bamerican football\b/i, /\bpop warner\b/i],
    swimming: [/\bswim(ming)?\b/i],
    gymnastics: [/\bgymnastics?\b/i],
    golf: [/\bgolf\b/i],
    cricket: [/\bcricket\b/i],
    rugby: [/\brugby\b/i],
    martial_arts: [/\bmartial arts?\b/i, /\bkarate\b/i, /\bjiu[\s-]?jitsu\b/i, /\bbjj\b/i, /\btaekwondo\b/i, /\bboxing\b/i],
    track: [/\btrack and field\b/i, /\bcross country\b/i],
    fitness: [/\bgym\b/i, /\bgymowner\b/i, /\bcrossfit\b/i, /\byoga\b/i, /\bpilates\b/i, /\bbarre\b/i, /\bfitness\b/i, /\baerial\b/i, /\bstudio\b/i],
});

/** Values the AI sometimes returns as a "sport" that aren't one. */
const NON_SPORTS = Object.freeze(["sports", "sport", "multi-sport", "multisport", "various", "general", "all", "youth sports"]);

const US_STATES = Object.freeze([
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
    "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
    "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
    "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
    "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
    "virginia", "washington", "west virginia", "wisconsin", "wyoming",
]);

const US_STATE_CODES = Object.freeze([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
    "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
    "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",
]);

/** Country/region → words that identify it in a free-text location. */
const REGION_PATTERNS = Object.freeze({
    US: [/\b(usa?|united states|america)\b/i, /\bnyc\b/i, /\bsouthern california\b/i],
    Canada: [/\bcanada\b/i, /\btoronto\b/i, /\bvancouver\b/i, /\bmontreal\b/i, /\bontario\b/i, /\bgta\b/i],
    UK: [/\b(uk|united kingdom|england|scotland|wales|london)\b/i],
    Ireland: [/\bireland\b/i, /\bdublin\b/i],
    Australia: [/\baustralia\b/i, /\bsydney\b/i, /\bmelbourne\b/i],
    "New Zealand": [/\bnew zealand\b/i, /\bauckland\b/i],
    Spain: [/\bspain\b/i, /\bmadrid\b/i, /\bbarcelona\b/i],
    Italy: [/\bitaly\b/i, /\bmilan\b/i, /\brome\b/i],
    Portugal: [/\bportugal\b/i, /\blisbon\b/i],
    Netherlands: [/\bnetherlands\b/i, /\bamsterdam\b/i, /\bhoofddorp\b/i],
    Sweden: [/\bsweden\b/i, /\bstockholm\b/i],
    Singapore: [/\bsingapore\b/i],
    Philippines: [/\bphilippines\b/i, /\bmanila\b/i],
    UAE: [/\b(uae|dubai|abu dhabi)\b/i],
});

/** App Store storefront code → the same region names REGION_PATTERNS uses (filters match on the name). */
const STOREFRONT_REGIONS = Object.freeze({
    US: "US", CA: "Canada", GB: "UK", IE: "Ireland", AU: "Australia", NZ: "New Zealand",
    ES: "Spain", IT: "Italy", PT: "Portugal", NL: "Netherlands", SE: "Sweden", SG: "Singapore",
    PH: "Philippines", AE: "UAE",
});

/** Questions a rep can ask a prospect to surface each pain in a discovery call. */
const DISCOVERY_QUESTIONS = Object.freeze({
    booking_scheduling: [
        "How often do double bookings or schedule changes cause problems for your members?",
        "How long does it take your team to build and publish a season schedule?",
    ],
    payments_billing: [
        "How much time does your team spend chasing unpaid dues each month?",
        "Can families set up payment plans or autopay without staff stepping in?",
    ],
    pricing_fees: [
        "Do you know what you pay all-in per transaction once processing fees are added?",
        "Have fees or price increases changed since you signed up?",
    ],
    customer_support: [
        "When something breaks on a busy day, how quickly can you reach a real person?",
        "How do your members get help with their accounts today?",
    ],
    reliability_bugs: [
        "When did the app or booking page last go down, and what did it cost you?",
        "Do members complain about crashes, logouts or failed payments?",
    ],
    usability: [
        "How many clicks does it take your staff to do the task they do most often?",
        "How much training does a new staff member need before they're confident in the system?",
    ],
    communication: [
        "How do you make sure parents and members actually see important messages?",
        "Do you need separate tools for email, text and group chat?",
    ],
    membership_management: [
        "How do you handle family accounts, passes and credits today?",
        "What's hardest about renewals and membership changes?",
    ],
    reporting: [
        "How long does it take to answer a simple question like revenue by program?",
        "Which reports do you build by hand in spreadsheets?",
    ],
    integrations: [
        "Which tools (accounting, video, access control) do you wish talked to each other?",
        "How much double data entry happens between systems?",
    ],
    onboarding_migration: [
        "What would make switching systems feel safe for your club?",
        "How did onboarding go with your current provider?",
    ],
    contract_lockin: [
        "When does your current contract renew, and what are the exit terms?",
        "What would you need to see to justify switching before renewal?",
    ],
    missing_features: [
        "What do you currently do outside your system because it can't do it?",
        "Which feature would save your team the most time if it existed?",
    ],
    other: [
        "What's the most frustrating part of your current software?",
        "If you could change one thing about it tomorrow, what would it be?",
    ],
});

module.exports = {
    INSIGHTS_SCHEMA_VERSION,
    TRENDS,
    CLUSTERS,
    THEMES,
    ALERTS,
    PLAYBOOKS,
    SPORT_PATTERNS,
    NON_SPORTS,
    US_STATES,
    US_STATE_CODES,
    REGION_PATTERNS,
    STOREFRONT_REGIONS,
    DISCOVERY_QUESTIONS,
};
