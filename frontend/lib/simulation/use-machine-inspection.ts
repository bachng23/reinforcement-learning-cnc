'use client';

import { useEffect, useRef, useState } from 'react';
import type { Simulation } from './types';
import { inspectionError, readMachineHealth } from './machine-health';
import { readMachineWorkOrders } from './work-orders';

type Context = Awaited<ReturnType<typeof readMachineHealth>> & {
  workOrders: Awaited<ReturnType<typeof readMachineWorkOrders>>;
};
type ReadState = { key: string; revision: number; context?: Context; error?: string; loading: boolean };

/** Coalesce playback updates, cancel obsolete reads, retain only a same-machine consistent pair. */
export function useMachineInspection(snapshot: Simulation | undefined, machine: number) {
  const key = snapshot ? `${snapshot.id}:${machine}` : '';
  const [state, setState] = useState<ReadState>();
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [attempt, setAttempt] = useState(0);
  const revision = snapshot?.revision;
  useEffect(() => {
    if (!key || revision === undefined) return;
    const abort = new AbortController();
    setState(previous => ({ key, revision, loading: true, context: previous?.key === key ? previous.context : undefined }));
    // Requests follow server revisions, never animation frames. A burst reads only the newest revision.
    const timer = setTimeout(async () => {
      const current = latest.current;
      if (!current) return;
      try {
        const [healthContext, workOrders] = await Promise.all([
          readMachineHealth(current, machine, abort.signal),
          readMachineWorkOrders(current, machine, abort.signal),
        ]);
        if (!abort.signal.aborted) {
          setState({ key, revision, context: { ...healthContext, workOrders }, loading: false });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setState({ key, revision, loading: false, error: inspectionError(error) });
          abort.abort();
        }
      }
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [key, revision, machine, attempt]);
  const visible = state?.key === key ? state : undefined;
  return {
    context: visible?.context,
    loading: Boolean(key) && (!visible || visible.loading || visible.revision !== revision),
    error: visible?.error,
    retry: () => setAttempt(value => value + 1),
  };
}
