/**
 * Ballotpedia Data Client
 * Fetches ballot measure analysis and polling data
 * Data source: https://ballotpedia.org/California_ballot_propositions
 */

import { BallotWordingAnalysis, PropositionResult } from '@/types';

const BALLOTPEDIA_BASE = 'https://ballotpedia.org';

export interface BallotpediaMeasure {
  title: string;
  number: string;
  year: number;
  type: 'initiative' | 'referendum' | 'legislative';
  status: string;
  subject: string;
  description: string;
  ballotTitle: string;
  ballotSummary: string;
  supporters: string[];
  opponents: string[];
  supportArguments: string[];
  oppositionArguments: string[];
  polls?: PollData[];
  endorsements?: Endorsement[];
}

export interface PollData {
  pollster: string;
  date: string;
  sampleSize: number;
  margin: number;
  support: number;
  oppose: number;
  undecided: number;
}

export interface Endorsement {
  name: string;
  type: 'political' | 'organization' | 'newspaper' | 'individual';
  position: 'support' | 'oppose';
  date?: string;
}

export interface BallotpediaYearResults {
  /** Full results with vote data (available for ~2022+ pages) */
  results: Map<string, PropositionResult>;
  /** Pass/fail status only, without vote counts (older year pages) */
  statuses: Map<string, boolean>;
  /** Proposition titles keyed by number, extracted from the results table */
  titles: Map<string, string>;
}

/** An upcoming measure scraped from Ballotpedia that hasn't been voted on yet */
export interface BallotpediaUpcomingMeasure {
  title: string;
  type: string;        // e.g. "LRSS", "LRCA", "CICS"
  subject: string;
  description: string;
  url: string;          // Ballotpedia page URL
  billNumber?: string;  // Legislative bill number (e.g. "SB 42", "SCA 1")
}

/**
 * Decode HTML entities in a string.
 * Handles numeric entities (&#58; &#36; &#44;) and common named entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    // Numeric decimal entities: &#58; → ':'
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    // Numeric hex entities: &#x3A; → ':'
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Common named entities
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

/**
 * Extract only the proposition description from a raw cell text,
 * stopping before "Fiscal Impact", "Supporters", or "Opponents" sections.
 */
function extractDescription(rawText: string): string {
  const cutoff = rawText.search(/\b(?:Fiscal Impact|Supporters|Opponents)\s*:/i);
  const trimmed = cutoff !== -1 ? rawText.slice(0, cutoff) : rawText;
  return trimmed.replace(/\s+/g, ' ').trim();
}

class BallotpediaClient {
  private baseUrl: string;
  private resultsCache: Map<number, BallotpediaYearResults> = new Map();
  private upcomingCache: Map<number, BallotpediaUpcomingMeasure[]> = new Map();

  constructor() {
    this.baseUrl = BALLOTPEDIA_BASE;
  }

  /**
   * Fetch election results for all propositions in a given year from Ballotpedia.
   * Scrapes the year overview page: https://ballotpedia.org/California_{year}_ballot_propositions
   *
   * Returns:
   * - results: Map of prop number → PropositionResult (with vote data, available for ~2022+)
   * - statuses: Map of prop number → passed boolean (for older years without vote counts)
   */
  async fetchYearResults(year: number): Promise<BallotpediaYearResults> {
    // Check cache first
    const cached = this.resultsCache.get(year);
    if (cached) return cached;

    const url = `${this.baseUrl}/California_${year}_ballot_propositions`;
    console.log(`[Ballotpedia] Fetching year results: ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; CA-Proposition-Predictor/1.0)',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.log(`[Ballotpedia] Year page returned ${response.status} for ${year}`);
        return { results: new Map(), statuses: new Map() };
      }

      const html = await response.text();
      const parsed = this.parseResultsTable(html);

      console.log(`[Ballotpedia] Parsed ${parsed.results.size} full results, ${parsed.statuses.size} statuses for ${year}`);
      this.resultsCache.set(year, parsed);
      return parsed;
    } catch (error) {
      console.error(`[Ballotpedia] Error fetching year results for ${year}:`, error);
      return { results: new Map(), statuses: new Map() };
    }
  }

  /**
   * Fetch upcoming/confirmed measures from Ballotpedia that haven't been voted on yet.
   * These are measures listed under "On the ballot" that don't have results.
   * Used for future election years where CA SOS Quick Guide has no data yet.
   */
  async fetchUpcomingMeasures(year: number): Promise<BallotpediaUpcomingMeasure[]> {
    const cached = this.upcomingCache.get(year);
    if (cached) return cached;

    const url = `${this.baseUrl}/California_${year}_ballot_propositions`;
    console.log(`[Ballotpedia] Fetching upcoming measures: ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; CA-Proposition-Predictor/1.0)',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.log(`[Ballotpedia] Year page returned ${response.status} for ${year}`);
        return [];
      }

