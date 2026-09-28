'use client';

import type { ThemeId } from '@/scene/atmosphere';
import type { ThemeChoice } from '@/lib/theme';
import { Caret, Popover } from './ui';

const ICONS: Record<ThemeId, React.ReactNode> = {
  day: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </>
  ),
  summer: <path d="M1.5 12.5h13M4.5 12.5a3.5 3.5 0 0 1 7 0M8 4v2M3.6 6.6l1.2 1.2M12.4 6.6l-1.2 1.2" />,
  rain: (
    <>
      <path d="M4.5 10.5a3 3 0 0 1 .4-6 4 4 0 0 1 7.5 1.2 2.4 2.4 0 0 1-.4 4.8z" />
      <path d="M5.5 12.5l-.8 1.8M8.5 12.5l-.8 1.8M11.5 12.5l-.8 1.8" />
    </>
  ),
  snow: <path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5M6.3 2.8L8 4.3l1.7-1.5M6.3 13.2L8 11.7l1.7 1.5" />,
  night: <path d="M13.5 9.8A5.5 5.5 0 0 1 6.2 2.5a5.5 5.5 0 1 0 7.3 7.3z" />,
};

const LABELS: Record<ThemeChoice, string> = {
  auto: 'Auto (local time and season)',
  day: 'Day',
  summer: 'Golden hour',
  rain: 'Rain',
  snow: 'Snow',
  night: 'Night',
};

export function ThemeIcon({ theme }: { theme: ThemeId }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      {ICONS[theme]}
    </svg>
  );
}

/** Auto plus the five looks, in a small menu. Auto shows which look it resolves to right now. */
export function ThemePicker({ choice, theme, onChange }: { choice: ThemeChoice; theme: ThemeId; onChange: (c: ThemeChoice) => void }) {
  const options: ThemeChoice[] = ['auto', 'day', 'summer', 'rain', 'snow', 'night'];
  return (
    <Popover
      label="Café theme"
      side="bottom"
      align="end"
      className="w-[220px]"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`Theme: ${LABELS[choice]}`}
          className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] text-chalk-dim hover:text-chalk ${open ? 'border-[#434a58] bg-slate' : 'border-slate-line hover:bg-slate'}`}
        >
          <ThemeIcon theme={theme} />
          {choice === 'auto' ? 'Auto' : LABELS[choice]}
          <Caret />
        </button>
      )}
    >
      {(close) => (
        <div role="radiogroup" aria-label="Café theme" className="flex flex-col p-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={opt === choice}
              onClick={() => (onChange(opt), close())}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${opt === choice ? 'bg-slate-2 text-chalk' : 'text-chalk-dim hover:bg-slate-2 hover:text-chalk'}`}
            >
              <ThemeIcon theme={opt === 'auto' ? theme : opt} />
              {opt === 'auto' ? `Auto · ${LABELS[theme]} now` : LABELS[opt]}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
