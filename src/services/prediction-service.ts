/**
 * Prediction Engine Service
 *
 * Calculates probability of proposition passage using ONLY real data.
 * Does not fabricate predictions when data is unavailable.
 *
 * Real data sources used:
 * - Historical pass rates: Ballotpedia election results for same-category propositions
 * - Campaign finance: Cal-Access support/opposition spending ratios
 *
 * NOT used (because they produce no real signal):
 * - Arbitrary timing coefficients
 * - Word-list sentiment scores
 * - Opposition count formulas
 * - Default 0.5 fallbacks when data is missing
 */

import {
  PropositionPrediction,
  PredictionFactor,
  HistoricalComparison,
  PropositionWithDetails,
  DataQuality,
  Proposition,
  Scenario,
  ScenarioResults,
} from '@/types';
import { clamp } from '@/lib/utils';
import { caSosClient } from '@/lib/external-apis';

interface PredictionInput {
  proposition: PropositionWithDetails;
  includeHistorical?: boolean;
}

class PredictionService {
  async generatePrediction(input: PredictionInput): Promise<PropositionPrediction> {
    const factors: PredictionFactor[] = [];
    const dataSources: string[] = [];

    // 1. Find historically similar propositions (real Ballotpedia vote data)
    const historicalComparison = input.includeHistorical
      ? await this.findSimilarPropositions(input.proposition)
      : [];

    const historicalFactor = this.calculateHistoricalFactor(historicalComparison);
    if (historicalFactor) {
      factors.push(historicalFactor);
      dataSources.push('Ballotpedia historical results');
    }

    // 2. Campaign finance (real Cal-Access data — only when actual spending exists)
    const financeFactor = this.calculateFinanceFactor(input.proposition);
    if (financeFactor) {
      factors.push(financeFactor);
      dataSources.push('Cal-Access campaign finance');
    }

    // Compute probability from real factors only
    let passageProbability: number;
    let dataQuality: DataQuality;

    if (factors.length === 0) {
      // No real data — don't fake a number
      passageProbability = 0;
      dataQuality = 'limited';
    } else if (factors.length === 1) {
      passageProbability = factors[0].value;
      dataQuality = 'moderate';
    } else {
      // Both finance and historical data available
      // Finance is generally a stronger short-term signal for specific measures.
      // Historical base rate provides the category-level prior.
      const finance = factors.find(f => f.name === 'campaignFinance');
      const historical = factors.find(f => f.name === 'historicalPassRate');
      if (finance && historical) {
        passageProbability = finance.value * 0.6 + historical.value * 0.4;
      } else {
        passageProbability = factors.reduce((sum, f) => sum + f.value, 0) / factors.length;
      }
      dataQuality = 'strong';
    }

    return {
      propositionId: input.proposition.id,
      passageProbability: factors.length > 0 ? clamp(passageProbability, 0, 1) : 0,
      dataQuality,
      dataSources,
      factors,
      historicalComparison,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Calculate base rate from real historical election results.
   *
   * Uses the binary pass/fail rate of same-category propositions with
   * Bayesian shrinkage toward 50% to avoid extreme values from small samples.
   *
   * Beta(1,1) uniform prior → posterior mean = (1 + passes) / (2 + total).
   * This means:
   *   n=1, 1 pass  → 67% (not 100%)
   *   n=3, 2 pass  → 60%
   *   n=5, 4 pass  → 71%
   *   n=10, 7 pass → 67%
   *
   * Requires at least 2 comparisons — fewer is not enough data.
   */
  private calculateHistoricalFactor(
    comparisons: HistoricalComparison[]
  ): PredictionFactor | null {
    if (comparisons.length < 2) return null;

    const passedCount = comparisons.filter(c => c.result === 'passed').length;
    // Bayesian posterior mean with uniform Beta(1,1) prior
    const passRate = (1 + passedCount) / (2 + comparisons.length);

    const impact = passRate > 0.55 ? 'positive' : passRate < 0.45 ? 'negative' : 'neutral';

    return {
      name: 'historicalPassRate',
      value: clamp(passRate, 0.1, 0.9),
      impact,
      description: `${passedCount} of ${comparisons.length} similar past propositions in this category passed`,
      source: 'Ballotpedia election results',
      hasRealData: true,
    };
  }

  /**
   * Calculate prediction factor from real campaign finance data.
   * Returns null when no spending data exists in Cal-Access.
   */
  private calculateFinanceFactor(proposition: PropositionWithDetails): PredictionFactor | null {
    const finance = proposition.finance;
    if (!finance) return null;

    const total = finance.totalSupport + finance.totalOpposition;
    if (total === 0) return null;

    // The support ratio directly reflects the financial balance of the campaign.
    // If 70% of money supports it, the finance signal is 0.70.
    // Clamped to avoid treating 99% of money on one side as 99% probability.
    const supportRatio = finance.totalSupport / total;
    const value = clamp(supportRatio, 0.15, 0.85);
    const impact = supportRatio > 0.55 ? 'positive' : supportRatio < 0.45 ? 'negative' : 'neutral';

    const formatMoney = (n: number) => {
      if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
      return `$${n}`;
    };

    return {
      name: 'campaignFinance',
      value,
      impact,
      description: `${formatMoney(finance.totalSupport)} supporting vs ${formatMoney(finance.totalOpposition)} opposing (${(supportRatio * 100).toFixed(0)}% support share)`,
      source: 'Cal-Access',
      hasRealData: true,
    };
  }

  /**
   * Find historically similar propositions by category.
   * Fetches real Ballotpedia election results for past years.
   */
  private async findSimilarPropositions(
    proposition: PropositionWithDetails
  ): Promise<HistoricalComparison[]> {
    try {
      const currentYear = new Date().getFullYear();
      const yearsToSearch: number[] = [];

      for (let y = currentYear; y >= currentYear - 10; y--) {
        if (y !== proposition.year && (y % 2 === 0 || y >= currentYear - 1)) {
          yearsToSearch.push(y);
        }
      }

      // Fetch past propositions in parallel (limit to 6 years for more historical data)
      const yearResults = await Promise.all(
        yearsToSearch.slice(0, 6).map(y =>
          caSosClient.getPropositionsByYear(y).catch(() => [])
        )
      );

      const allProps = yearResults.flat();
      const comparisons: HistoricalComparison[] = [];

      for (const prop of allProps) {
        if (!prop.result) continue;
        if (prop.category !== proposition.category) continue;

        const similarity = this.calculateSimilarity(proposition, prop);
        if (similarity < 0.2) continue;

        comparisons.push({
          propositionId: prop.id,
          propositionNumber: prop.number,
          year: prop.year,
          similarity,
          result: prop.result.passed ? 'passed' : 'failed',
          yesPercentage: prop.result.yesPercentage,
        });
      }

      return comparisons
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  private calculateSimilarity(target: Proposition, candidate: Proposition): number {
    let score = 0;

    if (target.category !== candidate.category) return 0;
    score += 0.6;

    const targetWords = this.extractKeywords(target.title);
    const candidateWords = this.extractKeywords(candidate.title);
    const overlap = targetWords.filter(w => candidateWords.includes(w)).length;
    const maxPossible = Math.max(targetWords.length, candidateWords.length, 1);
    score += (overlap / maxPossible) * 0.3;

    const yearDiff = Math.abs(target.year - candidate.year);
    score += Math.max(0, 0.1 - yearDiff * 0.02);

    return Math.min(score, 1);
  }

  private extractKeywords(title: string): string[] {
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at',
      'by', 'from', 'with', 'as', 'is', 'was', 'are', 'be', 'been', 'being',
      'that', 'this', 'it', 'its', 'not', 'no', 'all', 'any', 'each', 'which',
    ]);
    return title
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  // ============ Scenario support ============

  async runScenario(
    proposition: PropositionWithDetails,
    scenario: Scenario
  ): Promise<ScenarioResults> {
    const originalPrediction = await this.generatePrediction({
      proposition,
      includeHistorical: true,
    });

    const modifiedProposition = this.applyScenarioParameters(proposition, scenario);
    const scenarioPrediction = await this.generatePrediction({
      proposition: modifiedProposition,
      includeHistorical: true,
    });

    const probabilityDelta = scenarioPrediction.passageProbability - originalPrediction.passageProbability;

    return {
      originalProbability: originalPrediction.passageProbability,
      newProbability: scenarioPrediction.passageProbability,
      probabilityDelta,
      confidenceInterval: {
        lower: clamp(scenarioPrediction.passageProbability - 0.1, 0, 1),
        upper: clamp(scenarioPrediction.passageProbability + 0.1, 0, 1),
      },
      factorContributions: this.calculateFactorContributions(
        originalPrediction.factors,
        scenarioPrediction.factors
      ),
      sensitivityAnalysis: [],
    };
  }

  private applyScenarioParameters(
    proposition: PropositionWithDetails,
    scenario: Scenario
  ): PropositionWithDetails {
    const modified = { ...proposition };

    // Only apply funding changes — the one scenario parameter that maps to real data
    if (scenario.parameters.funding) {
      const baseFinance = modified.finance || {
        propositionId: modified.id,
        totalSupport: 0,
        totalOpposition: 0,
        supportCommittees: [],
        oppositionCommittees: [],
        topDonors: [],
        lastUpdated: new Date().toISOString(),
      };

      modified.finance = {
        ...baseFinance,
        totalSupport: baseFinance.totalSupport * scenario.parameters.funding.supportMultiplier,
        totalOpposition: baseFinance.totalOpposition * scenario.parameters.funding.oppositionMultiplier,
      };
    }

    return modified;
  }

  private calculateFactorContributions(
    originalFactors: PredictionFactor[],
    newFactors: PredictionFactor[]
  ): { factor: string; originalImpact: number; adjustedImpact: number; contribution: number }[] {
    // Match factors by name since factor lists may differ in length
    return originalFactors.map((original) => {
      const adjusted = newFactors.find(f => f.name === original.name);
      const adjustedValue = adjusted ? adjusted.value : original.value;
      return {
        factor: original.name,
        originalImpact: original.value,
        adjustedImpact: adjustedValue,
        contribution: adjustedValue - original.value,
      };
    });
  }
}

export const predictionService = new PredictionService();
export default predictionService;
