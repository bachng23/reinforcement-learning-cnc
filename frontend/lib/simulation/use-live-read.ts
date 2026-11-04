import { useEffect, useRef, useState } from 'react';
import { readError } from './live-api';

/** A result is visible only for its exact identity; abort + epoch also fence ignored signals. */
export function useLiveRead<T>(key: string | undefined, read: (signal: AbortSignal) => Promise<T>) {
  const request = useRef(read); request.current = read;
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{key: string; retry: number; data?: T; error?: unknown}>();
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController(); let active = true;
    void request.current(controller.signal).then(data => {
      if (active && !controller.signal.aborted) setResult({key, retry, data});
    }).catch(error => { if (active && !controller.signal.aborted) setResult({key, retry, error}); });
    return () => { active = false; controller.abort(); };
  }, [key, retry]);
  const visible = key && result?.key === key && result.retry === retry ? result : undefined;
  return { data: visible?.data, error: visible?.error, message: visible?.error ? readError(visible.error) : '', loading: !!key && !visible,
    retry: () => setRetry(value => value + 1) };
}
