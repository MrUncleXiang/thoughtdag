import { useEffect, useState } from 'react';

// The repository's star count, for the ⋯ menu's GitHub entry: fetched from
// GitHub's public API at most every six hours, remembered in this browser so
// the number shows at once (and offline, as the last one seen). Where the
// fetch is not allowed (a host's content policy) the entry simply shows no
// number. Nothing about the user is sent: an anonymous GET of public data.

export const REPO_URL = 'https://github.com/chenxiachan/thoughtdag';
const API = 'https://api.github.com/repos/chenxiachan/thoughtdag';
const KEY = 'thoughtdag.githubStars';
const TTL_MS = 6 * 60 * 60 * 1000;

interface Cached { stars: number; at: number }
const read = (): Cached | null => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v && typeof v.stars === 'number' && typeof v.at === 'number' ? v : null; } catch { return null; } };
const write = (c: Cached) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* the count is a nicety */ } };

let inflight: Promise<number | null> | null = null;
/** The star count, cached; null when unknown and unreachable. */
export function githubStars(): Promise<number | null> {
  const c = read();
  if (c && Date.now() - c.at < TTL_MS) return Promise.resolve(c.stars);
  inflight ??= fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { stargazers_count?: number } | null) => {
      const n = typeof j?.stargazers_count === 'number' ? j.stargazers_count : null;
      if (n !== null) write({ stars: n, at: Date.now() });
      return n ?? c?.stars ?? null;
    })
    .catch(() => c?.stars ?? null)
    .finally(() => { inflight = null; });
  return inflight;
}

/** The count for a component: the cached number at once, the fresh one when it arrives. */
export function useGithubStars(): number | null {
  const [stars, setStars] = useState<number | null>(() => read()?.stars ?? null);
  useEffect(() => { let alive = true; void githubStars().then((n) => { if (alive && n !== null) setStars(n); }); return () => { alive = false; }; }, []);
  return stars;
}

/** 519 → "519", 1234 → "1.2k": the menu has room for four characters. */
export const formatStars = (n: number): string => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
