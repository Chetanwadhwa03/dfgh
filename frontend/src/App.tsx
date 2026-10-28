import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import axios from 'axios'
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  LoaderCircle,
  RefreshCw,
  Search,
  Wind,
  Zap,
} from 'lucide-react'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import api from './api'

type SyncResponse = {
  message: string
  period: { from: string; to: string }
  actualRecordsProcessed: number
  forecastRecordsProcessed: number
  malformedActualRecordsSkipped: number
  malformedForecastRecordsSkipped: number
  nextSyncAllowedAt: string
}

type ForecastResponse = {
  startTime: string
  decisionCutoff: string
  publishTime: string
  generationMW: number
}

type AccuracyResponse = {
  period: { from: string; to: string }
  decisionRule: string
  metrics: {
    maeMW: number
    rmseMW: number
    biasMW: number
  }
  intervals: {
    eligibleForecastIntervals: number
    evaluatedIntervals: number
    skippedForMissingActuals: number
  }
  dailyMetrics: {
    date: string
    maeMW: number | null
    evaluatedIntervals: number
  }[]
}

type ApiErrorBody = {
  detail?: string | { message?: string; nextSyncAllowedAt?: string }
}

const DEFAULT_FORECAST_TIME = '2026-01-15T08:00'
const JANUARY_START = '2026-01-01'
const JANUARY_END = '2026-01-31'

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail.message === 'string') return detail.message
  }

  return fallback
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
}

