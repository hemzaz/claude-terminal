import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, BarChart2, RefreshCw, Download, Check, Edit3 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useCostStore } from '../store/costStore';

interface DailyCostEntry {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface SessionCostEntry {
  session_id: string;
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface CostStats {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  daily: DailyCostEntry[];
  sessions: SessionCostEntry[];
}

// ── Sparkline ──────────────────────────────────────────────────────────────────

interface SparklineProps {
  data: DailyCostEntry[];
}

function Sparkline({ data }: SparklineProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-text-tertiary text-[12px]">
        No data yet
      </div>
    );
  }

  const W = 500;
  const H = 80;
  const PAD = 4;
  const maxCost = Math.max(...data.map((d) => d.cost_usd), 0.000001);

  const pts = data.map((d, i) => {
    const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - (d.cost_usd / maxCost) * (H - PAD * 2);
    return `${x},${y}`;
  });

  const polyline = pts.join(' ');
  const areaPath =
    `M${pts[0]} ` +
    pts.slice(1).map((p) => `L${p}`).join(' ') +
    ` L${W - PAD},${H - PAD} L${PAD},${H - PAD} Z`;

  // Show first and last date labels
  const firstDate = data[0]?.date?.slice(5) ?? '';
  const lastDate = data[data.length - 1]?.date?.slice(5) ?? '';

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 80 }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(139,92,246)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(139,92,246)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sparkGrad)" />
        <polyline
          points={polyline}
          fill="none"
          stroke="rgb(139,92,246)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-text-tertiary mt-0.5 px-1">
        <span>{firstDate}</span>
        <span>{lastDate}</span>
      </div>
    </div>
  );
}

// ── StatCard ───────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  accent?: boolean;
}

