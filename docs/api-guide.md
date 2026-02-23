# API Guide — CA Proposition Predictor

This document explains every external data source used by this app, what each provides, what its real limitations are, and what should replace it if better data is needed.

---

## 1. CA Secretary of State — Quick Guide to Props

**What it does:** Lists all ballot measures for a given election date, with titles and a link to each proposition's detail page.

**Base URL:** `https://quickguidetoprops.sos.ca.gov/propositions/{YYYY-MM-DD}`

**Detail page:** `https://quickguidetoprops.sos.ca.gov/propositions/{YYYY-MM-DD}/{number}`

**What we get from it:**
- Proposition numbers and titles (from the listing page)
- Summary text, fiscal impact, supporters, opponents (from the detail page — scraped HTML)

**Limitations:**
- This is a public-facing HTML site, not a JSON API. We scrape it with regex.
- Only covers elections that the Quick Guide has published. Future elections with unconfirmed measure numbers may not appear yet.
- The detail page HTML structure can change without warning.
- Supporters/opponents are scraped from unstructured HTML lists and may be incomplete.

**What should replace it:**
- The CA SOS does not publish a machine-readable API for proposition text. The Quick Guide is the best available source.
- For full ballot text, the CA Legislative Information site (`leginfo.legislature.ca.gov`) has PDFs for initiative statutes and constitutional amendments. No JSON API exists.

---

## 2. CA Secretary of State — Election Results API

**What it does:** Returns vote totals for the most recently completed statewide election.

**Endpoint:** `GET https://api.sos.ca.gov/returns/ballot-measures`

**County-level:** `GET https://api.sos.ca.gov/returns/ballot-measures/county/{county-slug}`

**What we get from it:**
- Yes/no vote counts and percentages for each ballot measure
- Whether each measure passed or failed
- County-level breakdowns (58 counties)

**Limitations:**
- **Only serves the most recent completed election.** Past elections (2022, 2020, etc.) return 404 or empty.
- No authentication required but no versioning — the API format could change.
- County slugs must be lowercased and hyphenated (e.g. `los-angeles`, `san-francisco`).

**What should replace it:**
- For historical statewide results: Ballotpedia (see below) has results back to ~2000.
- For historical county-level results: CA SOS publishes Statement of Vote XLSX files on their CDN (`elections.cdn.sos.ca.gov/sov/{year}-general/sov/csv-ballotmeasures.xlsx`). Confirmed available for 2022; earlier years return 403.

---

## 3. Ballotpedia — Scraped HTML

**What it does:** Provides historical election results and upcoming measure information that the CA SOS API does not cover.

**URLs scraped:**
- `https://ballotpedia.org/California_{year}_ballot_propositions` — list of all measures for a year
- `https://ballotpedia.org/California_ballot_propositions,_{year}` — alternate URL format used for some years

**What we get from it:**
- Pass/fail status and yes-vote percentages for past elections (back to ~2000)
- Upcoming measure titles and subjects for future elections not yet on the Quick Guide

**Limitations:**
- No public API. We scrape HTML. Page structure changes break parsing.
- Vote count data (exact yes/no votes) is only available for recent years (~2022+). Older years only have pass/fail status.
- Scraping may be throttled or blocked.
- Results are not official — Ballotpedia reports them but the CA SOS is the authoritative source.

**What should replace it:**
- Ballotpedia offers a paid API (`api.ballotpedia.org`). It provides structured election results, candidate data, and measure summaries. Requires a subscription.
- For authoritative historical results, use CA SOS Statement of Vote files.

---

## 4. Cal-Access — Campaign Finance

**What it does:** The CA SOS Cal-Access database tracks all campaign contributions and expenditures for California ballot measures.

**Base URL:** `https://cal-access.sos.ca.gov/`

**What we attempt to get:**
- Committees supporting or opposing each ballot measure
- Total amounts raised and spent by each committee
- Top donors

**How we fetch it:**
We try two sources in order:
1. **California Civic Data Coalition API** (`calaccess.californiacivicdata.org/api/ballot-measures/{year}/{number}/`) — a cleaner JSON wrapper around Cal-Access data.
2. Falls back to empty data if neither source responds.

**Limitations:**
- The California Civic Data Coalition stopped regular updates around 2022. Their API may return 404 for recent measures.
- The raw Cal-Access site (`cal-access.sos.ca.gov`) is HTML-only — no JSON API. Scraping it is fragile.
- For upcoming 2026 measures, no finance data exists yet (committees file months before elections).
- This is why most propositions show "Insufficient Data" on the Prediction tab — without finance data, there is only one input (historical base rate) and we require at least one real data point to show a prediction.

**What should replace it:**
- **Cal-Access 2.0 / ORCA** — the CA SOS is building a new campaign finance system. No public API is available yet as of early 2026.
- **California Civic Data Coalition bulk downloads** (`calaccess.californiacivicdata.org/downloads/`) — CSV exports updated periodically. These could be imported into a local database for reliable querying.
- **OpenSecrets** (`opensecrets.org`) has some California ballot measure data but is incomplete.

---

## 5. Open States API (fallback only)

**What it does:** Provides California legislative bill data (not ballot measures directly). Used as a fallback when the Quick Guide has no data for a year.

**Endpoint:** `GET https://v3.openstates.org/bills?jurisdiction=ca&session={session}&classification=constitutional+amendment`

**Authentication:** Requires `OPEN_STATES_API_KEY` environment variable (free tier available at `openstates.org/api/register/`).

**What we get from it:**
- Constitutional amendment bills (SCA, ACA) that may appear on the ballot
- Bill titles, abstracts, and sponsoring organizations

**Limitations:**
- Open States tracks bills, not certified ballot measures. A bill may qualify for the ballot after Open States' data is fetched, or may be renumbered.
- No vote results from Open States — we merge with CA SOS results separately.
- Free tier has rate limits (500 requests/day).

**What should replace it:**
- This source is rarely needed. The Quick Guide and Ballotpedia cover most cases. Open States is only useful for upcoming measures in years where neither source has data yet.

---

## Summary Table

| Source | Data provided | Real-time | Historical | Reliability |
|--------|--------------|-----------|------------|-------------|
| CA SOS Quick Guide | Prop text, supporters, opponents | Current election only | No | Good (official) |
| CA SOS Results API | Vote totals, pass/fail | Most recent election only | No | Excellent (official) |
| CA SOS SOV XLSX | County + district vote counts | No | 2022 confirmed | Good (official) |
| Ballotpedia (scraped) | Historical results, upcoming measures | Yes (scraped) | ~2000–present | Moderate (unofficial) |
| Cal-Access / CCDC | Campaign finance | Delayed filing | Yes | Poor (API defunct for recent years) |
| Open States | Legislative bill metadata | Yes | By session | Moderate (bills only) |

---

## Why "Insufficient Data" Appears

The prediction model requires at least one real data source:

1. **Campaign finance** (Cal-Access): support vs. opposition spending ratio. Not available for most measures because Cal-Access has no working JSON API for recent elections.
2. **Historical base rate** (Ballotpedia): fraction of same-category propositions that passed in the past 10 years. Requires ≥3 comparable measures to avoid unreliable small-sample estimates.

When neither is available, the app shows "Insufficient Data" rather than fabricating a number. This is correct behavior. To fix it, integrate real Cal-Access data (bulk CSV download or the future ORCA API).
