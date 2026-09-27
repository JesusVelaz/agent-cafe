'use client';

import { DEFAULTS, PROVIDER_IDS, type ProviderId } from '@agent-cafe/shared';
import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { PROVIDER_NAME } from '@/lib/format';
import { useCafe } from '@/store/cafe';

/**
 * The order pad: a paper receipt at the foot of the café. Sending an order hangs
 * a ticket on that floor's rail in the scene.
 *
 * Target encoding: `agent:<id>` for a specific agent, `any:<provider>` to route to
 * whichever matching agent is free (optionally filtered by model).
 */
export function OrderPad() {
  const agents = useCafe((s) => s.agents);
  const providers = useCafe((s) => s.providers);
  const selectedAgentId = useCafe((s) => s.selectedAgentId);
  const selectAgent = useCafe((s) => s.selectAgent);
  const [target, setTarget] = useState<string>('any:openai');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cap, setCap] = useState(String(DEFAULTS.maxCostUsd));
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const ids = { target: useId(), model: useId(), prompt: useId(), cap: useId() };

  // Follow the selected agent: selecting Mocha pre-addresses the order to Mocha.
  useEffect(() => {
    if (selectedAgentId) setTarget(`agent:${selectedAgentId}`);
  }, [selectedAgentId]);

  const crew = Object.values(agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const anyProvider = target.startsWith('any:') ? (target.slice(4) as ProviderId) : null;
  const floorModels = anyProvider ? [...new Set(crew.filter((a) => a.providerId === anyProvider).map((a) => a.model))] : [];
  const targetAgent = target.startsWith('agent:') ? agents[target.slice(6)] : undefined;
  const provider = anyProvider ?? targetAgent?.providerId;
  const mode = provider ? providers[provider]?.mode : undefined;

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    const maxCostUsd = Number(cap);
    if (!(maxCostUsd > 0)) {
      setNotice({ tone: 'err', text: 'Set a budget above $0.' });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const task = await api.createTask({
        prompt: text,
        maxCostUsd,
        ...(anyProvider ? { providerId: anyProvider, ...(model ? { model } : {}) } : { agentId: targetAgent?.id }),
      });
      const who = agents[task.agentId]?.name ?? 'an agent';
      setNotice({ tone: 'ok', text: `Order up for ${who}. Ticket's on the rail.` });
      setPrompt('');
      selectAgent(task.agentId, task.id);
    } catch (e) {
      setNotice({ tone: 'err', text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="receipt px-4 pb-3 pt-4"
      aria-label="New order"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.target} className="font-label text-[10px] uppercase text-ink-soft">
            For
          </label>
          <select
            id={ids.target}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setModel('');
            }}
            className="h-9 border-2 border-ink bg-receipt px-2 text-sm text-ink"
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
                {crew
                  .filter((a) => a.providerId === p)
                  .map((a) => (
                    <option key={a.id} value={`agent:${a.id}`}>
                      {a.name} · {a.model}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>

        {anyProvider && (
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.model} className="font-label text-[10px] uppercase text-ink-soft">
              Model
            </label>
            <select
              id={ids.model}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 border-2 border-ink bg-receipt px-2 text-sm text-ink"
            >
              <option value="">Any model</option>
              {floorModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <label htmlFor={ids.prompt} className="font-label text-[10px] uppercase text-ink-soft">
            Order
          </label>
          <textarea
            id={ids.prompt}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="e.g. Read the workspace README and summarise it"
            className="min-h-9 resize-y border-2 border-ink bg-receipt px-2 py-1.5 text-sm text-ink placeholder:text-ink-soft/60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.cap} className="font-label text-[10px] uppercase text-ink-soft">
            Budget
          </label>
          <div className="flex h-9 items-center border-2 border-ink bg-receipt pl-2 text-sm">
            <span className="text-ink-soft">$</span>
            <input
              id={ids.cap}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              inputMode="decimal"
              className="w-14 bg-transparent px-1 text-ink outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={sending || !prompt.trim() || mode === 'off'}
          className="h-9 border-2 border-ink bg-ink px-4 font-label text-xs uppercase tracking-wider text-receipt transition-colors hover:bg-walnut-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? 'Sending…' : 'Send order'}
        </button>
      </div>
      <p className="mt-2 min-h-4 text-[11px]" role="status">
        {notice ? (
          <span className={notice.tone === 'ok' ? 'text-ink' : 'text-coral'}>{notice.text}</span>
        ) : (
          <span className="text-ink-soft">
            {mode === 'mock' && 'Demo mode: scripted run, no API calls. '}
            {mode === 'off' && 'This floor is switched off. '}
            {mode === 'live' && 'Live: this order uses your API key. '}
            Ctrl+Enter to send.
          </span>
        )}
      </p>
    </form>
  );
}
