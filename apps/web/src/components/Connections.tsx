'use client';

import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type PhoneStatus } from '@/lib/api';
import { networkPrefix } from '@/lib/phone';
import { Toggle } from './ui';

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

  const sharing = onThisComputer ? status?.sharing : null;
  const [via, setVia] = useState<Via>('lan');
  useEffect(() => {
    if (sharing) setVia(sharing.via === 'tailscale' ? 'tailscale' : 'lan');
  }, [sharing]);
  const available = onThisComputer && !!status?.available;

  return (
    <>
      <div className="mb-5 sm:pr-10">
        <h3 className="text-[18px] font-semibold">Connections</h3>
        <p className="mt-1 text-[13px] text-chalk-dim">Use the café from your phone. It keeps running on this computer; your phone becomes another screen for it.</p>
      </div>
      <div className="divide-y divide-slate-line rounded-2xl border border-slate-line bg-slate/40">
        <Row title="Phone access" hint={accessHint(onThisComputer, status, sharing)}>
          {onThisComputer && (
            <Toggle
              label="Phone access"
              checked={!!sharing}
              disabled={!available || busy !== null}
              onChange={(on) => run(on ? 'start' : 'stop', on ? () => api.sharePhone(via) : api.stopPhone)}
            />
          )}
        </Row>
        {available && (
          <Row title="Connect over" hint={CHOICES[via]}>
            <select
              aria-label="Connect over"
              value={via}
              disabled={busy !== null}
              onChange={(e) => {
                const next = e.target.value as Via;
                setVia(next);
                if (sharing) void run('start', () => api.sharePhone(next));
              }}
              className="h-9 w-44 rounded-lg border border-slate-line bg-night-2 px-3 text-[13px] text-chalk outline-none hover:border-chalk-faint focus:border-accent disabled:opacity-60"
            >
              <option value="lan">Home network</option>
              <option value="tailscale">Tailscale</option>
            </select>
          </Row>
        )}
        {sharing && <Sharing sharing={sharing} busy={busy} onFix={() => run('fix', api.fixPhone)} />}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-coral">
          {error}
        </p>
      )}
    </>
  );
}

type Via = 'lan' | 'tailscale';
type Shared = NonNullable<PhoneStatus['sharing']>;

const CHOICES: Record<Via, string> = {
  lan: 'Your phone must be on the same Wi-Fi or router as this computer. Not encrypted, so only use it at home.',
  tailscale: 'Works anywhere, encrypted. Needs Tailscale on this computer and your phone.',
};

function accessHint(onThisComputer: boolean, status: PhoneStatus | null, sharing: Shared | null | undefined) {
  if (!onThisComputer) return 'You’re on a paired device. Phone access is set up on the computer running the café.';
  if (!status) return 'Checking…';
  if (!status.available) return 'Works when the café runs with pnpm start or the agent-cafe command.';
  if (!sharing) return 'Limited to this computer.';
  return sharing.via === 'tailscale' ? 'Open to your phone over Tailscale.' : 'Open to phones on your home network.';
}

/** A settings row: what it is on the left, its control on the right. */
function Row({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-[14px] font-medium">{title}</p>
        {hint && <div className="mt-0.5 text-[12px] text-chalk-faint">{hint}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

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

function Sharing({ sharing, busy, onFix }: { sharing: Shared; busy: string | null; onFix: () => void }) {
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
      <Status sharing={sharing} slow={slow} fixing={busy === 'fix'} onFix={onFix} />
      <Row
        title="Pair your phone"
        hint={
          <>
            <p>Scan this with your phone’s camera, or open the link on it.</p>
            <p className="mt-1">Anyone with this code or link can control your café, so keep it to yourself.</p>
            <div className="mt-3 flex max-w-[360px] items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-code px-2.5 py-2 text-[12px] text-chalk-dim">{sharing.link}</code>
              <button type="button" onClick={copy} className="shrink-0 rounded-lg border border-slate-line px-3 py-2 text-[12px] text-chalk-dim hover:bg-slate hover:text-chalk">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </>
        }
      >
        {/* Our own SVG, made from the link. White behind it so any camera can read it. */}
        <div
          aria-label="QR code that pairs your phone"
          role="img"
          className="size-40 overflow-hidden rounded-xl bg-white [&>svg]:size-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </Row>
    </>
  );
}

/** Whether a phone has got through yet, and what's in the way if not. */
function Status({ sharing, slow, fixing, onFix }: { sharing: Shared; slow: boolean; fixing: boolean; onFix: () => void }) {
  if (sharing.reached) {
    return (
      <Row title="Status" hint="Your phone reached the café.">
        <span role="status" className="flex items-center gap-2 text-[13px] text-mint">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M2.5 7.5l3 3 6-7" /></svg>
          Connected
        </span>
      </Row>
    );
  }
  if (sharing.firewall) {
    const { problem, fix } = firewallText(sharing.firewall);
    return (
      <Row
        title="Windows Firewall"
        hint={
          <div role="alert">
            <p className="text-coral">{problem}</p>
            <p className="mt-1">{sharing.firewall.fixable ? fix : 'This computer’s network is managed by your organization, so ask your IT team to allow Agent Café.'}</p>
          </div>
        }
      >
        {sharing.firewall.fixable && (
          <button
            type="button"
            disabled={fixing}
            onClick={onFix}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-night hover:bg-accent-dark hover:text-chalk disabled:opacity-60"
          >
            {fixing ? 'Waiting for Windows…' : 'Fix it'}
          </button>
        )}
      </Row>
    );
  }
  return (
    <Row
      title="Status"
      hint={
        slow
          ? sharing.via === 'tailscale'
            ? 'Still loading on your phone? Check that Tailscale is on there, signed in to the same account.'
            : `Still loading on your phone? It has to be on the same network as this computer: in its Wi-Fi settings, its IP address should start with ${networkPrefix(sharing.link)}. If it doesn’t, join the Wi-Fi this computer uses (not a guest network, not a second router’s), and turn off mobile data.`
          : 'Scan the code below with your phone.'
      }
    >
      <span role="status" className="flex items-center gap-2 text-[13px] text-chalk-dim">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-amber" />
        Waiting for your phone
      </span>
    </Row>
  );
}
