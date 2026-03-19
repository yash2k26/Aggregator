const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

interface Point {
  t: number; // timestamp ms
  y: number; // yesPrice 0-1
}

/**
 * In-memory price history store.
 * Records one data point per market per cache refresh (~5 min).
 * Keeps up to 48 hours of data, auto-prunes on read.
 */
export class PriceHistoryStore {
  private data = new Map<string, Point[]>();

  /** Record a price snapshot for a market. */
  record(marketId: string, yesPrice: number | null): void {
    if (yesPrice === null) return;
    const points = this.data.get(marketId) ?? [];
    points.push({ t: Date.now(), y: yesPrice });
    this.data.set(marketId, points);
  }

  /** Record prices for many markets at once (called after cache refresh). */
  recordAll(markets: Array<{ id: string; yesPrice: number | null }>): void {
    const now = Date.now();
    for (const m of markets) {
      if (m.yesPrice === null) continue;
      const points = this.data.get(m.id) ?? [];
      points.push({ t: now, y: m.yesPrice });
      this.data.set(m.id, points);
    }
  }

  /** Get price history for a market within the last `hours` hours. */
  get(marketId: string, hours = 24): Point[] {
    const points = this.data.get(marketId);
    if (!points || points.length === 0) return [];

    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    // Prune old data beyond 48h
    const pruneCutoff = Date.now() - MAX_AGE_MS;
    const pruneIdx = points.findIndex((p) => p.t >= pruneCutoff);
    if (pruneIdx > 0) points.splice(0, pruneIdx);

    // Return only points within requested range
    const startIdx = points.findIndex((p) => p.t >= cutoff);
    return startIdx < 0 ? [] : points.slice(startIdx);
  }
}