// format the dates from something like 2026-01-15 to 15 Jan
function formatChartDate(value: unknown): string {
  const dateString = String(value)
  const date = new Date(`${dateString}T00:00:00Z`)

  if (Number.isNaN(date.getTime())) {
    return dateString
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(date)
}

function formatCooldown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`
}

function MetricCard({
  label,
  value,
  description,
  icon,
  tone = 'teal',
}: {
  label: string
  value: string
  description: string
  icon: ReactNode
  tone?: 'teal' | 'blue' | 'amber'
}) {
  const toneClasses = {
    teal: 'bg-teal-50 text-teal-700 ring-teal-100',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`rounded-xl p-2.5 ring-1 ${toneClasses[tone]}`}>{icon}</div>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  )
}

export default function App() {
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')
  const [nextSyncAllowedAt, setNextSyncAllowedAt] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [syncSummary, setSyncSummary] = useState<SyncResponse | null>(null)

  const [forecastStartTime, setForecastStartTime] = useState(DEFAULT_FORECAST_TIME)
  const [forecast, setForecast] = useState<ForecastResponse | null>(null)
  const [isLoadingForecast, setIsLoadingForecast] = useState(false)
  const [forecastError, setForecastError] = useState('')

  const [fromDate, setFromDate] = useState(JANUARY_START)
  const [toDate, setToDate] = useState(JANUARY_END)
  const [accuracy, setAccuracy] = useState<AccuracyResponse | null>(null)
  const [isLoadingAccuracy, setIsLoadingAccuracy] = useState(false)
  const [accuracyError, setAccuracyError] = useState('')

  useEffect(() => {
    if (!nextSyncAllowedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [nextSyncAllowedAt])

  const cooldownSeconds = useMemo(() => {
    if (!nextSyncAllowedAt) return 0
    return Math.max(0, Math.ceil((Date.parse(nextSyncAllowedAt) - now) / 1000))
  }, [nextSyncAllowedAt, now])

  async function handleSync() {
    setIsSyncing(true)
    setSyncError('')
    setSyncMessage('')

    try {
      const response = await api.post<SyncResponse>('/api/sync')
      setSyncSummary(response.data)
      setNextSyncAllowedAt(response.data.nextSyncAllowedAt)
      setNow(Date.now())
      setSyncMessage(
        `Sync complete: ${response.data.actualRecordsProcessed.toLocaleString()} actual records and ${response.data.forecastRecordsProcessed.toLocaleString()} forecast records processed.`,
      )
    } catch (error: unknown) {
      setSyncError(getErrorMessage(error, 'Sync failed. Check that the backend is running.'))

      if (axios.isAxiosError<ApiErrorBody>(error)) {
        const detail = error.response?.data?.detail
        if (detail && typeof detail === 'object' && detail.nextSyncAllowedAt) {
          setNextSyncAllowedAt(detail.nextSyncAllowedAt)
          setNow(Date.now())
        }
      }
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleForecastSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setForecast(null)
    setForecastError('')
    setIsLoadingForecast(true)

    try {
      // January is UK winter time (GMT), which is UTC. Send an explicit UTC timestamp.
      const startTime = `${forecastStartTime}:00Z`
      const response = await api.get<ForecastResponse>('/forecast', {
        params: { startTime },
      })
      setForecast(response.data)
    } catch (error: unknown) {
      setForecastError(getErrorMessage(error, 'Could not fetch the forecast.'))
    } finally {
      setIsLoadingForecast(false)
    }
  }

  async function handleAccuracySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAccuracy(null)
    setAccuracyError('')

    if (fromDate > toDate) {
      setAccuracyError('The start date must be on or before the end date.')
      return
    }

    setIsLoadingAccuracy(true)
    try {
      const response = await api.get<AccuracyResponse>('/accuracy', {
        params: { from: fromDate, to: toDate },
      })
      setAccuracy(response.data)
    } catch (error: unknown) {
      setAccuracyError(getErrorMessage(error, 'Could not calculate forecast accuracy.'))
    } finally {
      setIsLoadingAccuracy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f3f6f8] text-slate-800">
      <header className="bg-[#102331] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-400 text-[#102331] shadow-lg shadow-teal-950/20">
              <Wind size={23} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-xl font-semibold tracking-tight">Elbuy<span className="text-teal-300">.</span></div>
              <p className="mt-0.5 text-xs text-slate-300">Wind generation intelligence</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-200 sm:flex">
            <span className="h-2 w-2 rounded-full bg-teal-300" />
            UK day-ahead market · January 2026
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Overview</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Wind forecast dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Review eligible day-ahead forecasts, compare them with actual wind generation, and measure forecast error.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm md:self-auto">
            <Database size={15} className="text-teal-700" />
            Data stored in Neon PostgreSQL
          </div>
        </div>

        <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-teal-50 p-3 text-teal-700 ring-1 ring-teal-100">
                <RefreshCw size={21} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Synchronise Elexon data</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Import January actual generation and forecast history. Repeated records are safely upserted by the backend.
                </p>
                {syncMessage && (
                  <p className="mt-3 flex items-start gap-2 text-sm text-teal-800" role="status">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0" />{syncMessage}
                  </p>
                )}
                {syncError && (
                  <p className="mt-3 flex items-start gap-2 text-sm text-rose-700" role="alert">
                    <AlertCircle size={17} className="mt-0.5 shrink-0" />{syncError}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <button
                onClick={handleSync}
                disabled={isSyncing || cooldownSeconds > 0}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#102f3d] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#17485a] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
              >
                {isSyncing ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
                {isSyncing ? 'Syncing data…' : cooldownSeconds > 0 ? `Sync available in ${formatCooldown(cooldownSeconds)}` : 'Sync data'}
              </button>
              <p className="text-center text-xs text-slate-400 sm:max-w-28 sm:text-left">Backend enforces a 30-minute cooldown.</p>
            </div>
          </div>
          {syncSummary && (
            <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">Actual records processed</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{syncSummary.actualRecordsProcessed.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">Forecast records processed</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{syncSummary.forecastRecordsProcessed.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">Next sync allowed</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(syncSummary.nextSyncAllowedAt)}</p>
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-teal-700">
                  <Search size={14} /> Forecast lookup
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">Find a forecast</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">View the latest forecast eligible at least 24 hours before delivery.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 text-slate-500 ring-1 ring-slate-200">
                <Clock3 size={19} />
              </div>
            </div>

            <form onSubmit={handleForecastSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Delivery date and time (UK time)</span>
                <input
                  type="datetime-local"
                  value={forecastStartTime}
                  min="2026-01-01T00:00"
                  max="2026-01-31T23:30"
                  onChange={(event) => setForecastStartTime(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:bg-white"
                />
                <span className="mt-1.5 block text-xs leading-5 text-slate-400">January 2026 is GMT (UTC). The selected time is sent explicitly as UTC.</span>
              </label>
              <button
                type="submit"
                disabled={isLoadingForecast || !forecastStartTime}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50/50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {isLoadingForecast ? <LoaderCircle size={17} className="animate-spin" /> : <Search size={17} />}
                {isLoadingForecast ? 'Looking up forecast…' : 'Get forecast'}
                {!isLoadingForecast && <ArrowRight size={15} />}
              </button>
            </form>

            {forecastError && (
              <div className="mt-5 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />{forecastError}
              </div>
            )}

            {forecast && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white">
                <div className="border-b border-teal-100/80 px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-800">Eligible forecast</p>
                  <p className="mt-1 text-sm text-slate-600">Delivery starts {formatDateTime(forecast.startTime)}</p>
                </div>
                <div className="px-5 py-5">
                  <p className="text-sm font-medium text-slate-500">Forecast generation</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-4xl font-semibold tracking-tight text-slate-950">{forecast.generationMW.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    <span className="text-sm font-medium text-slate-500">MW</span>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-white bg-white/80 px-3.5 py-3">
                      <p className="text-xs text-slate-500">Published at</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{formatDateTime(forecast.publishTime)}</p>
                    </div>
                    <div className="rounded-xl border border-white bg-white/80 px-3.5 py-3">
                      <p className="text-xs text-slate-500">Decision cutoff</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{formatDateTime(forecast.decisionCutoff)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">
                  <Gauge size={14} /> Performance
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">Forecast accuracy</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">Compare eligible forecasts with hourly averages of actual generation.</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700 ring-1 ring-blue-100">
                <Activity size={19} />
              </div>
            </div>

            <form onSubmit={handleAccuracySubmit} className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">From date</span>
                <input
                  type="date"
                  value={fromDate}
                  min={JANUARY_START}
                  max={JANUARY_END}
                  onChange={(event) => setFromDate(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:bg-white"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">To date</span>
                <input
                  type="date"
                  value={toDate}
                  min={JANUARY_START}
                  max={JANUARY_END}
                  onChange={(event) => setToDate(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:bg-white"
                />
              </label>
              <button
                type="submit"
                disabled={isLoadingAccuracy || !fromDate || !toDate}
                className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:col-span-2"
              >
                {isLoadingAccuracy ? <LoaderCircle size={17} className="animate-spin" /> : <Gauge size={17} />}
                {isLoadingAccuracy ? 'Calculating metrics…' : 'Calculate accuracy'}
              </button>
            </form>

            {accuracyError && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />{accuracyError}
              </div>
            )}

            {accuracy ? (
              <div className="mt-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="MAE" value={`${accuracy.metrics.maeMW.toLocaleString(undefined, { maximumFractionDigits: 2 })} MW`} description="Average absolute forecast error. Lower is better." icon={<Activity size={18} />} tone="teal" />
                  <MetricCard label="RMSE" value={`${accuracy.metrics.rmseMW.toLocaleString(undefined, { maximumFractionDigits: 2 })} MW`} description="Penalises larger forecast errors more heavily." icon={<Zap size={18} />} tone="blue" />
                  <MetricCard label="Bias" value={`${accuracy.metrics.biasMW > 0 ? '+' : ''}${accuracy.metrics.biasMW.toLocaleString(undefined, { maximumFractionDigits: 2 })} MW`} description={accuracy.metrics.biasMW > 0 ? 'Positive: forecasts overestimated generation.' : accuracy.metrics.biasMW < 0 ? 'Negative: forecasts underestimated generation.' : 'No average signed bias.'} icon={accuracy.metrics.biasMW > 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />} tone="amber" />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Daily forecast error
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Mean absolute error for each delivery date. Lower is better.
                    </p>
                  </div>

                  {accuracy.dailyMetrics.some((day) => day.maeMW !== null) ? (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={accuracy.dailyMetrics}
                          margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
                        >
                          <CartesianGrid
                            stroke="#e2e8f0"
                            strokeDasharray="3 3"
                            vertical={false}
                          />

                          <XAxis
                            dataKey="date"
                            tickFormatter={formatChartDate}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={18}
                            interval="preserveStartEnd"
                            tick={{ fontSize: 12, fill: '#64748b' }}
                          />

                          <YAxis
                            width={58}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 12, fill: '#64748b' }}
                          />

                          <Tooltip
                            labelFormatter={(label) =>
                              `Date: ${formatChartDate(label)}`
                            }
                            formatter={(value) =>
                              typeof value === 'number'
                                ? [
                                  `${value.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })} MW`,
                                  'Daily MAE',
                                ]
                                : ['No data', 'Daily MAE']
                            }
                            contentStyle={{
                              borderRadius: '12px',
                              border: '1px solid #e2e8f0',
                              fontSize: '12px',
                            }}
                          />

                          <Line
                            type="monotone"
                            dataKey="maeMW"
                            name="Daily MAE"
                            stroke="#0f766e"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: '#0f766e' }}
                            activeDot={{ r: 5 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex h-48 items-center justify-center rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-500">
                      No daily accuracy data is available for this range.
                    </div>
                  )}

                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    Each point represents one delivery date. Gaps indicate dates
                    without enough matching actual data to calculate MAE.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">Eligible forecasts</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{accuracy.intervals.eligibleForecastIntervals.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">Evaluated intervals</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{accuracy.intervals.evaluatedIntervals.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">Missing actuals</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{accuracy.intervals.skippedForMissingActuals.toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-xs leading-5 text-slate-400">{accuracy.period.from} to {accuracy.period.to} · {accuracy.decisionRule}</p>
              </div>
            ) : (
              !accuracyError && (
                <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
                    <Activity size={19} />
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-700">Your metrics will appear here</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Choose a date range and calculate the accuracy of stored forecast records.</p>
                </div>
              )
            )}
          </section>
        </div>

        <footer className="mt-8 flex flex-col gap-2 border-t border-slate-200 py-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>Elbuy · Wind forecast monitoring and accuracy</p>
          <p className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Forecast eligibility uses a 24-hour lead-time assumption.</p>
        </footer>
      </main>
    </div>
  )
}
