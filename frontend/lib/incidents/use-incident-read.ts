"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readError } from "./client";

// A key is the committed URL identity. A late response can never populate a
// different scope, even if an adapter ignores abort.
export function useIncidentRead<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const loader = useRef(load); loader.current = load;
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string; busy: boolean }>({ key, busy: true });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ key, busy: true });
    void loader.current(controller.signal).then(data => {
      if (active) setState({ key, data, busy: false });
    }).catch(error => {
      if (active && !controller.signal.aborted) setState({ key, error: readError(error), busy: false });
    });
    return () => { active = false; controller.abort(); };
  }, [key, generation]);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);
  return { ...(state.key === key ? state : { key, busy: true }), refresh };
}
