'use client';

import Link from 'next/link';
import { PredictionDisplay, FinanceChart, ScenarioBuilder, ScenarioResultsDisplay } from '@/components/features';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui';
import { formatDate, formatCurrency } from '@/lib/utils';
import {
  ArrowLeft,
  Calendar,
  Users,
  FileText,
  ExternalLink,
  TrendingUp,
  DollarSign,
  Zap,
  Loader2,
} from 'lucide-react';
import {
  PropositionWithDetails,
  PropositionPrediction,
  Scenario,
  ApiResponse,
} from '@/types';
import { useState, useEffect } from 'react';

interface PageProps {
  params: { id: string };
}

export default function PropositionDetailPage({ params }: PageProps) {
  const { id } = params;
  const [proposition, setProposition] = useState<PropositionWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scenarioResults, setScenarioResults] = useState<Scenario | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch proposition details and prediction in parallel
        const [propResponse, predResponse] = await Promise.all([
          fetch(`/api/propositions/${id}`),
          fetch(`/api/predictions/${id}`),
        ]);

        const propData: ApiResponse<PropositionWithDetails> = await propResponse.json();
        if (!propData.success) {
          setError(propData.error?.message || 'Failed to fetch proposition');
          return;
        }

        const prop = propData.data;

        // Attach prediction if available
        try {
          const predData: ApiResponse<PropositionPrediction> = await predResponse.json();
          if (predData.success) {
            prop.prediction = predData.data;
          }
        } catch {
          // Prediction fetch failed, continue without it
        }

        setProposition(prop);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleScenarioRun = (scenario: Scenario) => {
    setScenarioResults(scenario);
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-blue-900" />
        <span className="ml-3 text-gray-700 font-medium">Loading proposition...</span>
      </div>
    );
  }

  if (error || !proposition) {
    return (
      <div className="bg-white min-h-[60vh]">
        <div className="container mx-auto px-4 py-8">
          <Link
            href="/propositions"
            className="inline-flex items-center text-sm text-blue-900 hover:text-blue-700 font-medium mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Propositions
          </Link>
          <Card className="border-2 border-red-300 bg-red-50">
            <CardContent className="py-12 text-center text-red-700 font-medium">
              {error || 'Proposition not found.'}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const statusStyles = {
    upcoming: 'bg-blue-900 text-white',
    active: 'bg-blue-600 text-white',
    passed: 'bg-green-700 text-white',
    failed: 'bg-red-700 text-white',
  } as const;

  return (
    <div className="animate-fade-in bg-white">
      {/* Header Section */}
      <section className="bg-white py-8 border-b-4 border-blue-900">
        <div className="container mx-auto px-4">
          <Link
            href="/propositions"
            className="inline-flex items-center text-sm text-blue-900 hover:text-blue-700 font-medium mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Propositions
          </Link>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge className={`${statusStyles[proposition.status]} border-0 px-3 py-1 text-sm font-semibold`}>
              {proposition.status}
            </Badge>
            <Badge className="bg-gray-100 text-gray-700 border border-gray-300 text-sm font-semibold">
              {proposition.category.replace(/_/g, ' ')}
            </Badge>
            <Badge className="bg-gray-100 text-gray-700 border border-gray-300 text-sm font-semibold">
              {proposition.year}
            </Badge>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            Proposition {proposition.number}: {proposition.title}
          </h1>
          <p className="text-lg text-gray-600 max-w-4xl">{proposition.summary}</p>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="py-6 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border-2 border-gray-200 rounded p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-900 rounded flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">Election Date</p>
                  <p className="font-bold text-gray-900">{formatDate(proposition.electionDate)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white border-2 border-gray-200 rounded p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-900 rounded flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">Prediction</p>
                  <p className={`font-bold ${proposition.prediction && proposition.prediction.passageProbability >= 0.5 ? 'text-blue-900' : 'text-red-700'}`}>
                    {proposition.prediction
                      ? `${(proposition.prediction.passageProbability * 100).toFixed(0)}% likely to pass`
                      : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white border-2 border-gray-200 rounded p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-700 rounded flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">Total Funding</p>
                  <p className="font-bold text-gray-900">
                    {proposition.finance
                      ? formatCurrency(
                          proposition.finance.totalSupport + proposition.finance.totalOpposition,
                          true
                        )
                      : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white border-2 border-gray-200 rounded p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded flex items-center justify-center">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">Sponsors</p>
                  <p className="font-bold text-gray-900">
                    {proposition.sponsors && proposition.sponsors.length > 0
                      ? proposition.sponsors.length
                      : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Election Results */}
      {proposition.result && (
        <section className="py-6 bg-white">
          <div className="container mx-auto px-4">
            <Card className="border-2 border-gray-200">
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="flex items-center gap-3">
                  <Badge className={`${proposition.result.passed ? 'bg-green-700' : 'bg-red-700'} text-white border-0 px-3 py-1`}>
                    {proposition.result.passed ? 'Passed' : 'Failed'}
                  </Badge>
                  <span className="text-xl font-bold text-gray-900">Election Results</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-bold text-green-700">
                      Yes — {proposition.result.yesPercentage}%
                    </span>
                    <span className="font-bold text-red-700">
                      No — {proposition.result.noPercentage}%
                    </span>
                  </div>
                  <div className="h-4 bg-red-200 rounded overflow-hidden">
                    <div
                      className="h-full bg-green-600"
                      style={{ width: `${proposition.result.yesPercentage}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-4">
                    <div className="text-center p-4 bg-green-50 rounded border border-green-200">
                      <p className="text-2xl font-bold text-green-700">
                        {proposition.result.yesVotes.toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-600 font-medium">Yes Votes</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 rounded border border-red-200">
                      <p className="text-2xl font-bold text-red-700">
                        {proposition.result.noVotes.toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-600 font-medium">No Votes</p>
                    </div>
                    <div className="text-center p-4 bg-gray-50 rounded border border-gray-200">
                      <p className="text-2xl font-bold text-gray-900">
                        {proposition.result.totalVotes.toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-600 font-medium">Total Votes</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Main Content Tabs */}
      <section className="py-8 bg-gray-50">
        <div className="container mx-auto px-4">
          <Tabs defaultValue="prediction" className="space-y-6">
            <TabsList className="w-full justify-start bg-white border-2 border-gray-200 p-1 rounded">
              <TabsTrigger value="prediction" className="gap-2 data-[state=active]:bg-blue-900 data-[state=active]:text-white">
                <TrendingUp className="h-4 w-4" />
                Prediction
              </TabsTrigger>
              <TabsTrigger value="finance" className="gap-2 data-[state=active]:bg-blue-900 data-[state=active]:text-white">
                <DollarSign className="h-4 w-4" />
                Campaign Finance
              </TabsTrigger>
              <TabsTrigger value="scenarios" className="gap-2 data-[state=active]:bg-blue-900 data-[state=active]:text-white">
                <Zap className="h-4 w-4" />
                What-If Scenarios
              </TabsTrigger>
              <TabsTrigger value="details" className="gap-2 data-[state=active]:bg-blue-900 data-[state=active]:text-white">
                <FileText className="h-4 w-4" />
                Full Details
              </TabsTrigger>
            </TabsList>

            <TabsContent value="prediction">
              {proposition.prediction ? (
                <PredictionDisplay
                  prediction={proposition.prediction}
                  showFactors
                  showHistorical
                />
              ) : (
                <Card className="border-2 border-gray-200">
                  <CardContent className="py-16 text-center">
                    <TrendingUp className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Prediction data is not available for this proposition.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="finance">
              {proposition.finance ? (
                <FinanceChart finance={proposition.finance} />
              ) : (
                <Card className="border-2 border-gray-200">
                  <CardContent className="py-16 text-center">
                    <DollarSign className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Campaign finance data is not yet available.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="scenarios">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ScenarioBuilder
                  proposition={proposition}
                  onScenarioRun={handleScenarioRun}
                />
                {scenarioResults ? (
                  <ScenarioResultsDisplay scenario={scenarioResults} />
                ) : (
                  <Card className="border-2 border-gray-200">
                    <CardContent className="py-16 text-center">
                      <div className="w-16 h-16 bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Zap className="h-8 w-8 text-white" />
                      </div>
                      <p className="font-bold text-gray-900 mb-2">No scenario results yet</p>
                      <p className="text-sm text-gray-600">
                        Configure and run a scenario to see how different factors
                        might affect the outcome.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="details">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <Card className="border-2 border-gray-200">
                    <CardHeader className="border-b border-gray-200">
                      <CardTitle className="text-xl font-bold text-gray-900">Full Text Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <p className="text-gray-700 leading-relaxed">{proposition.fullText || proposition.summary}</p>
                    </CardContent>
                  </Card>

                </div>

                <div className="space-y-6">
                  <Card className="border-2 border-gray-200">
                    <CardHeader className="border-b border-gray-200">
                      <CardTitle className="text-lg font-bold text-gray-900">Sponsors</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {proposition.sponsors && proposition.sponsors.length > 0 ? (
                        <ul className="space-y-2">
                          {proposition.sponsors.map((sponsor) => (
                            <li
                              key={sponsor}
                              className="flex items-center gap-3 p-3 bg-green-50 rounded border border-green-200"
                            >
                              <div className="w-2 h-2 bg-green-700 rounded-full" />
                              <span className="text-sm font-medium text-gray-900">{sponsor}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-500">No sponsor data available</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-2 border-gray-200">
                    <CardHeader className="border-b border-gray-200">
                      <CardTitle className="text-lg font-bold text-gray-900">Opponents</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {proposition.opponents && proposition.opponents.length > 0 ? (
                        <ul className="space-y-2">
                          {proposition.opponents.map((opponent) => (
                            <li
                              key={opponent}
                              className="flex items-center gap-3 p-3 bg-red-50 rounded border border-red-200"
                            >
                              <div className="w-2 h-2 bg-red-700 rounded-full" />
                              <span className="text-sm font-medium text-gray-900">{opponent}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-500">No opponent data available</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-2 border-gray-200">
                    <CardHeader className="border-b border-gray-200">
                      <CardTitle className="text-lg font-bold text-gray-900">External Resources</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <ul className="space-y-3">
                        <li>
                          <a
                            href="https://www.sos.ca.gov/elections/ballot-measures"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-blue-900 hover:text-blue-700 font-medium"
                          >
                            CA Secretary of State
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                        <li>
                          <a
                            href="https://cal-access.sos.ca.gov/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-blue-900 hover:text-blue-700 font-medium"
                          >
                            Cal-Access Campaign Finance
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                        <li>
                          <a
                            href="https://ballotpedia.org/California_ballot_propositions"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-blue-900 hover:text-blue-700 font-medium"
                          >
                            Ballotpedia
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </div>
  );
}
