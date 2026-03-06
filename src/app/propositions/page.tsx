'use client';

import { useState, useEffect, useRef } from 'react';
import { PropositionCard } from '@/components/features';
import {
  Card,
  CardContent,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Badge,
} from '@/components/ui';
import { Search, Filter, Calendar, Loader2, BarChart3, TrendingUp, CheckCircle, XCircle } from 'lucide-react';
import { Proposition, PropositionPrediction, PropositionCategory, ApiResponse } from '@/types';

const categories: { value: PropositionCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All Categories' },
  { value: 'taxation', label: 'Taxation' },
  { value: 'education', label: 'Education' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'environment', label: 'Environment' },
  { value: 'criminal_justice', label: 'Criminal Justice' },
  { value: 'labor', label: 'Labor' },
  { value: 'housing', label: 'Housing' },
  { value: 'transportation', label: 'Transportation' },
  { value: 'government', label: 'Government' },
  { value: 'civil_rights', label: 'Civil Rights' },
];

const FALLBACK_YEARS = ['2026', '2025', '2024', '2022', '2020', '2018', '2016'];
const INITIAL_BATCH = 5;
const BG_BATCH = 5;

async function fetchYearPropositions(year: string): Promise<Proposition[]> {
  try {
    const res = await fetch(`/api/propositions?year=${year}&perPage=200`);
    const data: ApiResponse<Proposition[]> = await res.json();
    return data.success ? data.data : [];
  } catch {
    return [];
  }
}

function sortPropositions(props: Proposition[]): Proposition[] {
  return [...props].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return parseInt(a.number) - parseInt(b.number);
  });
}

async function loadPredictions(
  props: Proposition[]
): Promise<Record<string, PropositionPrediction>> {
  const upcoming = props.filter(p => p.status === 'upcoming');
  const results = await Promise.all(
    upcoming.map(async (prop) => {
      try {
        const res = await fetch(`/api/predictions/${prop.id}`);
        const data = await res.json();
        if (data.success) return { id: prop.id, prediction: data.data };
      } catch { /* ignore */ }
      return null;
    })
  );
  const map: Record<string, PropositionPrediction> = {};
  results.forEach(r => { if (r) map[r.id] = r.prediction; });
  return map;
}

