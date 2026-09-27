'use client';

import { useEffect, useState } from 'react';

/** Current time, re-rendering every `ms`. For live durations and stuck detection. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
