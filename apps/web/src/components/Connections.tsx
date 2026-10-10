'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, ApiError, type PhoneStatus } from '@/lib/api';
import { networkPrefix } from '@/lib/phone';

const CHOICES = [
  { via: 'tailscale', title: 'Over Tailscale', hint: 'Works anywhere, encrypted. Needs Tailscale on this computer and your phone.' },
  { via: 'lan', title: 'On your home network', hint: 'Your phone must be on the same Wi-Fi or router as this computer. Not encrypted, so only at home.' },
] as const;

/**
 * Settings → Connections: opens the café to phones (over Tailscale or the home network) and shows
 * the pairing link as a QR code. Only on this computer: the server refuses these calls from a phone.
 */
export function Connections({ active }: { active: boolean }) {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the computer running the café can open it to phones.
  const [onThisComputer, setOnThisComputer] = useState(true);
  useEffect(() => setOnThisComputer(['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)), []);

  useEffect(() => {
    if (!active || !onThisComputer) return;
    setError(null);
    setStatus(null);
    api.phone().then(setStatus, (err) =>
      // The page was rebuilt while an older café server kept running (it serves the new files).
      setError(err instanceof ApiError && err.status === 404 ? 'This café is still running an older version. Close it (Ctrl+C in its window), then start it again.' : err instanceof ApiError ? err.message : String(err)),
    );
  }, [active, onThisComputer]);

  // Until a phone gets through, keep asking: the section turns to "connected" the moment one does.
  const waiting = active && !!status?.sharing && !status.sharing.reached;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => api.phone().then(setStatus, () => {}), 2000);
    return () => clearInterval(timer);
  }, [waiting]);

  const run = async (key: string, action: () => Promise<PhoneStatus>) => {
    setBusy(key);
    setError(null);
    try {
      setStatus(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-5 sm:pr-10">
        <h3 className="text-[18px] font-semibold">Connections</h3>
        <p className="mt-1 text-[13px] text-chalk-dim">Use the café from your phone. It keeps running on this computer; your phone becomes another screen for it.</p>
      </div>
      <div className="max-w-[420px]">
        <p className="text-[13px] font-medium">Your phone</p>

        {!onThisComputer && <p className="mt-2 text-[13px] text-chalk-dim">You’re already on a paired device. Phone access is set up on the computer running the café.</p>}

        {onThisComputer && status && !status.available && (
          <p className="mt-2 text-[13px] text-chalk-dim">
            Phone access works when the café runs with <code className="text-chalk">pnpm start</code> or the{' '}
            <code className="text-chalk">agent-cafe</code> command.
          </p>
        )}

        {onThisComputer && status?.available && !status.sharing && (
          <>
            <p className="mt-1 text-[13px] text-chalk-dim">Open the café to your phone, then scan the code it shows.</p>
            <div className="mt-3 flex flex-col gap-2">
              {CHOICES.map((c) => (
                <button
                  key={c.via}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(c.via, () => api.sharePhone(c.via))}
                  className="rounded-xl border border-slate-line bg-slate px-4 py-3 text-left hover:bg-slate-2 disabled:opacity-60"
                >
                  <span className="block text-[14px] font-medium">{busy === c.via ? 'Opening…' : c.title}</span>
                  <span className="mt-0.5 block text-[12px] text-chalk-faint">{c.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {onThisComputer && status?.sharing && (
          <Sharing sharing={status.sharing} busy={busy} onFix={() => run('fix', api.fixPhone)} onStop={() => run('stop', api.stopPhone)} />
        )}

        {onThisComputer && !status && !error && <p className="mt-2 text-[13px] text-chalk-faint">Checking…</p>}
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-coral">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

type Shared = NonNullable<PhoneStatus['sharing']>;

/** What Windows Firewall is doing to the phone, in words, and what "Fix it" will change. */
function firewallText({ kind, network }: NonNullable<Shared['firewall']>) {
  const problem =
    kind === 'blocked'
      ? 'Windows Firewall is blocking the café, so your phone can’t load it.'
      : network === 'Public'
        ? 'Windows treats this network as public and won’t let your phone in.'
        : 'Windows Firewall isn’t letting your phone in yet.';
  const fix =
    network === 'Public'
      ? 'Fix it marks this network as your home (private) network and lets phones on it reach the café. Windows will ask for permission.'
      : 'Fix it lets phones on your home network reach the café. Windows will ask for permission.';
  return { problem, fix };
}

function Sharing({ sharing, busy, onFix, onStop }: { sharing: Shared; busy: string | null; onFix: () => void; onStop: () => void }) {
  const [svg, setSvg] = useState('');
  const [copied, setCopied] = useState(false);
  // No phone yet after a while, and nothing found in the way: the usual other reasons.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (sharing.reached) return;
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [sharing.reached, sharing.link]);

  useEffect(() => {
    let live = true;
    QRCode.toString(sharing.link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [sharing.link]);

  const copy = async () => {
    await navigator.clipboard?.writeText(sharing.link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <p className="mt-1 text-[13px] text-chalk-dim">Scan this with your phone’s camera.</p>
      {/* Our own SVG, made from the link just below. White behind it so any camera can read it. */}
      <div
        aria-label="QR code that pairs your phone"
        role="img"
        className="mt-3 size-56 overflow-hidden rounded-xl bg-white [&>svg]:size-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="mt-4 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-code px-2.5 py-2 text-[12px] text-chalk-dim">{sharing.link}</code>
        <button type="button" onClick={copy} className="shrink-0 rounded-lg border border-slate-line px-3 py-2 text-[12px] text-chalk-dim hover:bg-slate hover:text-chalk">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Progress sharing={sharing} slow={slow} fixing={busy === 'fix'} onFix={onFix} />
      {sharing.via === 'tailscale' ? (
        <p className="mt-3 text-[12px] text-chalk-faint">Over Tailscale: works wherever your phone has Tailscale on.</p>
      ) : (
        <p className="mt-3 text-[12px] text-amber">Your phone has to be on the same network, and the connection isn’t encrypted. Use this at home, never on public Wi-Fi.</p>
      )}
      <p className="mt-2 text-[12px] text-chalk-faint">Anyone with this code or link can control your café, so keep it to yourself.</p>
      <button
        type="button"
        disabled={busy !== null}
        onClick={onStop}
        className="mt-4 rounded-lg border border-slate-line px-3 py-2 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk disabled:opacity-60"
      >
        {busy === 'stop' ? 'Closing…' : 'Close to phones'}
      </button>
    </>
  );
}

/** Whether a phone has got through yet, and what's in the way if not. */
function Progress({ sharing, slow, fixing, onFix }: { sharing: Shared; slow: boolean; fixing: boolean; onFix: () => void }) {
  if (sharing.reached) {
    return (
      <p role="status" className="mt-3 flex items-center gap-2 text-[13px] text-mint">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M2.5 7.5l3 3 6-7" /></svg>
        Your phone is connected.
      </p>
    );
  }
  if (sharing.firewall) {
    const { problem, fix } = firewallText(sharing.firewall);
    return (
      <div role="alert" className="mt-3 rounded-xl border border-coral/40 bg-coral/10 p-3 text-[13px]">
        <p className="text-chalk">{problem}</p>
        {sharing.firewall.fixable ? (
          <>
            <p className="mt-1 text-[12px] text-chalk-dim">{fix}</p>
            <button
              type="button"
              disabled={fixing}
              onClick={onFix}
              className="mt-2.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-night hover:bg-accent-dark hover:text-chalk disabled:opacity-60"
            >
              {fixing ? 'Waiting for Windows…' : 'Fix it'}
            </button>
          </>
        ) : (
          <p className="mt-1 text-[12px] text-chalk-dim">This computer’s network is managed by your organization, so ask your IT team to allow Agent Café.</p>
        )}
      </div>
    );
  }
  return (
    <div role="status" className="mt-3 text-[13px] text-chalk-dim">
      <p className="flex items-center gap-2">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-amber" />
        Waiting for your phone…
      </p>
      {slow && (
        <p className="mt-1.5 text-[12px] text-chalk-faint">
          {sharing.via === 'tailscale'
            ? 'Still loading on your phone? Check that Tailscale is on there, signed in to the same account.'
            : `Still loading on your phone? It has to be on the same network as this computer: in its Wi-Fi settings, its IP address should start with ${networkPrefix(sharing.link)}. If it doesn’t, join the Wi-Fi this computer uses (not a guest network, not a second router’s), and turn off mobile data.`}
        </p>
      )}
    </div>
  );
}