function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <div
      className={`rounded-lg p-3 flex flex-col gap-1 ${
        accent
          ? 'bg-accent-primary/10 ring-1 ring-accent-primary/30'
          : 'bg-white/[0.04] ring-1 ring-white/[0.07]'
      }`}
    >
      <span className="text-text-tertiary text-[11px] uppercase tracking-wide">{label}</span>
      <span
        className={`text-[18px] font-semibold ${
          accent ? 'text-accent-primary' : 'text-text-primary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CostDashboard() {
  const { closeDashboard, inputCostPerMillion, outputCostPerMillion, setRates } = useCostStore();

  const [stats, setStats] = useState<CostStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rate editing
  const [editingRates, setEditingRates] = useState(false);
  const [draftInput, setDraftInput] = useState(String(inputCostPerMillion));
  const [draftOutput, setDraftOutput] = useState(String(outputCostPerMillion));

  // CSV copy feedback
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CostStats>('get_cost_stats', {
        inputCostPerMillion,
        outputCostPerMillion,
      });
      setStats(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [inputCostPerMillion, outputCostPerMillion]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApplyRates = () => {
    const inp = parseFloat(draftInput);
    const out = parseFloat(draftOutput);
    if (!isNaN(inp) && !isNaN(out) && inp >= 0 && out >= 0) {
      setRates(inp, out);
    }
    setEditingRates(false);
  };

  const handleExportCsv = async () => {
    try {
      const csv = await invoke<string>('export_cost_csv', {
        inputCostPerMillion,
        outputCostPerMillion,
      });
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently ignore clipboard failure
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onDoubleClick={closeDashboard}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.15 }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="bg-bg-elevated ring-1 ring-white/[0.08] rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 size={15} className="text-accent-primary" />
            <span className="text-text-primary text-[13px] font-medium">Cost Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleExportCsv()}
              className="flex items-center gap-1.5 text-text-tertiary hover:text-text-primary text-[11px] px-2 py-1 rounded hover:bg-white/[0.05] transition-colors"
              title="Copy CSV to clipboard"
            >
              {copied ? (
                <Check size={12} className="text-success" />
              ) : (
                <Download size={12} />
              )}
              {copied ? 'Copied' : 'Export CSV'}
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="text-text-tertiary hover:text-text-primary p-1 rounded hover:bg-white/[0.05] transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={closeDashboard}
              className="text-text-tertiary hover:text-text-primary p-1 rounded hover:bg-white/[0.05] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Rates row */}
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary text-[11px]">
              Rates ($/M tokens): input&nbsp;
              <span className="text-text-secondary">${inputCostPerMillion.toFixed(2)}</span>
              &nbsp;·&nbsp;output&nbsp;
              <span className="text-text-secondary">${outputCostPerMillion.toFixed(2)}</span>
            </span>
            <button
              onClick={() => {
                setDraftInput(String(inputCostPerMillion));
                setDraftOutput(String(outputCostPerMillion));
                setEditingRates(true);
              }}
              className="flex items-center gap-1 text-text-tertiary hover:text-text-primary text-[11px] px-2 py-0.5 rounded hover:bg-white/[0.05] transition-colors"
            >
              <Edit3 size={11} />
              Edit rates
            </button>
          </div>

          {/* Rate editing inline form */}
          {editingRates && (
            <div className="flex items-center gap-3 bg-white/[0.03] rounded-lg p-3 ring-1 ring-white/[0.07]">
              <label className="flex items-center gap-2 text-[11px] text-text-secondary">
                Input $/M
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  className="w-20 bg-bg-primary text-text-primary text-[12px] rounded px-2 py-1 ring-1 ring-white/[0.1] focus:outline-none focus:ring-accent-primary/50"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-text-secondary">
                Output $/M
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftOutput}
                  onChange={(e) => setDraftOutput(e.target.value)}
                  className="w-20 bg-bg-primary text-text-primary text-[12px] rounded px-2 py-1 ring-1 ring-white/[0.1] focus:outline-none focus:ring-accent-primary/50"
                />
              </label>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={handleApplyRates}
                  className="bg-accent-primary hover:bg-accent-secondary text-white text-[11px] px-3 py-1 rounded transition-colors"
                >
                  Apply
                </button>
                <button
                  onClick={() => setEditingRates(false)}
                  className="text-text-secondary hover:text-text-primary text-[11px] px-2 py-1 rounded hover:bg-white/[0.05] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-error text-[12px] bg-error/10 rounded-lg p-3 ring-1 ring-error/20">
              {error}
            </div>
          )}

          {/* Stat cards */}
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="Total cost"
                value={fmtUsd(stats.total_cost_usd)}
                accent
              />
              <StatCard
                label="Input tokens"
                value={fmtTokens(stats.total_input_tokens)}
              />
              <StatCard
                label="Output tokens"
                value={fmtTokens(stats.total_output_tokens)}
              />
            </div>
          )}

          {/* Sparkline */}
          {stats && stats.daily.length > 0 && (
            <div className="bg-white/[0.03] rounded-lg p-3 ring-1 ring-white/[0.07]">
              <p className="text-text-tertiary text-[11px] uppercase tracking-wide mb-2">
                Daily cost (last {stats.daily.length} days)
              </p>
              <Sparkline data={stats.daily} />
            </div>
          )}

          {/* Top sessions */}
          {stats && stats.sessions.length > 0 && (
            <div>
              <p className="text-text-tertiary text-[11px] uppercase tracking-wide mb-2">
                Top sessions by cost
              </p>
              <div className="rounded-lg ring-1 ring-white/[0.07] overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-border">
                      <th className="text-left text-text-tertiary font-normal px-3 py-2">Session</th>
                      <th className="text-left text-text-tertiary font-normal px-3 py-2">Date</th>
                      <th className="text-right text-text-tertiary font-normal px-3 py-2">In</th>
                      <th className="text-right text-text-tertiary font-normal px-3 py-2">Out</th>
                      <th className="text-right text-text-tertiary font-normal px-3 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sessions.map((s, i) => (
                      <tr
                        key={s.session_id}
                        className={`border-b border-border/50 last:border-0 ${
                          i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'
                        }`}
                      >
                        <td className="px-3 py-1.5 text-text-secondary font-mono truncate max-w-[140px]">
                          {s.session_id.slice(0, 12)}…
                        </td>
                        <td className="px-3 py-1.5 text-text-tertiary">{s.date}</td>
                        <td className="px-3 py-1.5 text-right text-text-secondary">
                          {fmtTokens(s.input_tokens)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-text-secondary">
                          {fmtTokens(s.output_tokens)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-accent-primary font-medium">
                          {fmtUsd(s.cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {stats && stats.sessions.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-text-tertiary gap-2">
              <BarChart2 size={28} className="opacity-30" />
              <p className="text-[12px]">No session logs with token data found.</p>
              <p className="text-[11px] opacity-70">
                Token data is parsed from Claude Code session logs.
              </p>
            </div>
          )}

          {/* Loading spinner when no data yet */}
          {loading && !stats && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={20} className="animate-spin text-text-tertiary" />
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
