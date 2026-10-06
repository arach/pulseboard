import { useCallback, useEffect, useRef, useState } from "react";
import type { NpmPayload, OverviewPayload, RealtimePayload, SearchPayload } from "./types";

const REALTIME_INTERVAL_MS = 60_000;

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Session expired");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError((body as { error?: string }).error ?? `HTTP ${response.status}`, response.status);
  }
  return body as T;
}

export interface Source<T> {
  data: T | null;
  error: string | null;
  loadedAt: number | null;
}

type Setter<T> = (next: Source<T> | ((prev: Source<T>) => Source<T>)) => void;

const empty = <T,>(): Source<T> => ({ data: null, error: null, loadedAt: null });

export function usePulseData() {
  const [realtime, setRealtime] = useState<Source<RealtimePayload>>(empty);
  const [overview, setOverview] = useState<Source<OverviewPayload>>(empty);
  const [npm, setNpm] = useState<Source<NpmPayload>>(empty);
  const [search, setSearch] = useState<Source<SearchPayload>>(empty);
  const [polling, setPolling] = useState(false);
  const [pollMessage, setPollMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(
    async <T,>(path: string, set: Setter<T>, init?: RequestInit): Promise<string | null> => {
      try {
        const data = await getJson<T>(path, init);
        set({ data, error: null, loadedAt: Date.now() });
        return null;
      } catch (error) {
        // A refresh on cooldown is not a failure; just read what is stored.
        if (error instanceof HttpError && error.status === 429 && init?.method === "POST") {
          return load(path.replace("/refresh/", "/"), set);
        }
        const message = error instanceof Error ? error.message : "Unavailable";
        // Keep what is on screen; the section reports the failure next to it.
        set((prev) => ({ data: prev.data, error: message, loadedAt: Date.now() }));
        return message;
      }
    },
    [],
  );

  const loadAll = useCallback(
    () =>
      Promise.all([
        load<RealtimePayload>("/api/realtime", setRealtime),
        load<OverviewPayload>("/api/overview", setOverview),
        load<NpmPayload>("/api/npm", setNpm),
        load<SearchPayload>("/api/search", setSearch),
      ]),
    [load],
  );

  useEffect(() => {
    void loadAll();
    timer.current = window.setInterval(
      () => void load<RealtimePayload>("/api/realtime", setRealtime),
      REALTIME_INTERVAL_MS,
    );
    return () => window.clearInterval(timer.current);
  }, [load, loadAll]);

  const pollNow = useCallback(async () => {
    setPolling(true);
    setPollMessage(null);
    try {
      // One request per source, so each refresh runs in its own Worker invocation.
      const post = { method: "POST" };
      const failures = (
        await Promise.all([
          load<RealtimePayload>("/api/refresh/realtime", setRealtime, post),
          load<OverviewPayload>("/api/refresh/overview", setOverview, post),
          load<NpmPayload>("/api/refresh/npm", setNpm, post),
          load<SearchPayload>("/api/refresh/search", setSearch, post),
        ])
      ).filter((message): message is string => message !== null);
      if (failures.length > 0) setPollMessage(failures[0]);
    } finally {
      setPolling(false);
    }
  }, [load]);

  return { realtime, overview, npm, search, polling, pollMessage, pollNow };
}

/** Re-renders every `ms` so relative timestamps stay current. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
