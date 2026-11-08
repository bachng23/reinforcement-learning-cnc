"use client";
import { useCallback, useEffect, useState } from 'react';
export function useResource<T>(key: string, loader: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    const controller = new AbortController(); setState(previous => previous.key === key ? { key, data: previous.data } : { key });
    loader(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data });
    }).catch(error => { if (!controller.signal.aborted) setState({ key, error: String(error.message || error) }); });
    return () => controller.abort();
    // Callers supply a stable resource key; loader closure is captured for that key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  return { ...(state.key === key ? state : { key }), reload };
}
