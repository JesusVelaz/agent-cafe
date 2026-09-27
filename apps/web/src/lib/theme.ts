'use client';

import { useEffect, useState } from 'react';
import { THEME_IDS, type ThemeId } from '@/scene/atmosphere';

/** 'auto' follows the local clock and calendar; anything else is a manual override. */
export type ThemeChoice = 'auto' | ThemeId;

const KEY = 'cafe.theme';

/**
 * Auto theme: night 20:00–06:00, golden hour ("summer") 17:30–20:00, otherwise
 * day, except December–February daytime, which snows. Live weather (rain/snow
 * from a forecast) plugs in here later.
 */
export function resolveTheme(date: Date, choice: ThemeChoice = 'auto'): ThemeId {
  if (choice !== 'auto') return choice;
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 20 * 60 || minutes < 6 * 60) return 'night';
  if (minutes >= 17 * 60 + 30) return 'summer';
  const month = date.getMonth(); // 0 = January
  if (month === 11 || month <= 1) return 'snow';
  return 'day';
}

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'auto' || (v && (THEME_IDS as string[]).includes(v))) return v as ThemeChoice;
  } catch {
    /* storage unavailable: fall back to auto */
  }
  return 'auto';
}

/** The viewer's theme choice (remembered in this browser) and the theme it resolves to right now. */
export function useTheme(): { choice: ThemeChoice; theme: ThemeId; setChoice: (c: ThemeChoice) => void } {
  const [choice, setChoiceState] = useState<ThemeChoice>('auto');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => setChoiceState(readChoice()), []);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const setChoice = (c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* fine: the choice just won't persist */
    }
  };
  return { choice, theme: resolveTheme(now, choice), setChoice };
}
