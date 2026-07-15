import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client.js";

export type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number;
  stage: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
};

const TERMINAL = new Set(["done", "failed", "canceled"]);
const POLL_MS = 1000;

/**
 * Poll a job until it reaches a terminal state. Polling is the contract for now;
 * swapping to SSE later shouldn't change this hook's shape.
 */
export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      const { data, error } = await api.GET("/api/video-processing-jobs/{jobId}", {
        params: { path: { jobId } },
      });
      if (cancelled) return;
      if (error) return; // transient — the next tick retries

      setJob(data as Job);
      if (!TERMINAL.has(data.status)) timer.current = window.setTimeout(tick, POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId, stop]);

  return job;
}