      const html = await response.text();
      const measures = this.parseUpcomingTable(html);

      // Fetch individual measure pages in parallel to get legislative bill numbers
      await Promise.all(
        measures.map(async (measure) => {
          try {
            const billNumber = await this.fetchBillNumber(measure.url);
            if (billNumber) measure.billNumber = billNumber;
          } catch {
            // Non-critical — continue without bill number
          }
        })
      );

      console.log(`[Ballotpedia] Parsed ${measures.length} upcoming measures for ${year}`);
      this.upcomingCache.set(year, measures);
      return measures;
    } catch (error) {
      console.error(`[Ballotpedia] Error fetching upcoming measures for ${year}:`, error);
      return [];
    }
  }

  /**
   * Parse upcoming measures from the Ballotpedia year page.
   * These tables have columns: Type | Title | Subject | Description (no Result/votes).
   * Measure titles are links like "Allow Public Financing of Election Campaigns Measure".
   */
  private parseUpcomingTable(html: string): BallotpediaUpcomingMeasure[] {
    const measures: BallotpediaUpcomingMeasure[] = [];

    // Match table rows that contain measure links but NO result indicators (Approved/Defeated)
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const rowHtml = rowMatch[1];

      // Skip rows that have results (those are handled by parseResultsTable)
      if (/(?:alt|title)=["']?(?:Approved|Defeated)["']?/i.test(rowHtml)) continue;
      if (/>Approved</.test(rowHtml) || />Defeated</.test(rowHtml)) continue;

      // Skip header rows
      if (/<th[\s>]/i.test(rowHtml)) continue;

      // Extract cells
      const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let cellMatch;
      while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1]);
      }

      // Need at least 4 cells: Type, Title, Subject, Description
      if (cells.length < 4) continue;

      // Extract type from first cell (e.g. "LRSS", "LRCA", "CICS")
      const type = cells[0].replace(/<[^>]+>/g, '').trim();
      if (!type || type.length > 10) continue; // Skip non-type rows

      // Extract title and URL from second cell
      const titleLinkMatch = cells[1].match(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleLinkMatch) continue;

      const measureUrl = titleLinkMatch[1].startsWith('http')
        ? titleLinkMatch[1]
        : `${this.baseUrl}${titleLinkMatch[1]}`;
      const title = decodeHtmlEntities(titleLinkMatch[2].replace(/<[^>]+>/g, '')).trim();

      if (!title || title.length < 5) continue;

      // Extract subject from third cell
      const subject = decodeHtmlEntities(cells[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

      // Extract description from fourth cell: strip tags, decode entities, truncate at section markers
      const rawDescription = decodeHtmlEntities(cells[3].replace(/<[^>]+>/g, ''));
      const description = extractDescription(rawDescription);

      measures.push({ title, type, subject, description, url: measureUrl });
    }

    return measures;
  }

  /**
   * Fetch the legislative bill number from an individual Ballotpedia measure page.
   * Looks for patterns like "Senate Bill 42 (SB 42)", "Assembly Constitutional Amendment 13 (ACA 13)", etc.
   */
  private async fetchBillNumber(url: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; CA-Proposition-Predictor/1.0)',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return null;

      const html = await response.text();
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

      // 1. Look for "Full Name N (ABBR N)" pattern:
      //    "Senate Bill 42 (SB 42)", "Assembly Constitutional Amendment 13 (ACA 13)"
      const parenMatch = text.match(
        /(?:Senate|Assembly)\s+(?:Constitutional\s+Amendment|Bill|Concurrent\s+Resolution)\s+\d+\s*\(([A-Z]{2,4}\s+\d+)\)/i
      );
      if (parenMatch) return parenMatch[1].toUpperCase();

      // 2. Look for abbreviation near action verbs that indicate THIS measure's bill:
      //    "passed SB 42", "signed SB 42", "introduced SCA 1"
      const actionMatch = text.match(
        /(?:passed|signed|introduced|approved)\s+((?:SB|AB|SCA|ACA|SCR|ACR)\s+\d+)/i
      );
      if (actionMatch) return actionMatch[1].toUpperCase();

      // 3. Derive from full name: "Senate Constitutional Amendment 1" → "SCA 1"
      const fullNameMatch = text.match(
        /(Senate|Assembly)\s+(Constitutional\s+Amendment|Bill|Concurrent\s+Resolution)\s+(\d+)/i
      );
      if (fullNameMatch) {
        const chamber = fullNameMatch[1][0].toUpperCase(); // S or A
        const typeWord = fullNameMatch[2].toLowerCase();
        let abbr = chamber + 'B'; // default: SB or AB
        if (typeWord.includes('constitutional')) abbr = chamber + 'CA';
        else if (typeWord.includes('concurrent')) abbr = chamber + 'CR';
        return `${abbr} ${fullNameMatch[3]}`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse the results table from a Ballotpedia year overview page.
   *
   * Recent years (2022+): Table has Type | Title | Subject | Description | Result | Yes Votes | No Votes
   * Older years (2020-): Table has Type | Title | Subject | Description | Result (no vote counts)
   *
   * Result column contains images with alt text "Approved" or "Defeated".
   * Vote columns format (when present): "X,XXX,XXX (##%)"
   */
  private parseResultsTable(html: string): BallotpediaYearResults {
    const results = new Map<string, PropositionResult>();
    const statuses = new Map<string, boolean>();
    const titles = new Map<string, string>();

    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const rowHtml = rowMatch[1];

      // Extract proposition number from link text like "Proposition 36" or "Proposition 1"
      const propMatch = rowHtml.match(/Proposition\s+(\d+)/i);
      if (!propMatch) continue;

      const propNumber = propMatch[1];

      // Extract the proposition title from the <a> link in this row
      const titleLinkMatch = rowHtml.match(/<a[^>]+href="[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      if (titleLinkMatch) {
        const rawTitle = decodeHtmlEntities(titleLinkMatch[1].replace(/<[^>]+>/g, '')).trim();
        if (rawTitle.length > 5) {
          titles.set(propNumber, rawTitle);
        }
      }

      // Check for result: "Approved" or "Defeated" in alt text or link text
      const approved = /(?:alt|title)=["']?Approved["']?/i.test(rowHtml) ||
        />Approved</.test(rowHtml);
      const defeated = /(?:alt|title)=["']?Defeated["']?/i.test(rowHtml) ||
        />Defeated</.test(rowHtml);

      if (!approved && !defeated) continue;

      // Extract vote data: pattern "NUMBER (PERCENTAGE%)"
      const votePattern = /([\d,]+)\s*\((\d+(?:\.\d+)?)%\)/g;
      const votes: Array<{ count: number; percent: number }> = [];
      let voteMatch;

      while ((voteMatch = votePattern.exec(rowHtml)) !== null) {
        votes.push({
          count: parseInt(voteMatch[1].replace(/,/g, '')),
          percent: parseFloat(voteMatch[2]),
        });
      }

      // Full result with vote data (2022+ pages)
      if (votes.length >= 2) {
        results.set(propNumber, {
          passed: approved,
          yesVotes: votes[0].count,
          noVotes: votes[1].count,
          yesPercentage: votes[0].percent,
          noPercentage: votes[1].percent,
          totalVotes: votes[0].count + votes[1].count,
          turnout: 0,
        });
      } else {
        // Status only — no vote counts on this page (older years)
        statuses.set(propNumber, approved);
      }
    }

    return { results, statuses, titles };
  }

  /**
   * Get measure information from Ballotpedia
   */
  async getMeasure(year: number, number: string): Promise<BallotpediaMeasure | null> {
    try {
      // Ballotpedia uses a specific URL format
      // Example: https://ballotpedia.org/California_Proposition_36_(2024)
      const url = `${this.baseUrl}/California_Proposition_${number}_(${year})`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'CA-Proposition-Predictor/1.0',
        },
        next: { revalidate: 3600 },
      });

      if (!response.ok) {
        return null;
      }

      // In production, we would parse the HTML response
      // For now, return null as we'd need proper HTML parsing
      return null;
    } catch (error) {
      console.error('Error fetching from Ballotpedia:', error);
      return null;
    }
  }

  /**
   * Analyze ballot wording for readability and sentiment
   */
  analyzeBallotWording(
    title: string,
    summary: string,
    fullText?: string
  ): BallotWordingAnalysis {
    const text = fullText || summary;
    const wordCount = text.split(/\s+/).length;

    // Calculate Flesch-Kincaid readability
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/);
    const syllables = this.countSyllables(text);

    const avgSentenceLength = words.length / Math.max(sentences.length, 1);
    const avgSyllablesPerWord = syllables / Math.max(words.length, 1);

    // Flesch Reading Ease score (0-100, higher = easier)
    const readabilityScore = Math.max(0, Math.min(100,
      206.835 - (1.015 * avgSentenceLength) - (84.6 * avgSyllablesPerWord)
    ));

    // Simple sentiment analysis
    const sentimentScore = this.analyzeSentiment(title + ' ' + summary);

    // Determine complexity
    let complexity: 'simple' | 'moderate' | 'complex' = 'moderate';
    if (readabilityScore >= 60) complexity = 'simple';
    else if (readabilityScore < 40) complexity = 'complex';

    // Extract key phrases (simple implementation)
    const keyPhrases = this.extractKeyPhrases(text);

    return {
      propositionId: '',
      wordCount,
      readabilityScore: Math.round(readabilityScore),
      sentimentScore: Math.round(sentimentScore * 100) / 100,
      complexity,
      keyPhrases,
      comparisonToSimilar: {
        avgWordCount: 300, // Historical average
        avgReadability: 45,
      },
    };
  }

  private countSyllables(text: string): number {
    const words = text.toLowerCase().split(/\s+/);
    let total = 0;

    for (const word of words) {
      // Simple syllable counting heuristic
      const cleaned = word.replace(/[^a-z]/g, '');
      if (cleaned.length === 0) continue;

      // Count vowel groups
      const vowelGroups = cleaned.match(/[aeiouy]+/g) || [];
      let syllables = vowelGroups.length;

      // Adjust for silent e
      if (cleaned.endsWith('e') && syllables > 1) {
        syllables--;
      }

      // Minimum 1 syllable per word
      total += Math.max(1, syllables);
    }

    return total;
  }

  private analyzeSentiment(text: string): number {
    // Simple sentiment analysis based on word lists
    const positiveWords = [
      'protect', 'improve', 'benefit', 'support', 'help', 'ensure',
      'provide', 'fund', 'create', 'invest', 'strengthen', 'safe',
      'clean', 'affordable', 'fair', 'equal', 'right', 'freedom'
    ];

    const negativeWords = [
      'tax', 'fee', 'cost', 'burden', 'restrict', 'limit', 'ban',
      'eliminate', 'reduce', 'cut', 'penalty', 'fine', 'mandate',
      'require', 'force', 'risk', 'danger', 'threat'
    ];

    const neutralWords = [
      'amend', 'change', 'modify', 'establish', 'authorize', 'allow',
      'permit', 'regulate', 'determine', 'define'
    ];

    const lowerText = text.toLowerCase();
    const words = lowerText.split(/\s+/);

    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;

    for (const word of words) {
      if (positiveWords.some(pw => word.includes(pw))) positiveCount++;
      if (negativeWords.some(nw => word.includes(nw))) negativeCount++;
      if (neutralWords.some(nw => word.includes(nw))) neutralCount++;
    }

    const total = positiveCount + negativeCount + neutralCount;
    if (total === 0) return 0;

    // Score from -1 (very negative) to 1 (very positive)
    return (positiveCount - negativeCount) / total;
  }

  private extractKeyPhrases(text: string): string[] {
    // Common ballot measure phrases to look for
    const patterns = [
      /authoriz\w* \$?[\d,.]+ (?:billion|million)/gi,
      /\d+(?:\.\d+)?%/g,
      /constitutional amendment/gi,
      /bond (?:measure|act)/gi,
      /tax (?:increase|decrease|on)/gi,
      /minimum wage/gi,
      /voter approval/gi,
      /state legislature/gi,
      /local government/gi,
      /general fund/gi,
    ];

    const phrases: string[] = [];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        phrases.push(...matches.map(m => m.toLowerCase()));
      }
    }

    // Also extract capitalized phrases (likely proper nouns/titles)
    const capitalizedPhrases = text.match(/[A-Z][a-z]+(?: [A-Z][a-z]+)+/g);
    if (capitalizedPhrases) {
      phrases.push(...capitalizedPhrases.slice(0, 3));
    }

    // Remove duplicates and limit
    return Array.from(new Set(phrases)).slice(0, 10);
  }

  /**
   * Get polling data for a measure
   */
  async getPolling(_year: number, _number: string): Promise<PollData[]> {
    // Ballotpedia aggregates polling data
    // Would need to scrape their polling sections
    // For now, return empty array
    return [];
  }

  /**
   * Get endorsements for a measure
   */
  async getEndorsements(_year: number, _number: string): Promise<Endorsement[]> {
    // Would scrape endorsement sections from Ballotpedia
    return [];
  }
}

export const ballotpediaClient = new BallotpediaClient();
export default ballotpediaClient;
