// app/dashboard/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import AnalogClockIST from '@/app/components/AnalogClockIST';
import { ArrowRight, CalendarDays, ChartNoAxesCombined, IndianRupee, PackageCheck, Percent, TrendingUp } from 'lucide-react';

const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });
const ComposedChart       = dynamic(() => import('recharts').then(m => m.ComposedChart), { ssr: false });
const Bar                 = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false });
const Line                = dynamic(() => import('recharts').then(m => m.Line), { ssr: false });
const XAxis               = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false });
const YAxis               = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false });
const Tooltip             = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false });
const CartesianGrid       = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false });
const Legend              = dynamic(() => import('recharts').then(m => ({ default: m.Legend as any })), { ssr: false });

type Daily = { day: string; total: number };
type BreakdownRowRaw = Record<string, unknown>;
type BreakdownRow = { name: string; qty: number; total: number };
type Today = { sales_total: number; gross_profit: number; cost_coverage_pct?: number };
type TopMode = 'qty' | 'total';
type TopRowData = BreakdownRow & { share: number; mode: TopMode };

type Range =
  | { kind: 'preset'; days: 7 | 14 | 30 | 90 }
  | { kind: 'custom'; from: string; to: string };

function todayISO() { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
function addDaysISO(baseISO: string, days: number) { const d = new Date(baseISO+'T00:00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function fmtINR(n: number) { return '₹' + Number(n || 0).toFixed(2); }
const fmtINRCompact = (n: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDateShort = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });

/** Read a CSS var from :root (fallback if missing) */
function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Simple 7-day moving average */
function movingAvg(values: number[], window = 7) {
  if (values.length < window) return [];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out.push(sum / window);
  }
  return out;
}

export default function DashboardPage() {
  const [range, setRange] = useState<Range>({ kind: 'custom', from: todayISO(), to: todayISO() });
  const [rankMode, setRankMode] = useState<TopMode>('qty'); // manual control via UI + hotkey
  const [data, setData] = useState<{ daily: Daily[]; breakdown: BreakdownRow[]; today: Today } | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [allowedMsg, setAllowedMsg] = useState<string>('');

  const { fromISO, toISO } = useMemo(() => {
    if (range.kind === 'preset') {
      const to = todayISO();
      const from = addDaysISO(to, -range.days + 1);
      return { fromISO: from, toISO: to };
    }
    return { fromISO: range.from, toISO: range.to };
  }, [range]);

  // BONUS: hotkey "t" toggles ranking mode qty/total
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 't') setRankMode((m) => (m === 'qty' ? 'total' : 'qty'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/profile/access', { cache: 'no-store' });
        const j = await res.json().catch(() => ({}));
        const permissions = Array.isArray(j?.permissions) ? j.permissions.map(String) : [];
        const hasReports = permissions.includes('perm.reports.view');
        const revenueVisible = j?.access?.revenue_visible === true;
        if (!hasReports || !revenueVisible) {
          setAllowed(false);
          setAllowedMsg('Access restricted to admin/owner users.');
          return;
        }
        setAllowed(true);
      } catch {
        setAllowed(false);
        setAllowedMsg('Unable to verify access. Please sign in again.');
      }
    })();
  }, []);

  useEffect(() => {
    if (allowed === false) return;
    const url = new URL('/api/analytics/sales', window.location.origin);
    url.searchParams.set('from', fromISO);
    url.searchParams.set('to', toISO);
    fetch(url.toString(), { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) =>
        setData({
          daily: Array.isArray(j?.daily) ? j.daily : [],
          breakdown: normalizeBreakdown(j),
          today: j?.today ?? { sales_total: 0, gross_profit: 0, cost_coverage_pct: 0 },
        })
      )
      .catch(() =>
        setData({ daily: [], breakdown: [], today: { sales_total: 0, gross_profit: 0, cost_coverage_pct: 0 } })
      );
  }, [fromISO, toISO, allowed]);

  // Derived stats for the range
  const series = useMemo(() => data?.daily ?? [], [data?.daily]);
  const values = useMemo(() => series.map((d) => Number(d.total || 0)), [series]);
  const totalRange = values.reduce((a, b) => a + b, 0);
  const activeDays = values.filter((v) => v > 0).length;
  const bestIdx = values.length ? values.indexOf(Math.max(...values)) : -1;
  const bestLabel = bestIdx >= 0 ? `${fmtDateShort(series[bestIdx].day)} • ${fmtINR(values[bestIdx])}` : '—';
  const avgPerDay = values.length ? totalRange / values.length : 0;

  // Theme colors (resolved from CSS vars)
  const theme = {
    text: cssVar('--text', '#111827'),
    muted: cssVar('--muted', '#64748b'),
    primary: cssVar('--primary', '#3b82f6'),
    primary600: cssVar('--primary-600', '#2563eb'),
    success: cssVar('--success', '#22c55e'),
    border: cssVar('--border', 'rgba(148,163,184,0.25)'),
    thead: cssVar('--thead', 'rgba(241,245,249,0.92)'),
    popBg: cssVar('--popover-bg', 'rgba(17,24,39,0.85)'),
    popText: cssVar('--popover-text', '#fff'),
  };

  const chartData = useMemo(() => {
    const ma = movingAvg(values, 7);
    return series.map((d, i) => ({
      day: fmtDateShort(d.day),
      total: Number(d.total || 0),
      avg7: i >= 6 ? Number(ma[i - 6]?.toFixed(2) || 0) : null,
    }));
  }, [series, values]);

  const salesToday = data?.today.sales_total ?? 0;
  const profitToday = data?.today.gross_profit ?? 0;
  const costCoveragePct = Math.max(0, Math.min(100, Number(data?.today.cost_coverage_pct ?? 0)));
  const pct = salesToday > 0 ? (profitToday / salesToday) * 100 : 0;

  const top3 = useMemo<TopRowData[]>(() => {
    const rows = data?.breakdown ?? [];
    const denom = rows.reduce((a, r) => a + (rankMode === 'qty' ? r.qty : r.total), 0) || 1;
    const sorted = [...rows].sort((a, b) => (rankMode === 'qty' ? b.qty - a.qty : b.total - a.total));
    return sorted.slice(0, 3).map((r) => ({ ...r, share: ((rankMode === 'qty' ? r.qty : r.total) / denom) * 100, mode: rankMode }));
  }, [data?.breakdown, rankMode]);

  if (allowed === null) {
    return (
      <div className="container">
        <div className="card" style={{ padding: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Dashboard & Reports</h1>
          <div className="muted" style={{ marginTop: 6 }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="container">
        <div className="card" style={{ padding: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Dashboard & Reports</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {allowedMsg || 'Access restricted.'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <a className="btn" href="/billing">Go to Quick Billing</a>
            <a className="btn" href="/profile">Open Profile</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      {/* Header / Hero */}
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-kicker"><ChartNoAxesCombined size={14} /> Business command centre</span>
          <h1>Dashboard & Reports</h1>
          <p>Track today’s performance, product momentum, and sales trends from one clear workspace.</p>
          <a className="dashboard-report-link" href="/dashboard/reports">View detailed reports <ArrowRight size={16} /></a>
        </div>
        <div className="dashboard-clock">
          <AnalogClockIST size={118} />
        </div>
      </section>

      {/* Range & Mode controls */}
      <section className="dashboard-filters card">
        <div className="dashboard-filter-group">
          <span className="dashboard-filter-label"><CalendarDays size={14} /> Reporting period</span>
          <div className="dashboard-presets">
            {[7, 14, 30, 90].map((days) => (
              <button key={days} className="glass-btn" onClick={() => setRange({ kind: 'preset', days: days as 7 | 14 | 30 | 90 })} aria-pressed={range.kind==='preset'&&range.days===days}>{days}d</button>
            ))}
          </div>
        </div>
        <div className="dashboard-date-range">
          <label>From<input type="date" value={range.kind==='custom'?range.from:fromISO} onChange={(e)=>setRange({kind:'custom',from:e.target.value,to:range.kind==='custom'?range.to:toISO})}/></label>
          <span aria-hidden>→</span>
          <label>To<input type="date" value={range.kind==='custom'?range.to:toISO} onChange={(e)=>setRange({kind:'custom',from:range.kind==='custom'?range.from:fromISO,to:e.target.value})}/></label>
        </div>
        <label className="dashboard-ranking">Rank products by
          <select
            value={rankMode}
            onChange={(e)=>setRankMode(e.target.value as TopMode)}
            aria-label="Top products ranking mode"
          >
            <option value="qty">Quantity</option>
            <option value="total">Amount</option>
          </select>
        </label>
      </section>

      {/* Today KPIs */}
      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div><span className="dashboard-kicker">Live snapshot</span><h2>Today’s performance</h2></div>
          <span>{fromISO} to {toISO}</span>
        </div>
        <div className="dashboard-kpi-grid">
          <KPI label="Sales" value={fmtINR(salesToday)} icon={IndianRupee} tone="blue" />
          <KPI label="Gross profit" value={fmtINR(profitToday)} icon={TrendingUp} tone="green" />
          <KPI label="Profit margin" value={`${pct.toFixed(1)}%`} icon={Percent} tone="amber" />
          <div className="dashboard-coverage card">
            <div><PackageCheck size={20} /><span>Cost data coverage</span><strong>{costCoveragePct.toFixed(0)}%</strong></div>
            <Slider value={costCoveragePct} />
            <p>{costCoveragePct >= 95 ? 'Profit reporting has reliable cost coverage.' : 'Add product cost prices or purchases to improve profit accuracy.'}</p>
          </div>
        </div>
      </section>

      <div className="dashboard-insights-grid">
        <section className="card dashboard-products-card">
          <div className="dashboard-card-heading"><div><span className="dashboard-kicker">Product momentum</span><h3>Top products</h3></div><span>By {rankMode === 'qty' ? 'quantity' : 'amount'}</span></div>
          {top3.length === 0 ? <div className="dashboard-empty"><PackageCheck size={26} /><strong>No sales in this period</strong><span>Product rankings will appear after invoices are created.</span></div> : (
            <div className="dashboard-product-list">{top3.map((r) => <TopRow key={r.name} row={r} />)}</div>
          )}
        </section>

        <section className="card dashboard-range-card">
          <div className="dashboard-card-heading"><div><span className="dashboard-kicker">Period summary</span><h3>Range totals</h3></div></div>
          <div className="dashboard-mini-grid">
            <MiniKPI label="Total sales" value={`₹${fmtINRCompact(totalRange)}`} />
            <MiniKPI label="Average / day" value={fmtINR(avgPerDay)} />
            <MiniKPI label="Best day" value={bestLabel} />
            <MiniKPI label="Active days" value={`${activeDays} of ${values.length || 0}`} />
          </div>
        </section>
      </div>

      {/* Charts */}
      <section className="card dashboard-chart-card">
        <div className="dashboard-card-heading"><div><span className="dashboard-kicker">Sales movement</span><h3>Daily sales trend</h3></div><span>{fromISO} → {toISO}</span></div>
        <div className="dashboard-chart">
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
              <XAxis dataKey="day" stroke={theme.muted} />
              <YAxis stroke={theme.muted} />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" name="Daily Sales" fill={theme.primary} radius={[6, 6, 0, 0]} />
              <Line type="monotone" dataKey="avg7" name="7‑day Avg" stroke={theme.success} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="dashboard-chart-note">Bars show daily sales. The line shows the seven-day moving average.</div>
      </section>
    </div>
  );
}

/* ---------- helpers & small UI ---------- */
function KPI({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof IndianRupee; tone: string }) {
  return (
    <div className={`card dashboard-kpi tone-${tone}`}>
      <span className="dashboard-kpi-icon"><Icon size={20} /></span>
      <div><span>{label}</span><strong>{value}</strong></div>
    </div>
  );
}
function MiniKPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-mini-kpi">
      <span>{label}</span><strong>{value}</strong>
    </div>
  );
}
function Slider({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const left = `linear-gradient(90deg, ${cssVar('--success','#22c55e')}, ${cssVar('--primary','#3b82f6')})`;
  return (
    <div className="glass" style={{ height: 12, borderRadius: 999, overflow: 'hidden' }} title={`${pct.toFixed(1)}%`}>
      <div style={{ width: `${pct}%`, height: '100%', background: left }} />
    </div>
  );
}

function TopRow({ row }: { row: TopRowData }) {
  const title = row.name;
  const qty = row.qty;
  const amt = row.total;
  const share = Math.max(0, Math.min(100, row.share));
  return (
    <div className="glass" style={{ padding: 10, borderRadius: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 12, alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700 }} title={title}>
          {title}
        </div>
        <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: 'color-mix(in oklab, var(--text) 10%, transparent)', overflow: 'hidden' }}>
          <div style={{ width: `${share}%`, height: '100%', background: `linear-gradient(90deg, ${cssVar('--primary','#3b82f6')}, ${cssVar('--primary-600','#2563eb')})` }} />
        </div>
      </div>
      <div className="muted" style={{ textAlign: 'right' }}>Qty: <b>{qty}</b></div>
      <div style={{ textAlign: 'right', minWidth: 110 }}>{fmtINR(amt)} <span className="muted">({share.toFixed(1)}%)</span></div>
    </div>
  );
}

function normalizeBreakdown(j: unknown): BreakdownRow[] {
  const raw: BreakdownRowRaw[] =
    (Array.isArray((j as any)?.breakdown) && (j as any).breakdown) ||
    (Array.isArray((j as any)?.data) && (j as any).data) ||
    [];
  return raw.map((r) => ({
    name: String((r as any).name ?? (r as any).product_name ?? (r as any).description ?? 'Unknown'),
    qty: Number((r as any).qty ?? (r as any).total_qty ?? (r as any).units ?? 0),
    total: Number((r as any).total ?? (r as any).amount ?? (r as any).sales_total ?? 0),
  }));
}
