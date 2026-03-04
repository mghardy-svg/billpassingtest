'use client';

import Link from 'next/link';
import { Proposition, PropositionPrediction } from '@/types';
import { Card, CardContent, Badge } from '@/components/ui';
import { formatDate, formatPercentage } from '@/lib/utils';
import { Calendar, Users, ExternalLink } from 'lucide-react';

interface PropositionCardProps {
  proposition: Proposition;
  prediction?: PropositionPrediction;
  showPrediction?: boolean;
}

export function PropositionCard({
  proposition,
  prediction,
  showPrediction = true,
}: PropositionCardProps) {
  const statusStyles = {
    upcoming: 'bg-blue-900 text-white',
    active: 'bg-blue-600 text-white',
    passed: 'bg-green-700 text-white',
    failed: 'bg-red-700 text-white',
  } as const;

  return (
    <Link href={`/propositions/${proposition.id}`}>
      <Card className="h-full hover:shadow-xl transition-shadow cursor-pointer bg-white border-2 border-gray-200">
        <div className={`h-2 ${proposition.status === 'passed' ? 'bg-green-700' : proposition.status === 'failed' ? 'bg-red-700' : 'bg-blue-900'}`} />

        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Badge className={`${statusStyles[proposition.status]} border-0 text-xs font-semibold`}>
                  {proposition.status}
                </Badge>
                <Badge className="bg-gray-100 text-gray-700 border border-gray-300 text-xs font-semibold">
                  {proposition.category.replace(/_/g, ' ')}
                </Badge>
              </div>
              <h3 className="font-display font-bold text-lg text-gray-900">
                Proposition {proposition.number}
              </h3>
              <p className="text-gray-600 mt-1 text-sm line-clamp-2">{proposition.title}</p>
              {proposition.summary && proposition.summary !== proposition.title && proposition.status !== 'upcoming' && (
                <p className="text-gray-500 mt-1 text-xs line-clamp-2">{proposition.summary}</p>
              )}
            </div>
            <span className="text-4xl font-display font-bold text-gray-200 shrink-0">
              {proposition.number}
            </span>
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4 text-blue-900" />
              <span>{formatDate(proposition.electionDate, { month: 'short', year: 'numeric' })}</span>
            </div>
            {proposition.sponsors && proposition.sponsors.length > 0 && (
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4 text-blue-900" />
                <span>{proposition.sponsors.length} sponsors</span>
              </div>
            )}
            <a
              href={`https://ballotpedia.org/California_${proposition.year}_ballot_propositions`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-blue-700 hover:text-blue-900 ml-auto"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="text-xs">Ballotpedia</span>
            </a>
          </div>

          {showPrediction && prediction && (
            <div className="p-4 bg-gray-50 rounded border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">
                  Passage Probability
                </span>
                <span className={`text-2xl font-display font-bold ${prediction.passageProbability >= 0.5 ? 'text-blue-900' : 'text-red-700'}`}>
                  {formatPercentage(prediction.passageProbability)}
                </span>
              </div>
              <div className="h-3 bg-gray-200 rounded overflow-hidden">
                <div
                  className={`h-full ${prediction.passageProbability >= 0.5 ? 'bg-blue-900' : 'bg-red-700'}`}
                  style={{ width: `${prediction.passageProbability * 100}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500 font-medium">
                <span>Fail</span>
                <span className="text-gray-400 capitalize">{prediction.dataQuality} data</span>
                <span>Pass</span>
              </div>
            </div>
          )}

          {proposition.result && (
            <div className="p-4 bg-gray-50 rounded border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">Final Result</span>
                <Badge className={`${proposition.result.passed ? 'bg-green-700' : 'bg-red-700'} text-white border-0`}>
                  {proposition.result.passed ? 'Passed' : 'Failed'}
                </Badge>
              </div>
              <div className="h-3 bg-red-200 rounded overflow-hidden">
                <div
                  className="h-full bg-green-600"
                  style={{ width: `${proposition.result.yesPercentage}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs font-medium">
                <span className="text-green-700">Yes {proposition.result.yesPercentage.toFixed(1)}%</span>
                <span className="text-red-700">No {proposition.result.noPercentage.toFixed(1)}%</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