export default function PropositionsPage() {
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [predictions, setPredictions] = useState<Record<string, PropositionPrediction>>({});
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [yearsLoaded, setYearsLoaded] = useState(0);
  const [totalYears, setTotalYears] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const availableYearsRef = useRef<string[]>([]);
  availableYearsRef.current = availableYears;

  // Each new load gets a unique key; background loops check this to know when to stop
  const loadingKeyRef = useRef(0);

  // Load available years once on mount
  useEffect(() => {
    fetch('/api/propositions/years')
      .then(r => r.json())
      .then((data: ApiResponse<number[]>) => {
        if (data.success) setAvailableYears(data.data.map(String));
      })
      .catch(() => {});
  }, []);

  // Load / reload whenever the year filter or available-years list changes
  useEffect(() => {
    const currentKey = ++loadingKeyRef.current;

    const load = async () => {
      setIsInitialLoading(true);
      setIsBackgroundLoading(false);
      setError(null);
      setPropositions([]);
      setPredictions({});
      setYearsLoaded(0);

      try {
        if (selectedYear !== 'all') {
          // Single year – fetch everything at once
          const props = await fetchYearPropositions(selectedYear);
          if (loadingKeyRef.current !== currentKey) return;
          const sorted = sortPropositions(props);
          setPropositions(sorted);
          setYearsLoaded(1);
          setTotalYears(1);
          setIsInitialLoading(false);
          const preds = await loadPredictions(sorted);
          if (loadingKeyRef.current !== currentKey) return;
          setPredictions(preds);
        } else {
          const yearsSource = availableYearsRef.current.length > 0
            ? availableYearsRef.current
            : FALLBACK_YEARS;
          setTotalYears(yearsSource.length);

          // ── Phase 1: show the first batch immediately ──
          const initialBatch = yearsSource.slice(0, INITIAL_BATCH);
          const initResults = await Promise.all(initialBatch.map(fetchYearPropositions));
          if (loadingKeyRef.current !== currentKey) return;

          const initProps = sortPropositions(initResults.flat());
          setPropositions(initProps);
          setYearsLoaded(INITIAL_BATCH);
          setIsInitialLoading(false);

          // Predictions for initial batch (non-blocking)
          loadPredictions(initProps).then(preds => {
            if (loadingKeyRef.current === currentKey)
              setPredictions(preds);
          });

          // ── Phase 2: load remaining years in the background ──
          if (yearsSource.length > INITIAL_BATCH) {
            setIsBackgroundLoading(true);
            let loaded = INITIAL_BATCH;

            for (let i = INITIAL_BATCH; i < yearsSource.length; i += BG_BATCH) {
              if (loadingKeyRef.current !== currentKey) return;

              const batch = yearsSource.slice(i, i + BG_BATCH);
              const batchResults = await Promise.all(batch.map(fetchYearPropositions));
              if (loadingKeyRef.current !== currentKey) return;

              const newProps = batchResults.flat();
              loaded += batch.length;
              setPropositions(prev => sortPropositions([...prev, ...newProps]));
              setYearsLoaded(loaded);

              // Predictions for newly loaded upcoming props (non-blocking)
              loadPredictions(newProps).then(preds => {
                if (loadingKeyRef.current === currentKey)
                  setPredictions(prev => ({ ...prev, ...preds }));
              });
            }

            if (loadingKeyRef.current === currentKey)
              setIsBackgroundLoading(false);
          }
        }
      } catch {
        if (loadingKeyRef.current === currentKey) {
          setError('Network error. Please try again.');
          setIsInitialLoading(false);
          setIsBackgroundLoading(false);
        }
      }
    };

    load();
  }, [selectedYear, availableYears]);

  // Client-side filtering (instant)
  const filteredPropositions = propositions.filter((prop) => {
    const matchesSearch =
      searchQuery === '' ||
      prop.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prop.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prop.number.includes(searchQuery);
    const matchesCategory = selectedCategory === 'all' || prop.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || prop.status === selectedStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const upcomingCount = filteredPropositions.filter((p) => p.status === 'upcoming').length;
  const passedCount = filteredPropositions.filter((p) => p.status === 'passed').length;
  const failedCount = filteredPropositions.filter((p) => p.status === 'failed').length;

  const loadProgress = totalYears > 0 ? Math.round((yearsLoaded / totalYears) * 100) : 0;

  return (
    <div className="animate-fade-in bg-white">
      {/* Header */}
      <section className="bg-white py-12 border-b-4 border-blue-900">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl">
            <Badge className="mb-4 bg-blue-900 text-white border-0 px-4 py-1 text-sm font-semibold">
              Ballot Measures Database
            </Badge>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              California Propositions
            </h1>
            <p className="text-xl text-gray-700 leading-relaxed">
              Browse and analyze statewide ballot propositions with prediction data,
              campaign finance tracking, and historical voting patterns.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Cards */}
      <section className="py-8 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border-2 border-gray-200 rounded p-6">
              <div className="flex items-center justify-center mb-3">
                <BarChart3 className="h-6 w-6 text-blue-900" />
              </div>
              <p className="text-3xl font-bold text-gray-900 text-center">
                {isInitialLoading ? '-' : filteredPropositions.length}
              </p>
              <p className="text-sm text-gray-600 text-center mt-1">Total Propositions</p>
            </div>
            <div className="bg-white border-2 border-gray-200 rounded p-6">
              <div className="flex items-center justify-center mb-3">
                <TrendingUp className="h-6 w-6 text-blue-900" />
              </div>
              <p className="text-3xl font-bold text-blue-900 text-center">
                {isInitialLoading ? '-' : upcomingCount}
              </p>
              <p className="text-sm text-gray-600 text-center mt-1">Upcoming</p>
            </div>
            <div className="bg-white border-2 border-gray-200 rounded p-6">
              <div className="flex items-center justify-center mb-3">
                <CheckCircle className="h-6 w-6 text-green-700" />
              </div>
              <p className="text-3xl font-bold text-green-700 text-center">
                {isInitialLoading ? '-' : passedCount}
              </p>
              <p className="text-sm text-gray-600 text-center mt-1">Passed</p>
            </div>
            <div className="bg-white border-2 border-gray-200 rounded p-6">
              <div className="flex items-center justify-center mb-3">
                <XCircle className="h-6 w-6 text-red-700" />
              </div>
              <p className="text-3xl font-bold text-red-700 text-center">
                {isInitialLoading ? '-' : failedCount}
              </p>
              <p className="text-sm text-gray-600 text-center mt-1">Failed</p>
            </div>
          </div>
        </div>
      </section>

      {/* Filters & Content */}
      <section className="py-8 bg-white">
        <div className="container mx-auto px-4">
          {/* Filters */}
          <Card className="mb-8 border-2 border-gray-200">
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search propositions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 border-2 border-gray-200 focus:border-blue-900"
                    />
                  </div>
                </div>

                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-full md:w-48 border-2 border-gray-200">
                    <Filter className="h-4 w-4 mr-2 text-blue-900" />
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-full md:w-32 border-2 border-gray-200">
                    <Calendar className="h-4 w-4 mr-2 text-blue-900" />
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Years</SelectItem>
                    {availableYears.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-full md:w-36 border-2 border-gray-200">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="passed">Passed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {error && (
            <Card className="mb-8 border-2 border-red-300 bg-red-50">
              <CardContent className="py-4 text-center text-red-700 font-medium">
                {error}
              </CardContent>
            </Card>
          )}

          {/* Background loading progress bar */}
          {isBackgroundLoading && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading historical data… {yearsLoaded} / {totalYears} years
                </span>
                <span className="text-xs text-gray-400">{loadProgress}%</span>
              </div>
              <div className="h-1 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-900 transition-all duration-500"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Initial loading spinner */}
          {isInitialLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-900" />
              <span className="ml-3 text-gray-700 font-medium">Loading propositions…</span>
            </div>
          ) : (
            <>
              {/* Results header */}
              <div className="mb-6 flex items-center justify-between">
                <p className="text-gray-600 font-medium">
                  Showing {filteredPropositions.length} propositions
                </p>
                {filteredPropositions.length > 0 && (
                  <div className="flex gap-2">
                    <Badge className="bg-blue-900 text-white border-0">{upcomingCount} upcoming</Badge>
                    <Badge className="bg-green-700 text-white border-0">{passedCount} passed</Badge>
                    <Badge className="bg-red-700 text-white border-0">{failedCount} failed</Badge>
                  </div>
                )}
              </div>

              {filteredPropositions.length === 0 ? (
                <Card className="border-2 border-gray-200">
                  <CardContent className="py-16 text-center">
                    <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">No propositions found matching your criteria.</p>
                    <p className="text-gray-500 text-sm mt-2">Try adjusting your filters or search query.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredPropositions.map((proposition) => (
                    <PropositionCard
                      key={proposition.id}
                      proposition={proposition}
                      prediction={predictions[proposition.id]}
                      showPrediction={proposition.status === 'upcoming'}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
