import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';

const COLORS = {
  pass: '#10b981',
  fail: '#ef4444',
  block: '#f59e0b',
  skip: '#64748b',
  not_tested: '#94a3b8',
  trend: '#2563eb',
};

interface TestResultData {
  key?: string;
  name: string;
  value: number;
  color: string;
}

interface TestRunChartProps {
  data: TestResultData[];
  title: string;
  onChartClick?: (data: any) => void;
}

interface SectionData {
  name: string;
  // Value the results table filters by when this bar is clicked (section name,
  // or a "no section" sentinel). Falls back to `name` when absent.
  filterValue?: string;
  pass: number;
  fail: number;
  block: number;
  skip: number;
  not_tested: number;
  total: number;
  passRate: number;
}

interface TrendData {
  // Unique, monotonically increasing X position (execution order). Used as the
  // axis key so same-day points don't collapse into one category.
  order: number;
  date: string;
  passRate: number;
  totalTests: number;
}

const EmptyChart = () => {
  const { t } = useTranslation();

  return (
    <div className="flex h-[260px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
      {t('noChartDataAvailable')}
    </div>
  );
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;

  // The trend chart keys its X axis by execution order (a number) but wants the
  // human-readable date in the tooltip heading; fall back to the axis label for
  // the pie/bar charts, which carry no `date`.
  const heading = payload[0]?.payload?.date ?? label;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
      {heading && <div className="mb-2 font-semibold text-slate-900 dark:text-slate-100">{heading}</div>}
      <div className="space-y-1.5">
        {payload.map((item: any) => (
          <div key={`${item.name}-${item.dataKey}`} className="flex min-w-32 items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color || item.payload?.color }} />
              {item.name}
            </span>
            <span className="font-semibold text-slate-950 dark:text-slate-50">
              {item.dataKey === 'passRate' ? `${item.value}%` : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export function TestRunPieChart({ data, title, onChartClick }: TestRunChartProps) {
  const { t } = useTranslation();
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const topResult = data.reduce<TestResultData | null>(
    (current, item) => (!current || item.value > current.value ? item : current),
    null
  );

  const handlePieClick = (data: any, index: number, e: React.MouseEvent) => {
    if (onChartClick && data) {
      onChartClick({ type: 'status', value: data.key || data.name.toLowerCase() });
    }
  };

  const handleButtonClick = (item: TestResultData) => {
    if (onChartClick && item) {
      onChartClick({ type: 'status', value: item.key || item.name.toLowerCase() });
    }
  };

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-linear-to-br from-white to-slate-50 shadow-xs dark:border-slate-800 dark:from-slate-950 dark:to-slate-900">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-slate-950 dark:text-slate-50">{title}</CardTitle>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('clickableStatusSegmentsFilterTable')}</p>
          </div>
          <Badge variant="outline" className="border-slate-200 bg-white/70 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
            {t('totalCount', { count: total })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.length === 0 ? (
          <EmptyChart />
        ) : (
          <>
            <div className="relative h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={3}
                    cornerRadius={8}
                    dataKey="value"
                    onClick={handlePieClick}
                    style={{ cursor: 'pointer' }}
                  >
                    {data.map((entry) => (
                      <Cell key={entry.key || entry.name} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-3xl font-black text-slate-950 dark:text-slate-50">{total}</div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tests')}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {data.map((item) => (
                <button
                  key={item.key || item.name}
                  type="button"
                  onClick={() => handleButtonClick(item)}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950"
                >
                  <span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="font-bold text-slate-950 dark:text-slate-50">{item.value}</span>
                </button>
              ))}
            </div>
            {topResult && total > 0 && (
              <div className="rounded-xl bg-slate-950 px-3 py-2 text-xs text-white dark:bg-slate-100 dark:text-slate-950">
                {t('leadingResultAtPercent', { name: topResult.name, percent: Math.round((topResult.value / total) * 100) })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function TestRunBarChart({ data, title, onChartClick }: { data: SectionData[]; title: string; onChartClick?: (data: any) => void }) {
  const { t } = useTranslation();
  const allSections = [...data].sort((a, b) => b.total - a.total);
  const visibleData = allSections.slice(0, 8);
  // With many sections, horizontal labels collide — angle them and give the
  // axis extra vertical room.
  const manySections = visibleData.length > 4;

  const handleBarClick = (entry: any) => {
    if (onChartClick && entry?.name) {
      onChartClick({ type: 'section', value: entry.filterValue ?? entry.name });
    }
  };

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-950">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-slate-950 dark:text-slate-50">{title}</CardTitle>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {allSections.length > 8 ? t('showingTopOf', { shown: 8, total: allSections.length }) : t('stackedOutcomesBySection')}
            </p>
          </div>
          {allSections.length > 0 && (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
              {t('sectionsCount', { count: allSections.length })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {visibleData.length === 0 ? (
          <EmptyChart />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={manySections ? 268 : 220}>
              <BarChart data={visibleData} margin={{ top: 12, right: 8, left: -16, bottom: 0 }} barCategoryGap={18}>
                <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  interval={0}
                  tickFormatter={(value) => {
                    const label = String(value);
                    const max = manySections ? 16 : 10;
                    return label.length > max ? `${label.slice(0, max)}…` : label;
                  }}
                  {...(manySections
                    ? { angle: -35, textAnchor: 'end' as const, height: 72, tickMargin: 8 }
                    : {})}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="pass" stackId="results" fill={COLORS.pass} name={t('passed')} radius={[0, 0, 8, 8]} onClick={handleBarClick} cursor="pointer" />
                <Bar dataKey="fail" stackId="results" fill={COLORS.fail} name={t('failed')} onClick={handleBarClick} cursor="pointer" />
                <Bar dataKey="block" stackId="results" fill={COLORS.block} name={t('blocked')} onClick={handleBarClick} cursor="pointer" />
                <Bar dataKey="skip" stackId="results" fill={COLORS.skip} name={t('skipped')} onClick={handleBarClick} cursor="pointer" />
                <Bar dataKey="not_tested" stackId="results" fill={COLORS.not_tested} name={t('notTested')} radius={[8, 8, 0, 0]} onClick={handleBarClick} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>

            {/* All sections scrollable list */}
            <div className="max-h-[180px] overflow-y-auto space-y-1 pr-1">
              {allSections.map((section) => (
                <div key={section.name} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-900/60">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200" title={section.name}>
                    {section.name}
                  </span>
                  {/* Mini stacked progress bar */}
                  <div className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    {section.pass > 0 && <div style={{ width: `${(section.pass / section.total) * 100}%`, backgroundColor: COLORS.pass }} />}
                    {section.fail > 0 && <div style={{ width: `${(section.fail / section.total) * 100}%`, backgroundColor: COLORS.fail }} />}
                    {section.block > 0 && <div style={{ width: `${(section.block / section.total) * 100}%`, backgroundColor: COLORS.block }} />}
                    {section.skip > 0 && <div style={{ width: `${(section.skip / section.total) * 100}%`, backgroundColor: COLORS.skip }} />}
                    {section.not_tested > 0 && <div style={{ width: `${(section.not_tested / section.total) * 100}%`, backgroundColor: COLORS.not_tested }} />}
                  </div>
                  <span className="shrink-0 text-slate-500 dark:text-slate-400">
                    {section.passRate}% · {section.total}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function TestRunTrendChart({ data, title }: { data: TrendData[]; title: string }) {
  const { t } = useTranslation();
  const latest = data[data.length - 1];
  const first = data[0];
  const delta = latest && first ? latest.passRate - first.passRate : 0;

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.16),transparent_32%),linear-gradient(180deg,#fff,#f8fafc)] shadow-xs dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.2),transparent_32%),linear-gradient(180deg,#020617,#0f172a)]">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-slate-950 dark:text-slate-50">{title}</CardTitle>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('cumulativePassRateDescription')}</p>
          </div>
          {latest && (
            <Badge variant="outline" className="border-blue-200 bg-white/80 text-blue-700 dark:border-blue-800 dark:bg-slate-950/70 dark:text-blue-300">
              {latest.passRate}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.length === 0 ? (
          <EmptyChart />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data} margin={{ top: 14, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="passRateGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.trend} stopOpacity={0.34} />
                    <stop offset="95%" stopColor={COLORS.trend} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#dbeafe" />
                <XAxis
                  dataKey="order"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(value) => data.find((point) => point.order === value)?.date ?? ''}
                />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(value) => `${value}%`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="passRate" name={t('passRatePercent')} stroke={COLORS.trend} strokeWidth={3} fill="url(#passRateGradient)" activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/80 p-3 text-sm shadow-xs dark:bg-slate-950/60">
                <div className="text-xs text-slate-500 dark:text-slate-400">{t('latestPassRate')}</div>
                <div className="text-2xl font-black text-slate-950 dark:text-slate-50">{latest?.passRate ?? 0}%</div>
              </div>
              <div className="rounded-xl bg-white/80 p-3 text-sm shadow-xs dark:bg-slate-950/60">
                <div className="text-xs text-slate-500 dark:text-slate-400">{t('trendChange')}</div>
                <div className={`text-2xl font-black ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {delta >= 0 ? '+' : ''}{delta}%
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
