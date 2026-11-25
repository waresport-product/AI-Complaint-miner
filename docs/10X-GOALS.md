# AI Complaint Miner: 10x Goals

**Mission:** make the AI Complaint Miner the default market-intelligence system for sports-tech
sales and product teams. It turns public complaints about competitors into a live competitor map
with trend detection, region and sport filters, and CRM-ready alerts. It clusters issues, ranks
hot accounts and suggests sales playbooks automatically, with no manual spreadsheet work.

**Why it matters:** faster go-to-market decisions and sharper messaging, grounded in what buyers
actually complain about.

Owner: gitty-hash · Drafted: November 2026 · Horizon: 10x in 6–9 months · 100x stretch: 18–24 months

---

## 1. Where we are today (baseline)

Measured from the system's own output (collection up to 26 Oct 2026):

| Metric | Baseline |
|---|---|
| Verified complaints in the dataset | **809** (all quotes checked word for word against the source) |
| Competitors tracked / with complaints | 22 / 20 |
| Sources | 3 (Reddit via Agent Reach, review sites and forums via Firecrawl, Apple App Store) |
| Hot complaints / people considering a switch | 78 / 74 |
| Complaints with a post date (needed for trends) | 82% |
| Complaints with a known sport | 18% stated |
| Complaints with a known region | 3% stated |
| Complaints written by owners/admins/staff (the buyers) | 268 of 809 (33%) |
| Verified club accounts (name proven by source text) | **0** (club names extracted for 4%, none verifiable) |
| How often it runs | Manually, about twice a week; 30–60 min per full run |
| How sales consume it | One Excel sheet, filtered by hand |
| Trends, issue clusters, playbooks, alerts, API | None |
| Time from a complaint being posted to sales seeing it | Days (next manual run, then someone has to notice it) |

---

## 2. The 10x goals

Each goal has a baseline, a 10x target and a measurable definition. "Phase 1" items are already
built on the `feature/10x-market-intelligence` branch (see section 4).

| # | Goal | Baseline | 10x target | How we measure it |
|---|---|---|---|---|
| **G1** | **Time-to-insight**: answer "what are *[competitor]* customers in *[sport/region]* complaining about this month?" | Hours of manual spreadsheet filtering | **< 1 minute**, no spreadsheet (API, dashboard or the auto-built sheets) | Time for a rep to answer 5 standard questions, before vs after |
| **G2** | **Signal freshness**: time from post to alert | Days | **< 24 hours** median, with daily runs | `postedAt` → alert `createdAt` in `alerts.json` |
| **G3** | **Signal volume**: verified complaints per year | ~800 collected so far | **8,000+ per year** (~650 per month) | `totals.complaints` growth in `insights.json` |
| **G4** | **Coverage**: competitors and sources | 22 competitors, 3 sources | **40 competitors, 6+ sources** (add official Reddit API, Google Play, YouTube, X, deeper review-site pagination) | Competitor list and per-source counts in `report.json` |
| **G5** | **Actionable accounts**: verified clubs showing intent | 0 | **50+ verified hot accounts per month**, each with a proof sentence and source link | `hotAccounts` count in `insights.json` |
| **G6** | **Filterable intelligence**: complaints with a known sport / region | 18% / 3% | **70% / 80%** | `totals.sportKnownPct` / `regionKnownPct` |
| **G7** | **Automatic structure**: issues clustered without manual tagging | 0% | **≥ 80%** of complaints in named or emerging clusters, re-clustered every run | `clusters` coverage (known + emerging vs. other) |
| **G8** | **Playbooks**: competitor playbooks ready for reps | 0 | **Top 15 competitors**, refreshed every run, with proof quotes, angle and discovery questions | `playbooks` count in `insights.json` |
| **G9** | **CRM-ready alerts**: alerts delivered into the tools sales already use | None | **100%** of Hot / switching / rising-trend signals sent to Slack/Teams and CRM, each exactly once | Alerts delivered vs raised; duplicates = 0 |
| **G10** | **Trust**: accuracy sales can rely on | 100% verbatim quotes | **Keep 100% verbatim**; **≥ 90%** of Hot alerts rated useful by sales | Quote verification + thumbs-up/down feedback on alerts (phase 2) |

**Business outcomes to track** (influenced, not owned, by this system):
- At least 70% of competitive opportunities have a playbook attached.
- Better competitive win rate against the top 5 competitors (track the baseline first, then
  report the change quarterly).
- Product: complaint clusters reviewed in the monthly roadmap meeting, so competitor weaknesses
  turn into WareSport strengths.

---

## 3. What makes these targets realistic

- **G1, G6, G7, G8 and G9 are mostly software.** They depend on data that is already collected.
  Phase 1 covers most of the ground (section 4).
- **G2 and G3 depend on running daily on an always-on machine.** Today it's run by hand on a
  laptop. Firecrawl credits scale with volume: a full run used about 250 credits, and a daily
  incremental run should use roughly 40–100, so the Firecrawl plan needs to grow with G3.
