import { useCallback, useEffect, useRef, useState } from 'react';
import { getUserFromToken, type TokenUser } from '@/lib/auth';
import { researchRequest } from '@/lib/research-api/client';
import type { Simulation } from './types';
import { isConflict, readError } from './live-api';
import type { DemoCreateRequest, DemoCommandRequest } from '@/types/generated/demo-read';
import { hasNewFailure } from './presentation';

type Command = DemoCommandRequest extends infer T ? T extends {revision: number} ? Omit<T, 'revision'> : never : never;
type Intent = {actor: string; sessionId: string; body: DemoCommandRequest; key: string};
export function useLiveSimulation(initialId?: string) {
  const [actor, setActor] = useState<TokenUser | null>();
  const actorRef = useRef<string | undefined>(undefined); const alive = useRef(false);
  const contextEpoch = useRef(0);
  const [saved, setSaved] = useState<{actor: string; session: Simulation}>();
  const current = useRef<Simulation | undefined>(undefined); const locked = useRef(false);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [running, setRunning] = useState(false);
  const [automatic, setAutomatic] = useState(false); const [pauseOnFailure, setPauseOnFailure] = useState(true);
  const [speed, setSpeed] = useState(1000); const [reload, setReload] = useState(0);
  const [uncertain, setUncertain] = useState<Intent>();
  const [writeDenied, setWriteDenied] = useState(false);
  const createIntent = useRef<{actor: string; input: string; key: string} | undefined>(undefined);
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    const owned = controllers.current;
    alive.current = true; let epoch = 0;
    async function identify() {
      const token = ++epoch;
      actorRef.current = undefined; current.current = undefined; setActor(undefined); setRunning(false); setAutomatic(false); setSaved(undefined); setUncertain(undefined); setError(''); setWriteDenied(false);
      for (const controller of owned) controller.abort();
      const user = await getUserFromToken().catch(() => null);
      if (alive.current && token === epoch) { actorRef.current = user?.id; setActor(user); }
    }
    void identify(); window.addEventListener('focus', identify);
    return () => { alive.current = false; ++epoch; window.removeEventListener('focus', identify); for (const controller of owned) controller.abort(); };
  }, []);
  const accept = useCallback((data: Simulation, owner: string) => {
    if (!alive.current || actorRef.current !== owner) return;
    current.current = data; setSaved({actor: owner, session: data});
    try { sessionStorage.setItem(`mcc-demo-session:${owner}`, data.id); } catch {}
    const url = new URL(window.location.href);
    if (url.searchParams.get('session') !== data.id) { url.searchParams.delete('machine'); url.searchParams.delete('incident'); }
    url.searchParams.set('session', data.id); window.history.replaceState(null, '', url);
    window.dispatchEvent(new Event('sim-selection-change'));
  }, []);
  useEffect(() => {
    const epoch = ++contextEpoch.current;
    if (!actor) { setLoading(false); return; }
    const owner = actor.id; const controller = new AbortController(); const owned = controllers.current; owned.add(controller);
    let stored: string | null = null; try { stored = sessionStorage.getItem(`mcc-demo-session:${owner}`); } catch {}
    const id = new URLSearchParams(window.location.search).get('session') || initialId || stored;
    if (current.current?.id !== id) { current.current = undefined; setSaved(undefined); }
    setLoading(true); setError(previous => previous.startsWith('Session revision changed.') ? previous : ''); setRunning(false);
    if (!id) { setLoading(false); return () => { owned.delete(controller); controller.abort(); }; }
    void researchRequest<Simulation>(`/demo/sessions/${encodeURIComponent(id)}`, {signal: controller.signal}).then(data => {
      if (!controller.signal.aborted && actorRef.current === owner && contextEpoch.current === epoch) {
        if (data.id !== id) throw new Error('Session identity mismatch');
        accept(data, owner);
      }
    }).catch(e => { if (!controller.signal.aborted && actorRef.current === owner && contextEpoch.current === epoch) { current.current = undefined; setSaved(undefined); setError(readError(e)); } })
      .finally(() => { owned.delete(controller); if (!controller.signal.aborted && actorRef.current === owner && contextEpoch.current === epoch) setLoading(false); });
    return () => { owned.delete(controller); controller.abort(); };
  }, [actor, initialId, reload, accept]);
  useEffect(() => {
    const back = () => { ++contextEpoch.current; setRunning(false); current.current = undefined; setSaved(undefined); setUncertain(undefined); setReload(n => n + 1); };
    window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back);
  }, []);
  const addressId = typeof window === 'undefined' ? initialId : new URLSearchParams(window.location.search).get('session') || initialId;
  const session = saved?.actor === actor?.id && (!addressId || saved?.session.id === addressId) ? saved?.session : undefined;
  const canWrite = !writeDenied && (actor?.role === 'ADMIN' || actor?.role === 'ENGINEER');
  async function create(body: DemoCreateRequest) {
    if (!actor || !canWrite || locked.current || uncertain) return;
    const epoch = ++contextEpoch.current;
    const owner = actor.id; const input = JSON.stringify(body);
    if (createIntent.current?.input !== input || createIntent.current.actor !== owner) createIntent.current = {actor: owner, input, key: crypto.randomUUID()};
    locked.current = true; setBusy(true); setRunning(false); setError('');
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const next = await researchRequest<Simulation>('/demo/sessions', {body, key: createIntent.current.key, signal: controller.signal});
      if (!controller.signal.aborted && actorRef.current === owner && contextEpoch.current === epoch) { accept(next, owner); setLoading(false); createIntent.current = undefined; setAutomatic(false); return next; }
    } catch (e) { if (!controller.signal.aborted && actorRef.current === owner && contextEpoch.current === epoch) {setError(readError(e)); setLoading(false);} }
    finally { controllers.current.delete(controller); locked.current = false; if (alive.current) setBusy(false); }
  }
  async function submit(intent: Intent) {
    if (locked.current || !canWrite || intent.actor !== actorRef.current) return;
    const epoch = contextEpoch.current;
    locked.current = true; setBusy(true); setError('');
    const before = current.current; const controller = new AbortController(); controllers.current.add(controller);
    try {
      const next = await researchRequest<Simulation>(`/demo/sessions/${encodeURIComponent(intent.sessionId)}/commands`, {body: intent.body, key: intent.key, signal: controller.signal});
      if (controller.signal.aborted || intent.actor !== actorRef.current || contextEpoch.current !== epoch) return;
      if (next.id !== intent.sessionId || next.revision !== intent.body.revision + 1) throw new Error('Command response identity/revision mismatch');
      accept(next, intent.actor); setUncertain(undefined);
      const failed = hasNewFailure(before, next);
      if (next.status !== 'RUNNING' || pauseOnFailure && failed) setRunning(false);
      return next;
    } catch (e) {
      if (controller.signal.aborted || intent.actor !== actorRef.current || contextEpoch.current !== epoch) return;
      setRunning(false); setError(readError(e));
      const status = e && typeof e === 'object' && 'status' in e ? e.status : undefined;
      if (status === 401 || status === 403) { setWriteDenied(true); setUncertain(undefined); setAutomatic(false); }
      else if (isConflict(e)) { setUncertain(undefined); setAutomatic(false); setReload(n => n + 1); }
      else setUncertain(intent);
    } finally { controllers.current.delete(controller); locked.current = false; if (alive.current) setBusy(false); }
  }
  async function command(body: Command) {
    const data = current.current;
    if (!actor || !data || uncertain || locked.current) return;
    return submit({actor: actor.id, sessionId: data.id, body: {revision: data.revision, ...body}, key: crypto.randomUUID()});
  }
  useEffect(() => {
    if (!running || busy || uncertain || !session || session.status !== 'RUNNING' || !canWrite) return;
    const timer = setTimeout(() => void command({command: 'advance', autoApprove: automatic}), speed);
    return () => clearTimeout(timer);
    // A single timeout is scheduled after the previous response; Pause cancels only the next tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, busy, uncertain, session?.id, session?.revision, automatic, speed, canWrite]);
  return {actor, session, loading: actor === undefined || loading, busy, error, running, setRunning, automatic, setAutomatic,
    pauseOnFailure, setPauseOnFailure, speed, setSpeed, canWrite, create, command, uncertain,
    retryCommand: () => uncertain && submit(uncertain), refresh: () => { setRunning(false); setReload(n => n + 1); }};
}
