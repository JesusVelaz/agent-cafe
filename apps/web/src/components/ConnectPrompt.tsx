'use client';

import { HARNESS, type ProviderId } from '@agent-cafe/shared';
import { useEffect, useRef, useState } from 'react';
import { useCafe } from '@/store/cafe';
import { CupIcon } from './CupIcon';
import { HarnessIcon } from './ui';

const DISMISSED = 'cafe.connectPromptDismissed';
const IDS: ProviderId[] = ['anthropic', 'openai'];

function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/**
 * Shown when no provider is signed in: agents can only run demo tasks until one is.
 * "Not now" hides it for the rest of this visit; connecting anywhere closes it.
 */
export function ConnectPrompt({ onConnect }: { onConnect: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const hydrated = useCafe((s) => s.hydrated);
  const providers = useCafe((s) => s.providers);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(wasDismissed()), []);

  // Wait until every provider has finished its check, so a slow check doesn't flash the prompt.
  const states = IDS.map((id) => providers[id]?.connection.state);
  const settled = hydrated && states.every((s) => s && s !== 'checking');
  const none = settled && !states.includes('ready');
  const open = none && !dismissed;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED, '1');
    } catch {
      /* private mode: it just comes back next load */
    }
    setDismissed(true);
  };

  return (
    <dialog
      ref={ref}
      onClose={dismiss}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(); // click on the backdrop
      }}
      aria-labelledby="connect-title"
      className="m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-slate-line bg-night-2 p-6 text-chalk shadow-[0_30px_80px_rgba(0,0,0,.55)] transition-[opacity,scale] duration-200 backdrop:bg-black/50 backdrop:backdrop-blur-[2px] starting:scale-95 starting:opacity-0"
    >
      <CupIcon size={36} mood="quiet" />
      <h2 id="connect-title" className="mt-3 font-display text-[30px] font-normal leading-none">Connect a provider</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-chalk-dim">
        Your agents need a signed-in account to do real work. Until you connect one, they only run demo tasks.
      </p>
      <ul className="mt-4 flex flex-col gap-1.5">
        {IDS.map((id) => (
          <li key={id} className="flex items-center gap-2.5 rounded-lg border border-slate-line bg-slate px-3 py-2 text-[13px]">
            <HarnessIcon harness={HARNESS[id].id} />
            <span className="font-medium">{HARNESS[id].account}</span>
            <span className="text-chalk-faint">via {HARNESS[id].name}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-chalk-faint">Signing in happens in the provider’s own app; Agent Café never sees your password or tokens.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={dismiss} className="h-9 rounded-lg border border-slate-line px-3.5 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk">
          Not now
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => {
            dismiss();
            onConnect();
          }}
          className="h-9 rounded-lg bg-accent px-4 text-[13px] font-medium text-white hover:bg-[#7f9bff]"
        >
          Connect a provider
        </button>
      </div>
    </dialog>
  );
}
