"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ExploreMarket, MarketsResponse, ServerMessage } from "@repo/shared-types";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  detectSection,
  SECTION_LABEL,
  SECTION_ORDER,
  type SectionKey,
} from "../lib/market-sections";
import { SortDropdown } from "../components/layout/SortDropdown";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

type SortOption = "volume" | "liquidity" | "price" | "newest";
type VenueFilter = "all" | "matched" | "polymarket" | "kalshi";

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "volume", label: "Volume (24h)" },
  { value: "liquidity", label: "Liquidity" },
  { value: "price", label: "Price (high)" },
  { value: "newest", label: "Newest" },
];

function formatNum(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n > 0) return `$${n.toFixed(0)}`;
  return "-";
}

function formatPct(value: number | null): string {
  if (value === null) return "--%";
  return `${Math.round(value * 100)}%`;
}

function projectionPath(
  points: number[],
  width: number,
  height: number,
  pad = 8,
  rangeMin = 0,
  rangeMax = 100,
): string {
  if (points.length === 0) return "";
  const span = rangeMax - rangeMin || 1;
  const step = (width - pad * 2) / Math.max(1, points.length - 1);
  return points
    .map((p, i) => {
      const x = pad + i * step;
      const y = height - pad - ((p - rangeMin) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function MarketAvatar({ market }: { market: ExploreMarket }) {
  const imageUrl = market.imageUrl ?? market.venues.find((v) => v.imageUrl)?.imageUrl ?? null;
  const fallbackLetter = market.category?.trim()?.[0]?.toUpperCase() ?? "M";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={market.question}
        className="h-12 w-12 rounded-xl object-cover border border-white/15 shadow-sm"
      />
    );
  }

  return (
    <div className="h-12 w-12 rounded-xl border border-slate-500/30 bg-gradient-to-br from-slate-700/80 to-slate-900/80 flex items-center justify-center text-sm font-semibold text-slate-100 shadow-sm">
      {fallbackLetter}
    </div>
  );
}

function VenueBadge({ venue }: { venue: "polymarket" | "kalshi" }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${
        venue === "polymarket"
          ? "bg-slate-600/30 text-slate-200 border border-slate-500/30"
          : "bg-zinc-700/35 text-zinc-200 border border-zinc-500/30"
      }`}
    >
      {venue === "polymarket" ? "Poly" : "Kalshi"}
    </span>
  );
}

function OutcomeRow({
  label,
  pctText,
  emphasis,
}: {
  label: string;
  pctText: string;
  emphasis: "yes" | "no" | "neutral";
}) {
  const isYes = label.toLowerCase().includes("yes") || emphasis === "yes";
  const isNo = label.toLowerCase().includes("no") || emphasis === "no";

  const colorClass = isYes
    ? "text-emerald-400"
    : isNo
      ? "text-rose-400"
      : "text-text-primary";

  const bgClass = isYes
    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
    : isNo
      ? "bg-rose-500/10 border-rose-500/20 text-rose-300"
      : "bg-surface-3 border-border text-text-secondary";

  return (
    <div className="flex items-center justify-between py-2 group/row transition-colors duration-200">
      <div className="flex items-center gap-3">
        <div className={`w-1.5 h-1.5 rounded-full ${isYes ? "bg-emerald-500" : isNo ? "bg-rose-500" : "bg-text-muted"}`} />
        <span className="text-base text-text-secondary font-medium truncate max-w-[140px]">{label}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className={`text-xl leading-none font-bold tabular-nums ${colorClass}`}>{pctText}</span>
        <div className="flex gap-1.5">
          <button className={`px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg border transition-all duration-200 active:scale-95 ${bgClass} hover:brightness-125`}>
            Bet
          </button>
        </div>
      </div>
    </div>
  );
}

function MarketCard({ market }: { market: ExploreMarket }) {
  const yesValue = market.yesPrice;
  const noValue = yesValue === null ? null : 1 - yesValue;
  const outcomes = market.outcomes || ["Yes", "No"];
  const yesLabel = outcomes[0] ?? "Yes";
  const noLabel = outcomes[1] ?? "No";
  const yesPct = formatPct(yesValue);
  const noPct = formatPct(noValue);

  return (
    <Link
      href={`/market/${encodeURIComponent(market.id)}`}
      className="market-depth depth-card-hover group relative block overflow-hidden rounded-[24px] p-5"
    >
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative z-10 flex flex-col h-full">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <MarketAvatar market={market} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-surface-3 text-text-muted rounded-md border border-border">
                  {market.category || "General"}
                </span>
                <div className="flex gap-1">
                  {market.venues.map((v) => (
                    <VenueBadge key={v.venue} venue={v.venue} />
                  ))}
                </div>
              </div>
              <h3 className="line-clamp-2 text-lg leading-[1.3] font-bold text-text-primary transition-colors">
                {market.question}
              </h3>
            </div>
          </div>
        </div>

        <div className="mt-auto space-y-1 divide-y divide-border">
          <OutcomeRow
            label={yesLabel}
            pctText={yesPct}
            emphasis={yesValue !== null && yesValue >= 0.6 ? "yes" : "neutral"}
          />
          <OutcomeRow
            label={noLabel}
            pctText={noPct}
            emphasis={noValue !== null && noValue >= 0.6 ? "no" : "neutral"}
          />
        </div>

        <div className="mt-5 flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Volume</span>
              <span className="text-xs text-text-secondary font-semibold">{formatNum(market.volume24h)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Liquidity</span>
              <span className="text-xs text-text-secondary font-semibold">{formatNum(market.liquidity)}</span>
            </div>
          </div>
          <div className="h-8 w-8 rounded-full bg-surface-3 flex items-center justify-center border border-border group-hover:bg-accent/10 group-hover:border-accent/30 transition-all">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-text-muted group-hover:text-accent transform transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
}

function MarketCardSkeleton() {
  return (
    <div className="depth-card rounded-[24px] p-5 animate-pulse">
      <div className="mb-5 flex gap-4">
        <div className="h-12 w-12 rounded-xl bg-surface-3" />
        <div className="flex-1 space-y-3">
          <div className="h-3 rounded bg-surface-3 w-24" />
          <div className="h-5 rounded bg-surface-3 w-full" />
        </div>
      </div>
      <div className="space-y-4">
        <div className="h-10 rounded-xl bg-surface-3" />
        <div className="h-10 rounded-xl bg-surface-3" />
      </div>
      <div className="mt-6 pt-4 border-t border-border flex justify-between">
        <div className="h-4 rounded bg-surface-3 w-20" />
        <div className="h-8 w-8 rounded-full bg-surface-3" />
      </div>
    </div>
  );
}

function TrendingCarousel({
  markets,
  activeIndex,
  onSelect,
  liveHistory,
}: {
  markets: ExploreMarket[];
  activeIndex: number;
  onSelect: (index: number) => void;
  liveHistory: Record<string, { time: number; yes: number }[]>;
}) {
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const saved = localStorage.getItem("bookmarked-markets");
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleBookmark = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("bookmarked-markets", JSON.stringify([...next]));
      return next;
    });
  };

  const copyLink = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/market/${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(prev => prev === id ? null : prev), 2000);
  };

  if (markets.length === 0) return null;

  return (
    <section className="mb-7">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">Trending Now</h2>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Updated every minute</span>
      </div>

      <div className="relative overflow-hidden">
        <div 
          className="flex transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {markets.map((market) => {
            const history = liveHistory[market.id] ?? [];
            const yesValue = market.yesPrice;
            const noValue = yesValue === null ? null : 1 - yesValue;
            const latestLive = history.length > 0 ? history[history.length - 1] : null;
            const currentYes = latestLive ? latestLive.yes : yesValue;
            const currentNo = currentYes === null ? null : 1 - currentYes;
            const outcomes = market.outcomes || ["Yes", "No"];
            const yesLabel = outcomes[0] ?? "Yes";
            const noLabel = outcomes[1] ?? "No";
            const imageUrl = market.imageUrl ?? market.venues.find((v) => v.imageUrl)?.imageUrl ?? null;
            const yesSeries = history.length >= 2
              ? history.map(p => Math.round(p.yes * 100))
              : Array(2).fill(Math.round((yesValue ?? 0.5) * 100));
            const noSeries = history.length >= 2
              ? history.map(p => Math.round((1 - p.yes) * 100))
              : Array(2).fill(Math.round((noValue ?? 0.5) * 100));
            const chartWidth = 680;
            const chartHeight = 320;
            const strokeColors = [
              "rgba(52,211,153,0.95)",
              "rgba(251,113,133,0.95)",
            ];
            // Auto-scale Y-axis to the data range so small movements are visible
            const allValues = [...yesSeries, ...noSeries];
            const dataMin = Math.min(...allValues);
            const dataMax = Math.max(...allValues);
            const range = dataMax - dataMin;
            // Add 20% padding, minimum 10% range so flat lines still look good
            const padding = Math.max(range * 0.2, 5);
            const yMin = Math.max(0, Math.floor((dataMin - padding) / 5) * 5);
            const yMax = Math.min(100, Math.ceil((dataMax + padding) / 5) * 5);
            const yRange = yMax - yMin || 10;
            // Build tick marks for the visible range
            const tickStep = yRange <= 20 ? 5 : yRange <= 50 ? 10 : 20;
            const axisSteps: number[] = [];
            for (let t = yMin; t <= yMax; t += tickStep) axisSteps.push(t);
            const yAt = (v: number) => {
              const pad = 10;
              return chartHeight - pad - ((v - yMin) / yRange) * (chartHeight - pad * 2);
            };

            return (
              <div key={market.id} className="min-w-full">
                <Link
                  href={`/market/${encodeURIComponent(market.id)}`}
                  className="depth-card block relative rounded-3xl p-5 md:p-6 active:scale-[0.995] transition-transform"
                >
                  {/* Header row: image + meta + title | actions */}
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={market.question}
                          className="h-11 w-11 rounded-xl object-cover border border-white/15 shrink-0 mt-0.5"
                          loading="eager"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-11 w-11 rounded-xl border border-border bg-surface-3 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-medium text-text-muted">
                            {(market.category || "Other")} · {market.venues[0]?.venue === "kalshi" ? "Kalshi" : "Polymarket"}
                          </span>
                          {market.venues.map((v) => (
                            <span key={v.venue} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border ${v.venue === "polymarket" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-orange-500/10 text-orange-400 border-orange-500/20"}`}>
                              {v.venue === "polymarket" ? "Poly" : "Kalshi"}
                            </span>
                          ))}
                        </div>
                        <h3 className="text-2xl md:text-[1.75rem] font-extrabold leading-tight tracking-tight text-text-primary line-clamp-2">
                          {market.question}
                        </h3>
                      </div>
                    </div>
                    <div className="hidden md:flex items-center gap-2 shrink-0">
                      <button
                        onClick={(e) => copyLink(e, market.id)}
                        title={copiedId === market.id ? "Copied!" : "Copy link"}
                        className={`h-8 w-8 rounded-full border transition-colors flex items-center justify-center ${copiedId === market.id ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" : "border-border bg-surface-2/60 hover:bg-surface-3"}`}
                      >
                        {copiedId === market.id ? (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={(e) => toggleBookmark(e, market.id)}
                        title={bookmarks.has(market.id) ? "Remove bookmark" : "Bookmark"}
                        className={`h-8 w-8 rounded-full border transition-colors flex items-center justify-center ${bookmarks.has(market.id) ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : "border-border bg-surface-2/60 hover:bg-surface-3"}`}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill={bookmarks.has(market.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Main content: outcomes left | chart right */}
                  <div className="grid grid-cols-1 lg:grid-cols-[0.34fr_0.66fr] gap-5 items-start">
                    <div className="min-w-0 space-y-3">
                      {/* Outcome rows */}
                      <div className="rounded-xl border border-border/60 bg-surface-2/40">
                        {[
                          { pct: formatPct(currentYes), label: yesLabel, color: "text-emerald-400" },
                          { pct: formatPct(currentNo), label: noLabel, color: "text-rose-400" },
                        ].map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-b-0"
                          >
                            <span key={item.pct} className="live-value text-3xl font-black text-text-primary tabular-nums">
                              {item.pct}
                            </span>
                            <span className={`text-base font-semibold ${item.color}`}>
                              {item.label}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Quick bet boxes */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
                          <div className="text-[9px] uppercase tracking-wider font-semibold text-emerald-300/70">{yesLabel}</div>
                          <div key={`yes-${formatPct(currentYes)}`} className="live-value mt-0.5 text-2xl font-black text-emerald-400 tabular-nums">{formatPct(currentYes)}</div>
                        </div>
                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2.5">
                          <div className="text-[9px] uppercase tracking-wider font-semibold text-rose-300/70">{noLabel}</div>
                          <div key={`no-${formatPct(currentNo)}`} className="live-value mt-0.5 text-2xl font-black text-rose-400 tabular-nums">{formatPct(currentNo)}</div>
                        </div>
                      </div>

                      {/* Volume / Liquidity */}
                      <div className="flex items-center gap-6 pt-2">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-0.5">Vol 24H</div>
                          <div className="text-base font-bold text-text-primary">{formatNum(market.volume24h)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-0.5">Liquidity</div>
                          <div className="text-base font-bold text-text-primary">{formatNum(market.liquidity)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Chart */}
                    <div className="depth-card rounded-xl p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            {yesLabel} <span key={`ly-${formatPct(currentYes)}`} className="live-value font-semibold text-emerald-400">{formatPct(currentYes)}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                            <span className="h-2 w-2 rounded-full bg-rose-400" />
                            {noLabel} <span key={`ln-${formatPct(currentNo)}`} className="live-value font-semibold text-rose-400">{formatPct(currentNo)}</span>
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          LIVE
                        </span>
                      </div>
                      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-64">
                        {axisSteps.map((tick) => (
                          <g key={`${market.id}-tick-${tick}`}>
                            <line
                              x1="10"
                              y1={yAt(tick)}
                              x2={chartWidth - 54}
                              y2={yAt(tick)}
                              stroke="rgba(148,163,148,0.22)"
                              strokeDasharray="2 8"
                            />
                            <text
                              x={chartWidth - 46}
                              y={yAt(tick) + 5}
                              fill="rgba(148,163,148,0.85)"
                              fontSize="11"
                              fontWeight="500"
                            >
                              {tick}%
                            </text>
                          </g>
                        ))}
                        <path d={projectionPath(yesSeries, chartWidth - 54, chartHeight, 8, yMin, yMax)} fill="none" stroke={strokeColors[0]} strokeWidth="2.5" strokeLinejoin="round" />
                        <path d={projectionPath(noSeries, chartWidth - 54, chartHeight, 8, yMin, yMax)} fill="none" stroke={strokeColors[1]} strokeWidth="2.5" strokeLinejoin="round" />
                        <circle cx={chartWidth - 62} cy={yAt(yesSeries[yesSeries.length - 1] ?? 50)} r="4" fill={strokeColors[0]}>
                          <animate attributeName="r" values="3.5;5.5;3.5" dur="1.5s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={chartWidth - 62} cy={yAt(noSeries[noSeries.length - 1] ?? 50)} r="4" fill={strokeColors[1]}>
                          <animate attributeName="r" values="3.5;5.5;3.5" dur="1.5s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
                        {history.length >= 2 ? (
                          <>
                            {[0, Math.floor(history.length / 3), Math.floor(2 * history.length / 3), history.length - 1].map((idx) => {
                              const d = new Date(history[idx]!.time);
                              const spanHours = (history[history.length - 1]!.time - history[0]!.time) / 3600000;
                              const label = spanHours > 6
                                ? d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                              return <span key={idx}>{label}</span>;
                            })}
                          </>
                        ) : (
                          <span>Loading price history...</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 mt-6">
        {markets.map((m, i) => (
          <button
            key={m.id}
            onClick={() => onSelect(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === activeIndex ? "w-10 bg-text-primary" : "w-1.5 bg-text-muted/40 hover:bg-text-muted/70"}`}
            aria-label={`Show trending market ${i + 1}`}
          />
        ))}
      </div>
    </section>
  );
}

function ExploreContent() {
  const PREVIEW_MARKETS_PER_CATEGORY = 15;
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams?.get("q") || "";
  const venue = (searchParams?.get("venue") as VenueFilter) || "all";

  const [data, setData] = useState<MarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("volume");
  const [offset, setOffset] = useState(0);
  const [trendingIndex, setTrendingIndex] = useState(0);
  const limit = 180;

  // --- Live chart WebSocket ---
  // Accumulate price history per market in a ref (no re-render per tick),
  // then sync to state every 500ms so the chart redraws at a steady 2fps.
  const liveHistoryRef = useRef<Record<string, { time: number; yes: number }[]>>({});
  const [liveHistory, setLiveHistory] = useState<Record<string, { time: number; yes: number }[]>>({});

  const trendingMarkets = useMemo(() => {
    if (!data?.markets?.length) return [];
    return [...data.markets]
      .sort((a, b) => {
        if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
        return b.liquidity - a.liquidity;
      })
      .slice(0, 5);
  }, [data?.markets]);

  const sectionedMarkets = useMemo(() => {
    const grouped: Record<SectionKey, ExploreMarket[]> = {
      trending: [],
      sports: [],
      crypto: [],
      politics: [],
      economy: [],
      tech: [],
      world: [],
      culture: [],
      other: [],
    };

    if (!data?.markets?.length) return grouped;
    for (const market of data.markets) {
      grouped[detectSection(market)].push(market);
    }
    return grouped;
  }, [data?.markets]);

  const visibleSections = useMemo(() => SECTION_ORDER, []);
  const hasMoreMarkets = (data?.markets.length ?? 0) < (data?.total ?? 0);

  const handleVenue = (nextVenue: VenueFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextVenue === "all") params.delete("venue");
    else params.set("venue", nextVenue);
    params.set("offset", "0");
    router.push(`/?${params.toString()}`);
  };

  const fetchMarkets = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        sort,
      });
      if (search) params.set("q", search);
      if (venue !== "all") params.set("venue", venue);

      const res = await fetch(`${API_URL}/api/markets?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MarketsResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch markets");
    } finally {
      setLoading(false);
    }
  }, [search, sort, venue, offset]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(fetchMarkets, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchMarkets, search]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [search, sort, venue]);

  useEffect(() => {
    setTrendingIndex(0);
  }, [trendingMarkets.length, search, sort, venue, offset]);

  useEffect(() => {
    if (trendingMarkets.length < 2) return;
    const timer = setInterval(() => {
      setTrendingIndex((prev) => (prev + 1) % trendingMarkets.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [trendingMarkets.length]);

  // Fetch 24h price history for all trending markets on mount
  const historyFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (trendingMarkets.length === 0) return;
    let cancelled = false;

    const fetchHistory = async () => {
      const toFetch = trendingMarkets.filter(
        (m) => !historyFetchedRef.current.has(m.id)
      );
      if (toFetch.length === 0) return;

      const results = await Promise.allSettled(
        toFetch.map(async (m) => {
          const res = await fetch(
            `${API_URL}/api/markets/${encodeURIComponent(m.id)}/history?hours=24`
          );
          if (!res.ok) return { id: m.id, points: [] as { t: number; y: number }[] };
          const json = (await res.json()) as { points: { t: number; y: number }[] };
          return { id: m.id, points: json.points };
        })
      );

      if (cancelled) return;

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { id, points } = result.value;
        if (points.length === 0) continue;
        historyFetchedRef.current.add(id);
        // Prepend historical data before any live data already collected
        const existing = liveHistoryRef.current[id] ?? [];
        const historical = points.map((p) => ({ time: p.t, yes: p.y }));
        liveHistoryRef.current[id] = [...historical, ...existing].slice(-600);
      }

      // Trigger a render with the new data
      setLiveHistory({ ...liveHistoryRef.current });
    };

    fetchHistory();
    return () => { cancelled = true; };
  }, [trendingMarkets]);

  // Which trending market is currently visible → connect WS to it
  const activeMarketId = trendingMarkets.length > 0
    ? trendingMarkets[Math.min(trendingIndex, trendingMarkets.length - 1)]?.id ?? null
    : null;
  const activeMarketIdRef = useRef<string | null>(null);
  activeMarketIdRef.current = activeMarketId;

  // WS message handler: extract bestBid → push into the ref (no re-render)
  const handleTrendingWs = useCallback((msg: ServerMessage) => {
    if (msg.type !== "book_snapshot" && msg.type !== "book_update") return;
    const bid = msg.data.aggregated.bestBid;
    if (bid === null) return;
    const id = activeMarketIdRef.current;
    if (!id) return;
    const existing = liveHistoryRef.current[id] ?? [];
    liveHistoryRef.current[id] = [...existing.slice(-599), { time: Date.now(), yes: bid }];
  }, []);

  // Connect to the currently visible trending market
  useWebSocket(activeMarketId, handleTrendingWs);

  // Sync ref → state every 500ms for smooth chart redraws
  useEffect(() => {
    if (!activeMarketId) return;
    const timer = setInterval(() => {
      setLiveHistory({ ...liveHistoryRef.current });
    }, 500);
    return () => clearInterval(timer);
  }, [activeMarketId]);

  return (
    <main className="page-shell min-h-screen">
      {data && (
        <div id="trending" className="scroll-mt-40">
          {trendingMarkets.length > 0 ? (
            <TrendingCarousel
              markets={trendingMarkets}
              activeIndex={Math.min(trendingIndex, trendingMarkets.length - 1)}
              onSelect={setTrendingIndex}
              liveHistory={liveHistory}
            />
          ) : (
            <section className="mb-14">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="section-title">{SECTION_LABEL.trending}</h3>
                <span className="section-meta">0 markets</span>
              </div>
                <div className="depth-card rounded-xl p-4 text-sm text-text-muted">
                No trending markets in the current filter.
              </div>
            </section>
          )}
        </div>
      )}

      {/* Header */}
      <div className="page-header-block mb-6">
        <h1 className="page-title">All markets</h1>
        <p className="page-subtitle">
          Aggregated order books across Polymarket and Kalshi
          {data && (
            <span className="text-text-muted">
              {" "}&middot; {data.polymarketCount.toLocaleString()} Polymarket &middot; {data.kalshiCount.toLocaleString()} Kalshi &middot; {data.matchedCount} Matched
            </span>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="controls-row">
        <div className="nav-depth-wrap flex gap-2 w-fit p-1">
          {(["all", "polymarket", "kalshi"] as const).map((v) => (
            <button
              key={v}
              onClick={() => handleVenue(v)}
              className={`nav-depth-pill w-22.5 text-[11px] font-bold uppercase tracking-wider ${
                venue === v ? "nav-depth-pill-active" : ""
              }`}
            >
              {v === "all" ? "All" : v}
            </button>
          ))}
        </div>

        <SortDropdown<SortOption>
          value={sort}
          onChange={setSort}
          options={SORT_OPTIONS}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-ask-muted border border-ask/30 rounded-xl text-sm text-ask">
          Failed to load markets: {error}. Make sure the server is running on port 3001.
        </div>
      )}

      {/* Loading skeletons */}
      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Market grid */}
      {data && (
        <>
          {visibleSections
            .filter((s) => s !== "trending")
            .map((section) => {
              const marketsInSection = sectionedMarkets[section] ?? [];
              const previewMarkets = marketsInSection.slice(0, PREVIEW_MARKETS_PER_CATEGORY);
              return (
                <section
                  key={section}
                  id={section}
                  className="mb-8 scroll-mt-24"
                >
                  <div className="mb-3 flex items-end justify-between gap-4">
                    <h3 className="section-title">{SECTION_LABEL[section]}</h3>
                    <span className="section-meta">{marketsInSection.length} markets</span>
                  </div>
                  {previewMarkets.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {previewMarkets.map((market) => (
                        <MarketCard key={market.id} market={market} />
                      ))}
                    </div>
                  ) : (
                    <div className="depth-card rounded-xl p-4 text-sm text-text-muted">
                      No markets in this section right now.
                    </div>
                  )}
                  {marketsInSection.length >= PREVIEW_MARKETS_PER_CATEGORY && (
                    <div className="mt-4 flex justify-center">
                      <Link
                        href={`/category/${section}`}
                        className="px-5 py-2 text-xs font-semibold uppercase tracking-wide rounded-xl border border-border bg-surface-2 hover:bg-surface-hover transition-colors"
                      >
                        View more markets
                      </Link>
                    </div>
                  )}
                </section>
              );
            })}

          {data.markets.length === 0 && (
            <div className="text-center py-20 text-text-muted">
              No markets found
            </div>
          )}

          <div className="mt-10 flex items-center justify-between gap-4">
            <span className="text-sm text-text-muted">
              Showing {offset + 1}-{Math.min(offset + limit, data.total)} of {data.total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="h-9 px-3.5 text-[13px] font-medium bg-surface-2 border border-border rounded-xl disabled:opacity-30 hover:bg-surface-hover transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={!hasMoreMarkets}
                className="h-9 px-3.5 text-[13px] font-medium bg-surface-2 border border-border rounded-xl disabled:opacity-30 hover:bg-surface-hover transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={
      <div className="page-shell min-h-screen flex items-center justify-center">
        <div className="animate-pulse flex gap-2">
          <div className="w-2 h-2 bg-text-muted rounded-full"></div>
          <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce"></div>
          <div className="w-2 h-2 bg-text-muted rounded-full"></div>
        </div>
      </div>
    }>
      <ExploreContent />
    </Suspense>
  );
}