- **G4 has an external dependency.** Reddit closed self-service API access in November 2025, so
  official Reddit access needs an approval that could take weeks. Agent Reach covers Reddit in the
  meantime.
- **G5 is deliberately strict.** An account only counts when the source text proves it, so "50 per
  month" is a stretch that grows with G3. We won't loosen verification to hit the number.
- **G10 needs a feedback loop** (phase 2) so "useful" is measured, not assumed.

---

## 4. Plan

### Phase 1: Intelligence layer (built on `feature/10x-market-intelligence`)

| Capability | Goal | Status |
|---|---|---|
| Live **competitor map**: complaints, Hot, switching, owners vs players, top pains, 12-month series per competitor | G1 | ✅ Built |
| **Trend detection**: last 30 days vs the prior 60, flagged *new / rising / falling* per competitor and per competitor × pain | G1, G2 | ✅ Built |
| **Region and sport filters**: stated values plus safe inference (subreddit, sport words, App Store storefront) with provenance; sport known 18% → 22%, region 3% → 43% | G6 | ✅ Built |
| **Automatic issue clustering**: 21 named themes across competitors (e.g. "AI chatbot instead of human support", "Contracts & auto-renewal", "In-app ads") plus auto-detected emerging themes; 69% of complaints in named themes, 71% including emerging | G7 | ✅ Built |
| **Hot accounts and conversations**: verified clubs only, plus ranked threads where owners are most actively unhappy | G5 | ✅ Built |
| **Verified club names**: the AI must cite the exact sentence tying the author to the club; code verifies it word for word and rejects bare headlines | G5, G10 | ✅ Built (applies to newly collected data) |
| **Sales playbooks** per competitor: ranked pains, proof quotes, WareSport angle, discovery questions, suggested opener | G8 | ✅ Built (19 generated) |
| **CRM-ready alerts**: Hot, switching intent and rising trend, each raised once; Slack/Teams/Zapier-compatible webhook; retries if delivery fails | G9 | ✅ Built (first export raised 42: 35 Hot, 4 switching, 3 rising trends; 36 of the 39 complaint alerts have no post date, so they are marked "Date unknown" and ranked lower) |
| **Insights API** for the website: read-only, filterable, token-protected | G1 | ✅ Built |
| **No spreadsheet work**: five auto-built sheets (Competitor Map, Issue Clusters, Playbooks, Hot Conversations, Alerts) plus `insights.json` | G1 | ✅ Built |

### Phase 2: Always-on and in the tools (weeks 1–8)

| Item | Goal |
|---|---|
| Host the miner on an always-on machine or VM, run daily, connect the alert webhook to the sales Slack/Teams channel | G2, G9 |
| WareSport dev team: internal dashboard page in the WareSport admin consuming the API (see `docs/INTEGRATION.md`) | G1 |
| HubSpot/CRM mapping: alerts become notes or tasks on matching companies | G9 |
| Thumbs-up/down feedback on alerts and playbooks, fed back into scoring | G10 |
| Apply for official Reddit Data API access | G4 |
| Database store (replaces JSON files) for multi-user use and history | G3 |

### Phase 3: Scale (months 3–6)

| Item | Goal |
|---|---|
| Add sources: Google Play (via a data provider), YouTube review videos, X/Twitter, deeper review-site pagination | G3, G4 |
| Expand to 40 competitors, including regional ones (UK, Canada, Australia) | G4 |
| Account enrichment: match verified clubs to website, city and size; de-duplicate against existing WareSport customers | G5 |
| AI-assisted naming of emerging clusters, reviewed before being promoted to named themes | G7 |
| Win/loss correlation: link alerts and playbooks used to deal outcomes | Outcomes |

---

## 5. 100x stretch (18–24 months)

- **From internal tool to product:** offer the competitor-intelligence layer to other sports-tech
  and sports-facility businesses as an API or dashboard subscription.
- **Volume:** 100,000+ verified signals per year across multiple languages and regions, in near
  real time.
- **Predictive:** forecast which competitor customers are likely to churn this quarter, from
  rising pain plus renewal timing (e.g. "contract & auto-renewal" complaints).
- **Closed loop:** competitor weaknesses automatically surface as WareSport roadmap candidates
  and as live, evidence-backed comparison pages on waresport.com.

---

## 6. Risks and guardrails

| Risk | Guardrail |
|---|---|
| Source access changes (Reddit, review sites) | Several sources and a swappable collector per source; official APIs where available |
| Cost grows with volume | Incremental runs (processed pages skipped), per-source limits, credit tracking in `report.json` |
| Inaccurate or overstated intelligence | Verbatim quote verification, strict club verification, star-rating caps, "verify before quoting" notes |
| Terms of service and privacy | Public content only, read-only, no contacting reviewers, no personal contact data; review each source's terms before scaling |
| Alert fatigue | Each alert raised once, priority levels, per-run cap, feedback loop in phase 2 |
