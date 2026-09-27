'use client';

import { DEFAULTS, PROVIDER_IDS, type ProviderId } from '@agent-cafe/shared';
import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { PROVIDER_NAME } from '@/lib/format';
import { useCafe } from '@/store/cafe';

/**
 * Task a specific agent (`agent:<id>`) or whoever is free on a floor (`any:<provider>`).
 * `card` sits at the top of the work board; `bar` is Focus mode's command bar.
 */
export function Composer({ variant }: { variant: 'card' | 'bar' }) {
  const agents = useCafe((s) => s.agents);
  const providers = useCafe((s) => s.providers);
  const selectedAgentId = useCafe((s) => s.selectedAgentId);
  const selectAgent = useCafe((s) => s.selectAgent);
  const [target, setTarget] = useState('any:anthropic');
  const [prompt, setPrompt] = useState('');
  const [cap, setCap] = useState(String(DEFAULTS.maxCostUsd));
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { target: useId(), prompt: useId(), cap: useId() };

  // Selecting an agent addresses the next task to them.
  useEffect(() => {
    if (selectedAgentId) setTarget(`agent:${selectedAgentId}`);
  }, [selectedAgentId]);

  const crew = Object.values(agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const anyProvider = target.startsWith('any:') ? (target.slice(4) as ProviderId) : null;
  const targetAgent = target.startsWith('agent:') ? agents[target.slice(6)] : undefined;
  const provider = anyProvider ?? targetAgent?.providerId;
  const mode = provider ? providers[provider]?.mode : undefined;

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    const maxCostUsd = Number(cap.replace('$', ''));
    if (!(maxCostUsd > 0)) {
      setNotice({ ok: false, text: 'Set a budget above $0.' });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const task = await api.createTask({ prompt: text, maxCostUsd, ...(anyProvider ? { providerId: anyProvider } : { agentId: targetAgent?.id }) });
      setNotice({ ok: true, text: `Sent to ${agents[task.agentId]?.name ?? 'an agent'}.` });
      setPrompt('');
      selectAgent(task.agentId, task.id);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const targetSelect = (
    <select
      id={ids.target}
      value={target}
      onChange={(e) => setTarget(e.target.value)}
      className={variant === 'card' ? 'h-11 border-2 border-ink bg-[#f7eedb] px-2 text-sm text-ink' : 'h-11 border-2 border-slate-line bg-night px-2 text-sm text-chalk'}
    >
      <optgroup label="Whoever is free">
        {PROVIDER_IDS.map((p) => (
          <option key={p} value={`any:${p}`}>
            Any {PROVIDER_NAME[p]} agent
          </option>
        ))}
      </optgroup>
      {PROVIDER_IDS.map((p) => (
        <optgroup key={p} label={PROVIDER_NAME[p]}>
          {crew.filter((a) => a.providerId === p).map((a) => (
            <option key={a.id} value={`agent:${a.id}`}>
              {a.name} · {a.model}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  const status = notice ? (
    <span className={notice.ok ? '' : 'text-coral'}>{notice.text}</span>
  ) : (
    <span className="opacity-75">
      {mode === 'mock' ? 'Demo floor: scripted run, no API calls. ' : mode === 'live' ? 'Live: uses your API key. ' : mode === 'off' ? 'That floor is switched off. ' : ''}
      Ctrl+Enter to send.
    </span>
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || variant === 'bar')) {
      e.preventDefault();
      void send();
    }
  };

  if (variant === 'bar') {
    return (
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} aria-label="New task" className="flex w-full flex-col gap-1">
        <div className="flex items-center gap-2 border-2 border-brass bg-night-2 p-2">
          <label htmlFor={ids.target} className="sr-only">For</label>
          {targetSelect}
          <label htmlFor={ids.prompt} className="sr-only">Task</label>
          <input
            id={ids.prompt}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKey}
            placeholder={targetAgent ? `Give ${targetAgent.name} a task…` : 'Describe the task…'}
            className="h-11 min-w-0 flex-1 border-2 border-slate-line bg-night px-3 text-sm text-chalk placeholder:text-chalk-faint"
          />
          <button type="submit" disabled={sending || !prompt.trim() || mode === 'off'} className="h-11 bg-brass px-4 font-label text-[11px] text-night disabled:opacity-40">
            {sending ? 'SENDING…' : 'SEND'}
          </button>
        </div>
        <p role="status" className="px-1 text-[11px] text-chalk-dim">{status}</p>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void send(); }} aria-label="New task" className="flex flex-col gap-2.5 bg-receipt px-4 py-3.5 text-ink">
      <label htmlFor={ids.prompt} className="font-label text-[10px] text-ink-soft">NEW TASK</label>
      <textarea
        id={ids.prompt}
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKey}
        placeholder="e.g. Read the workspace README and list anything outdated"
        className="resize-none border-2 border-ink bg-[#f7eedb] px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-soft/70"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={ids.target} className="font-label text-[10px] text-ink-soft">FOR</label>
        {targetSelect}
        <label htmlFor={ids.cap} className="font-label text-[10px] text-ink-soft">BUDGET</label>
        <input id={ids.cap} value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className="h-11 w-16 border-2 border-ink bg-[#f7eedb] px-2 text-sm text-ink" />
        <button type="submit" disabled={sending || !prompt.trim() || mode === 'off'} className="ml-auto h-11 bg-ink px-4 font-label text-[11px] text-receipt hover:bg-walnut disabled:opacity-40">
          {sending ? 'SENDING…' : 'SEND TASK'}
        </button>
      </div>
      <p role="status" className="text-[11px] text-ink-soft">{status}</p>
    </form>
  );
}
