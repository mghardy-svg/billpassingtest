/**
 * California Proposition Data Client
 * Fetches ballot measure information using multiple data sources:
 * 1. California Secretary of State Quick Guide to Props (proposition details)
 * 2. California Secretary of State Election Results API (vote results)
 * 3. Open States API (v3) - For legislative data (fallback)
 *
 * Data sources:
 * - https://quickguidetoprops.sos.ca.gov/propositions/{date}
 * - https://api.sos.ca.gov/returns/ballot-measures
 * - https://v3.openstates.org/
 */

import { Proposition, PropositionCategory, PropositionResult, PropositionStatus } from '@/types';
import { ballotpediaClient } from './ballotpedia';

/**
 * Decode HTML entities in a string extracted from scraped HTML.
 * Handles numeric entities (&#58; &#36; &#44;) and common named entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&rdquo;/g, '\u201d');
}

// California Secretary of State Quick Guide to Props
const CA_SOS_QUICK_GUIDE = 'https://quickguidetoprops.sos.ca.gov/propositions';

// California Secretary of State Election Results API
// Serves the most recently completed statewide election results as JSON
// No authentication required
const CA_SOS_RESULTS_API = 'https://api.sos.ca.gov/returns/ballot-measures';

// Open States API for California legislative data
const OPEN_STATES_API = 'https://v3.openstates.org';

export interface BallotMeasureInfo {
  measureNumber: string;
  title: string;
  summary: string;
  fullText?: string;
  proponents: string[];
  opponents: string[];
  fiscalImpact?: string;
  electionDate: string;
}

export interface ElectionResult {
  measureNumber: string;
  year: number;
  yesVotes: number;
  noVotes: number;
  yesPercentage: number;
  noPercentage: number;
  totalVotes: number;
  passed: boolean;
  countyResults?: Record<string, { yes: number; no: number }>;
}

// Parsed result from the CA SOS Election Results API
interface ApiElectionResult {
  name: string;
  yesVotes: number;
  noVotes: number;
  yesPercent: number;
  noPercent: number;
  passed: boolean;
}

// Parsed data from Quick Guide proposition detail page
interface PropositionDetailData {
  summary: string;
  fiscalImpact?: string;
  supporters: string[];
  opponents: string[];
  type?: string;
}

interface OpenStatesBill {
  id: string;
  identifier: string;
  title: string;
  abstract?: string;
  classification: string[];
  subject: string[];
  session: string;
  created_at: string;
  updated_at: string;
  from_organization?: {
    name: string;
  };
  extras?: Record<string, unknown>;
}

class CASosClient {
  private openStatesApiKey: string | undefined;
  private resultsCache: { data: Map<string, ApiElectionResult>; fetchedAt: number } | null = null;
  private static RESULTS_CACHE_TTL = 300_000; // 5 minutes

  constructor() {
    this.openStatesApiKey = process.env.OPEN_STATES_API_KEY;
  }

  // ============ CA SOS Election Results API ============

  /**
   * Fetch election results from CA SOS Election Results API
   * Endpoint: GET https://api.sos.ca.gov/returns/ballot-measures
   * Response: { raceTitle, Reporting, ReportingTime, "ballot-measures": [{ Name, Number, yesVotes, yesPercent, noVotes, noPercent }] }
   */
  private async fetchElectionResults(): Promise<Map<string, ApiElectionResult>> {
    if (this.resultsCache && Date.now() - this.resultsCache.fetchedAt < CASosClient.RESULTS_CACHE_TTL) {
      return this.resultsCache.data;
    }

    try {
      console.log('[CA-SOS] Fetching election results from CA SOS API');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(CA_SOS_RESULTS_API, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.log(`[CA-SOS] Election Results API returned ${response.status}`);
        return new Map();
      }

      const data = await response.json();
      const results = new Map<string, ApiElectionResult>();

      for (const measure of data['ballot-measures'] || []) {
        const yesVotes = parseInt(String(measure.yesVotes).replace(/,/g, ''));
        const noVotes = parseInt(String(measure.noVotes).replace(/,/g, ''));
        const yesPercent = parseFloat(measure.yesPercent);
        const noPercent = parseFloat(measure.noPercent);

        results.set(String(measure.Number), {
          name: measure.Name || '',
          yesVotes,
          noVotes,
          yesPercent,
          noPercent,
          passed: yesPercent > 50,
        });
      }

      console.log(`[CA-SOS] Got results for ${results.size} ballot measures from API`);
      this.resultsCache = { data: results, fetchedAt: Date.now() };
      return results;
    } catch (error) {
      console.error('[CA-SOS] Error fetching election results:', error);
      return new Map();
    }
  }

  /**
   * Fetch county-level election results from CA SOS API
   * Endpoint: GET https://api.sos.ca.gov/returns/ballot-measures/county/{county-name}
   * Response: { raceTitle, Reporting, ReportingTime, "ballot-measures": [{ Name, Number, yesVotes, yesPercent, noVotes, noPercent }] }
   */
  async fetchCountyResults(countyName: string): Promise<Map<string, { yes: number; no: number }>> {
    try {
      const slug = countyName.toLowerCase().replace(/\s+/g, '-');
      const response = await fetch(`${CA_SOS_RESULTS_API}/county/${slug}`, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) return new Map();

      const data = await response.json();
      const results = new Map<string, { yes: number; no: number }>();

      for (const measure of data['ballot-measures'] || []) {
        results.set(String(measure.Number), {
          yes: parseInt(String(measure.yesVotes).replace(/,/g, '')),
          no: parseInt(String(measure.noVotes).replace(/,/g, '')),
        });
      }

      return results;
    } catch {
      return new Map();
    }
  }

  // ============ Quick Guide Detail Pages ============

  /**
   * Fetch detailed proposition data from Quick Guide detail page
   * URL: https://quickguidetoprops.sos.ca.gov/propositions/{date}/{number}
   * Returns: summary, fiscal impact, supporters, opponents, proposition type
   */
  private async fetchPropositionDetail(electionDate: string, number: string): Promise<PropositionDetailData | null> {
    const url = `${CA_SOS_QUICK_GUIDE}/${electionDate}/${number}`;
    console.log(`[CA-SOS] Fetching detail page: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; CA-Proposition-Predictor/1.0)',
        },
      });

      if (!response.ok) return null;

      const html = await response.text();
      return this.parseDetailPage(html);
    } catch (error) {
      console.error(`[CA-SOS] Error fetching detail for prop ${number}:`, error);
      return null;
    }
  }

  /**
   * Parse Quick Guide detail page HTML for rich proposition data
   */
  private parseDetailPage(html: string): PropositionDetailData {
    // Extract summary/description from common page structures
    let summary = '';
    const summaryPatterns = [
      /<div[^>]*class="[^"]*(?:summary|description|measure-text|prop-details)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<section[^>]*(?:id|class)="[^"]*(?:summary|overview|description)[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
      /<h[12][^>]*>[\s\S]*?<\/h[12]>\s*(?:<[^>]+>)*\s*<p[^>]*>([\s\S]*?)<\/p>/i,
    ];
    for (const pattern of summaryPatterns) {
      const match = html.match(pattern);
      if (match) {
        const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        if (text.length > 20) { summary = text; break; }
      }
    }

    // Extract fiscal impact
    let fiscalImpact: string | undefined;
    const fiscalPatterns = [
      /(?:fiscal\s+(?:impact|effect))[^<]*<[^>]*>([\s\S]*?)(?:<\/(?:div|section|p)>)/i,
      /(?:fiscal\s+(?:impact|effect))[:\s]*([\s\S]*?)(?:<\/(?:div|p|li)>)/i,
      /(?:fiscal\s+(?:impact|effect))\s*<\/[^>]+>\s*<[^>]+>([\s\S]*?)<\//i,
    ];
    for (const pattern of fiscalPatterns) {
      const match = html.match(pattern);
      if (match) {
        const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        if (text.length > 10) { fiscalImpact = text; break; }
      }
    }

    // Extract supporters
    const supporters = this.extractStakeholders(html, 'support');

    // Extract opponents
    const opponents = this.extractStakeholders(html, 'oppose');

    // Extract proposition type
    let type: string | undefined;
    const typeMatch = html.match(
      /(?:Legislative\s+(?:Statute|Constitutional\s+Amendment)|Initiative\s+(?:Statute|Constitutional\s+Amendment)|Referendum)/i
    );
    if (typeMatch) {
      type = typeMatch[0];
    }

    return { summary, fiscalImpact, supporters, opponents, type };
  }

  /**
   * Extract supporter or opponent names from HTML lists
   */
  private extractStakeholders(html: string, position: 'support' | 'oppose'): string[] {
    const names: string[] = [];
    const patterns = position === 'support'
      ? [/(?:support(?:ers?|ing)?|proponents?|yes\s+on)[^<]*[\s\S]*?<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/i]
      : [/(?:oppos(?:ition|e|ing)|opponents?|no\s+on)[^<]*[\s\S]*?<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/i];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const items = match[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
        for (const item of items) {
          const text = decodeHtmlEntities(item.replace(/<[^>]+>/g, '')).trim();
          if (text && text.length > 2) names.push(text);
        }
        if (names.length > 0) break;
      }
    }

    return names;
  }

  // ============ Status & Result Building ============

  /**
   * Determine proposition status from election date and API results
   */
  private determineStatus(electionDate: string, apiResult?: ApiElectionResult): PropositionStatus {
    // Parse YYYY-MM-DD as local time to avoid UTC timezone shift
    const parts = electionDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const electionDay = parts
      ? new Date(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]) + 1) // +1: polls close EOD
      : new Date(electionDate);
    const isPast = electionDay < new Date();
    if (!isPast) return 'upcoming';
    if (apiResult) return apiResult.passed ? 'passed' : 'failed';
    // Fallback for past elections without CA SOS API data.
    // Ballotpedia enrichment in fetchFromCASOS will correct this if results are available.
    return 'active';
  }

  /**
   * Build a PropositionResult from CA SOS API data
   */
  private buildResult(apiResult: ApiElectionResult): PropositionResult {
    return {
      passed: apiResult.passed,
      yesPercentage: apiResult.yesPercent,
      noPercentage: apiResult.noPercent,
      yesVotes: apiResult.yesVotes,
      noVotes: apiResult.noVotes,
      totalVotes: apiResult.yesVotes + apiResult.noVotes,
      turnout: 0, // Not available from the Election Results API
    };
  }

  // ============ Main Data Fetching ============

  /**
   * Get all propositions for a given year
   * Tries multiple data sources in order of preference
   */
  async getPropositionsByYear(year: number): Promise<Proposition[]> {
    console.log(`[CA-SOS] Fetching propositions for year ${year}`);
    console.log(`[CA-SOS] Open States API Key present: ${!!this.openStatesApiKey}`);

    // Try CA Secretary of State Quick Guide first (most reliable for propositions)
    let propositions = await this.fetchFromCASOS(year);

    if (propositions.length > 0) {
      console.log(`[CA-SOS] Found ${propositions.length} propositions from CA SOS Quick Guide`);
      return propositions;
    }

    // Try Ballotpedia for upcoming measures (e.g. future elections not yet on Quick Guide)
    propositions = await this.fetchUpcomingFromBallotpedia(year);

    if (propositions.length > 0) {
      console.log(`[CA-SOS] Found ${propositions.length} propositions from Ballotpedia (upcoming)`);
      return propositions;
    }

    // Try Open States API as fallback
    propositions = await this.fetchFromOpenStates(year);

    if (propositions.length > 0) {
      console.log(`[CA-SOS] Found ${propositions.length} propositions from Open States API`);
      return propositions;
    }

    console.log(`[CA-SOS] No propositions found for year ${year} from any source`);
    return [];
  }

  /**
   * Fetch propositions from California Secretary of State Quick Guide
   * Also enriches with election results from the CA SOS Election Results API,
   * falling back to Ballotpedia scraping for historical elections.
   */
  private async fetchFromCASOS(year: number): Promise<Proposition[]> {
    const electionDates = this.generateElectionDates(year);

    // Fetch election results (CA SOS API + Ballotpedia) and Quick Guide pages in parallel
    const emptyBpResults = { results: new Map<string, PropositionResult>(), statuses: new Map<string, boolean>(), titles: new Map<string, string>(), descriptions: new Map<string, string>(), subjects: new Map<string, string>() };
    const [apiResults, bpData, ...htmlResults] = await Promise.all([
      this.fetchElectionResults().catch(() => new Map<string, ApiElectionResult>()),
      ballotpediaClient.fetchYearResults(year).catch(() => emptyBpResults),
      ...electionDates.map(async (electionDate) => {
        const url = `${CA_SOS_QUICK_GUIDE}/${electionDate}`;
        console.log(`[CA-SOS] Fetching from CA SOS: ${url}`);
        try {
          const response = await fetch(url, {
            headers: {
              'Accept': 'text/html',
              'User-Agent': 'Mozilla/5.0 (compatible; CA-Proposition-Predictor/1.0)',
            },
          });
          console.log(`[CA-SOS] CA SOS response status: ${response.status} for ${electionDate}`);
          if (!response.ok) return { html: '', electionDate };
          return { html: await response.text(), electionDate };
        } catch (error) {
          console.error(`[CA-SOS] Error fetching CA SOS for ${electionDate}:`, error);
          return { html: '', electionDate };
        }
      }),
    ]);

    const allPropositions: Proposition[] = [];
    for (const { html, electionDate } of htmlResults) {
      if (!html) continue;
      const propositions = this.parseCASOSHtml(html, year, electionDate, apiResults);
      console.log(`[CA-SOS] Parsed ${propositions.length} propositions from ${electionDate}`);

      // Enrich propositions that lack CA SOS API results with Ballotpedia data
      for (const prop of propositions) {
        if (!prop.result) {
          // Try full results with vote data first (available for ~2022+ on Ballotpedia)
          if (bpData.results.has(prop.number)) {
            prop.result = bpData.results.get(prop.number)!;
            prop.status = prop.result.passed ? 'passed' : 'failed';
          }
          // Fall back to pass/fail status only (older years without vote counts)
          else if (bpData.statuses.has(prop.number)) {
            prop.status = bpData.statuses.get(prop.number) ? 'passed' : 'failed';
          }
        }
      }

      allPropositions.push(...propositions);
    }

    // Quick Guide returned nothing (JS-rendered SPA) — build propositions from Ballotpedia
    // results data so historical comparison and prediction still work.
    if (allPropositions.length === 0) {
      const electionDate = electionDates[0];

      // Full results with vote data (2022+ pages)
      bpData.results.forEach((result, propNumber) => {
        const rawTitle = bpData.titles.get(propNumber) || `Proposition ${propNumber}`;
        const title = this.cleanTitle(rawTitle, propNumber);
        const description = bpData.descriptions.get(propNumber) || '';
        const subject = bpData.subjects.get(propNumber) || '';
        allPropositions.push({
          id: `${year}-${propNumber}`,
          number: propNumber,
          year,
          electionDate,
          title,
          summary: description || title,
          status: result.passed ? 'passed' : 'failed',
          category: this.inferCategoryFromSubjects([subject]) || this.inferCategory(title),
          result,
        });
      });

      // Status-only entries (older years without vote counts)
      bpData.statuses.forEach((passed, propNumber) => {
        if (allPropositions.some(p => p.number === propNumber)) return;
        const rawTitle = bpData.titles.get(propNumber) || `Proposition ${propNumber}`;
        const title = this.cleanTitle(rawTitle, propNumber);
        const description = bpData.descriptions.get(propNumber) || '';
        const subject = bpData.subjects.get(propNumber) || '';
        allPropositions.push({
          id: `${year}-${propNumber}`,
          number: propNumber,
          year,
          electionDate,
          title,
          summary: description || title,
          status: passed ? 'passed' : 'failed',
          category: this.inferCategoryFromSubjects([subject]) || this.inferCategory(title),
          // Vote percentages unavailable for older years; result is set so prediction
          // service can use the pass/fail outcome for historical comparison.
          result: { passed, yesVotes: 0, noVotes: 0, yesPercentage: 0, noPercentage: 0, totalVotes: 0, turnout: 0 },
        });
      });

      if (allPropositions.length > 0) {
        console.log(`[CA-SOS] Built ${allPropositions.length} propositions from Ballotpedia results for ${year}`);
      }
    }

    return allPropositions.sort((a, b) => parseInt(a.number) - parseInt(b.number));
  }

  /**
   * Fetch upcoming measures from Ballotpedia for years where the Quick Guide
   * doesn't have data yet (e.g. future elections).
   * Ballotpedia lists confirmed/qualified measures with titles but no proposition numbers.
   * Uses the legislative bill number (e.g. "SB 42") as the identifier.
   */
  private async fetchUpcomingFromBallotpedia(year: number): Promise<Proposition[]> {
    try {
      const measures = await ballotpediaClient.fetchUpcomingMeasures(year);
      if (measures.length === 0) return [];

      // Compute the November general election date for this year
      const electionDate = this.generateElectionDates(year)[0];

      return measures.map((measure) => {
        // Use the legislative bill number without spaces (e.g. "SB42", "SCA1")
        // Keeps ID format as "YEAR-NUMBER" without extra dashes
        const number = (measure.billNumber || measure.type).replace(/\s+/g, '');
        return {
          id: `${year}-${number}`,
          number,
          year,
          electionDate,
          title: measure.title,
          summary: measure.description,
          status: 'upcoming' as PropositionStatus,
          category: this.inferCategory(measure.title + ' ' + measure.subject),
        };
      });
    } catch (error) {
      console.error(`[CA-SOS] Error fetching upcoming from Ballotpedia for ${year}:`, error);
      return [];
    }
  }

  /**
   * Parse HTML from CA SOS Quick Guide to extract propositions
   * HTML structure: <a href=".../propositions/DATE/NUMBER">...<h2>TITLE</h2></a>
   * Enriches with vote results from the Election Results API when available
   */
  private parseCASOSHtml(
    html: string,
    year: number,
    electionDate: string,
    apiResults: Map<string, ApiElectionResult>
  ): Proposition[] {
    const propositions: Proposition[] = [];

    // Match proposition URLs and extract the number
    // Pattern: /propositions/YYYY-MM-DD/NUMBER followed by h2 with title
    const propPattern = /propositions\/[\d-]+\/(\d+)"[^>]*>[\s\S]*?<h2[^>]*>\s*([\s\S]*?)\s*<\/h2>/gi;

    let match;
    while ((match = propPattern.exec(html)) !== null) {
      const number = match[1];
      let title = decodeHtmlEntities(match[2]).trim();

      // Clean up the title - remove extra whitespace and newlines
      title = title.replace(/\s+/g, ' ').trim();
      if (title.length < 5) continue; // Skip if title is too short

      // Skip if we already have this proposition
      if (propositions.some(p => p.number === number)) continue;

      // Clean up the title
      title = this.cleanTitle(title, number);

      // Look up election results from API
      const apiResult = apiResults.get(number);

      const proposition: Proposition = {
        id: `${year}-${number}`,
        number,
        year,
        electionDate,
        title,
        summary: title, // Enriched when detail page is fetched via getProposition()
        status: this.determineStatus(electionDate, apiResult),
        category: this.inferCategory(title),
        result: apiResult ? this.buildResult(apiResult) : undefined,
      };

      propositions.push(proposition);
    }

    return propositions.sort((a, b) => parseInt(a.number) - parseInt(b.number));
  }

  /**
   * Compute the first Tuesday after the first Monday in a given month/year.
   * This is the standard US election date formula (Nov) and CA primary formula (Jun/Mar).
   */
  private firstTuesdayAfterFirstMonday(year: number, month: number): number {
    const first = new Date(year, month, 1);
    const dow = first.getDay();
    // First Monday: day offset from the 1st
    // Sun(0)->2, Mon(1)->1, Tue(2)->7, Wed(3)->6, Thu(4)->5, Fri(5)->4, Sat(6)->3
    const firstMonday = 1 + ((8 - dow) % 7);
    return firstMonday + 1; // Tuesday after
  }

  /**
   * Generate candidate election dates for a given year.
   * Tries November + primary months (March, June) + September for special elections.
   * The Quick Guide returns 404 for non-existent dates, so extra candidates are harmless.
   */
  private generateElectionDates(year: number): string[] {
    const fmt = (m: number, d: number) =>
      `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const dates: string[] = [];

    // November general election (always)
    dates.push(fmt(11, this.firstTuesdayAfterFirstMonday(year, 10)));

    // Even years have a primary — CA uses either March or June depending on the cycle
    if (year % 2 === 0) {
      dates.push(fmt(6, this.firstTuesdayAfterFirstMonday(year, 5)));  // June primary
      dates.push(fmt(3, this.firstTuesdayAfterFirstMonday(year, 2)));  // March primary
    }

    // Odd years may have special / recall elections in September
    if (year % 2 === 1) {
      dates.push(fmt(9, this.firstTuesdayAfterFirstMonday(year, 8)));
    }

    return dates;
  }

  /**
   * Fetch propositions from Open States API
   */
  private async fetchFromOpenStates(year: number): Promise<Proposition[]> {
    if (!this.openStatesApiKey) {
      console.log('[CA-SOS] No Open States API key configured, skipping...');
      return [];
    }

    try {
      // Open States uses session identifiers like "2023-2024"
      const sessionStart = year % 2 === 0 ? year - 1 : year;
      const session = `${sessionStart}-${sessionStart + 1}`;

      // Search for constitutional amendments in California
      const url = `${OPEN_STATES_API}/bills?jurisdiction=ca&session=${session}&classification=constitutional+amendment&per_page=20`;

      console.log(`[CA-SOS] Fetching from Open States: ${url}`);

      const response = await fetch(url, {
        headers: {
          'X-API-KEY': this.openStatesApiKey,
          'Accept': 'application/json',
        },
      });

      console.log(`[CA-SOS] Open States response status: ${response.status}`);

      if (!response.ok) {
        const text = await response.text();
        console.error(`[CA-SOS] Open States API error: ${response.status} - ${text.substring(0, 200)}`);
        return [];
      }

      const data = await response.json();
      console.log(`[CA-SOS] Open States returned ${data.results?.length || 0} results`);

      if (!data.results || data.results.length === 0) {
        return [];
      }

      // Fetch election results to enrich Open States data
      const apiResults = await this.fetchElectionResults();

      // Transform Open States bills to propositions
      const propositions = data.results
        .map((bill: OpenStatesBill, index: number) => this.transformOpenStatesBill(bill, year, index, apiResults));

      return propositions;
    } catch (error) {
      console.error('[CA-SOS] Error fetching from Open States:', error);
      return [];
    }
  }

  /**
   * Get a specific proposition, enriched with detail page data
   */
  async getProposition(year: number, number: string): Promise<Proposition | null> {
    const propositions = await this.getPropositionsByYear(year);
    const prop = propositions.find(p => p.number === number);
    if (!prop) return null;

    // Enrich with detail page data from Quick Guide
    const detail = await this.fetchPropositionDetail(prop.electionDate, number);
    if (detail) {
      if (detail.summary && detail.summary.length > prop.summary.length) {
        prop.summary = detail.summary;
      }
      if (detail.supporters?.length) {
        prop.sponsors = detail.supporters;
      }
      if (detail.opponents?.length) {
        prop.opponents = detail.opponents;
      }
    }

    return prop;
  }

  /**
   * Get election results for a specific measure from the CA SOS API
   */
  async getElectionResults(_year: number, measureNumber: string): Promise<ElectionResult | null> {
    const apiResults = await this.fetchElectionResults();
    const result = apiResults.get(measureNumber);
    if (!result) return null;

    return {
      measureNumber,
      year: _year,
      yesVotes: result.yesVotes,
      noVotes: result.noVotes,
      yesPercentage: result.yesPercent,
      noPercentage: result.noPercent,
      totalVotes: result.yesVotes + result.noVotes,
      passed: result.passed,
    };
  }

  /**
   * Get historical results for similar propositions by category
   */
  async getHistoricalResults(_category: PropositionCategory, _years = 10): Promise<ElectionResult[]> {
    // The CA SOS Election Results API only serves the most recent election.
    // Historical results are not available via API (only in PDFs).
    return [];
  }

  /**
   * Get all years with California ballot measure data.
   * Verified via Ballotpedia scrape on 2026-02-24: checked all years 1840–2026.
   * 2026 included as the current upcoming election year (uses upcoming table format).
   * Pre-initiative years (1886–1910) use "Amendment N" naming on Ballotpedia instead
   * of "Proposition N"; the parser handles both formats.
   */
  async getAvailableYears(): Promise<number[]> {
    return [
      2026, 2025, 2024, 2022, 2020, 2018, 2016, 2014, 2013, 2012, 2010, 2009,
      2008, 2006, 2005, 2004, 2003, 2002, 2000, 1998, 1996, 1994, 1993, 1992,
      1990, 1988, 1986, 1984, 1982, 1980, 1979, 1978, 1976, 1974, 1973, 1972,
      1970, 1968, 1966, 1964, 1962, 1960, 1958, 1956, 1954, 1952, 1950, 1949,
      1948, 1946, 1944, 1942, 1940, 1939, 1938, 1936, 1935, 1934, 1933, 1932,
      1930, 1928, 1926, 1924, 1922, 1920, 1919, 1918, 1916, 1915, 1914, 1912,
      1911, 1910, 1908, 1898, 1896, 1892, 1886,
    ];
  }

  /**
   * Transform Open States bill to Proposition type
   */
  private transformOpenStatesBill(
    bill: OpenStatesBill,
    year: number,
    index: number,
    apiResults: Map<string, ApiElectionResult>
  ): Proposition {
    // Extract proposition number from identifier or title
    const propMatch = bill.identifier.match(/(\d+)/) || bill.title.match(/Proposition\s+(\d+)/i);
    const number = propMatch ? propMatch[1] : String(index + 1);

    // Determine election date
    const electionDate = this.generateElectionDates(year)[0];

    // Look up election results from API
    const apiResult = apiResults.get(number);

    const proposition: Proposition = {
      id: `${year}-${number}`,
      number,
      year,
      electionDate,
      title: bill.title,
      summary: bill.abstract || bill.title,
      fullText: undefined,
      status: this.determineStatus(electionDate, apiResult),
      category: this.inferCategoryFromSubjects(bill.subject) || this.inferCategory(bill.title),
      result: apiResult ? this.buildResult(apiResult) : undefined,
    };

    // Only add sponsors if available
    if (bill.from_organization) {
      proposition.sponsors = [bill.from_organization.name];
    }

    return proposition;
  }

  /**
   * Clean up proposition title - normalize casing and remove redundant prefixes
   */
  private cleanTitle(title: string, _propNumber: string): string {
    let cleaned = title;

    // Remove redundant "Proposition X" or "Proposition 0XX" prefixes
    // Patterns: "Proposition 36:", "Proposition 036 -", "PROPOSITION 1:", etc.
    cleaned = cleaned.replace(/^(?:PROP(?:OSITION)?\.?\s*0*\d+\s*[-:–—]?\s*)/i, '');

    // Remove legislative reference patterns like:
    // "SCA 10 (RESOLUTION CHAPTER 97, STATUTES OF 2022) ATKINS."
    // "ACA 5 (resolution chapter 23), weber."
    // "AB 48 (CHAPTER 530, STATUTES OF 2019), O DONNELL."
    cleaned = cleaned.replace(/^(?:(?:SCA|ACA|AB|SB)\s*\d+\s*\([^)]+\)[,.]?\s*(?:[A-Z'\s]+\.?\s*)?)/i, '');

    // Convert ALL CAPS to Title Case (if more than 50% is uppercase)
    const upperCount = (cleaned.match(/[A-Z]/g) || []).length;
    const letterCount = (cleaned.match(/[a-zA-Z]/g) || []).length;

    if (letterCount > 0 && upperCount / letterCount > 0.5) {
      cleaned = this.toTitleCase(cleaned);
    }

    // Trim and ensure it doesn't start with lowercase
    cleaned = cleaned.trim();
    if (cleaned.length > 0 && /^[a-z]/.test(cleaned)) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned;
  }

  /**
   * Convert text to Title Case
   */
  private toTitleCase(text: string): string {
    // Words that should stay lowercase (unless at start)
    const lowercaseWords = new Set([
      'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by',
      'from', 'in', 'of', 'with', 'as', 'into', 'through', 'during', 'before',
      'after', 'above', 'below', 'between', 'under', 'over'
    ]);

    return text
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (word.length === 0) return word;

        // Always capitalize first word and words not in lowercase list
        if (index === 0 || !lowercaseWords.has(word)) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
      })
      .join(' ');
  }

  /**
   * Infer category from Open States subject tags
   */
  private inferCategoryFromSubjects(subjects: string[]): PropositionCategory | null {
    if (!subjects || subjects.length === 0) return null;

    const subjectsLower = subjects.map(s => s.toLowerCase());

    if (subjectsLower.some(s => s.includes('tax') || s.includes('revenue') || s.includes('budget'))) {
      return 'taxation';
    }
    if (subjectsLower.some(s => s.includes('education') || s.includes('school'))) {
      return 'education';
    }
    if (subjectsLower.some(s => s.includes('health') || s.includes('medical'))) {
      return 'healthcare';
    }
    if (subjectsLower.some(s => s.includes('environment') || s.includes('natural resources'))) {
      return 'environment';
    }
    if (subjectsLower.some(s => s.includes('crime') || s.includes('criminal') || s.includes('judiciary'))) {
      return 'criminal_justice';
    }
    if (subjectsLower.some(s => s.includes('labor') || s.includes('employment'))) {
      return 'labor';
    }
    if (subjectsLower.some(s => s.includes('housing'))) {
      return 'housing';
    }
    if (subjectsLower.some(s => s.includes('transportation'))) {
      return 'transportation';
    }
    if (subjectsLower.some(s => s.includes('civil rights') || s.includes('elections'))) {
      return 'civil_rights';
    }

    return null;
  }

  /**
   * Infer category from proposition title
   */
  private inferCategory(title: string): PropositionCategory {
    const lowerTitle = title.toLowerCase();

    if (lowerTitle.includes('tax') || lowerTitle.includes('bond') || lowerTitle.includes('fee')) {
      return 'taxation';
    }
    if (lowerTitle.includes('school') || lowerTitle.includes('education') || lowerTitle.includes('college')) {
      return 'education';
    }
    if (lowerTitle.includes('health') || lowerTitle.includes('medical') || lowerTitle.includes('hospital')) {
      return 'healthcare';
    }
    if (lowerTitle.includes('environment') || lowerTitle.includes('water') || lowerTitle.includes('climate') || lowerTitle.includes('energy')) {
      return 'environment';
    }
    if (lowerTitle.includes('crime') || lowerTitle.includes('criminal') || lowerTitle.includes('prison') || lowerTitle.includes('police')) {
      return 'criminal_justice';
    }
    if (lowerTitle.includes('labor') || lowerTitle.includes('worker') || lowerTitle.includes('wage') || lowerTitle.includes('employee')) {
      return 'labor';
    }
    if (lowerTitle.includes('housing') || lowerTitle.includes('rent') || lowerTitle.includes('home')) {
      return 'housing';
    }
    if (lowerTitle.includes('transport') || lowerTitle.includes('road') || lowerTitle.includes('highway') || lowerTitle.includes('rail')) {
      return 'transportation';
    }
    if (lowerTitle.includes('rights') || lowerTitle.includes('vote') || lowerTitle.includes('marriage') || lowerTitle.includes('discrimination')) {
      return 'civil_rights';
    }

    return 'government';
  }
}

export const caSosClient = new CASosClient();
export default caSosClient;
