'use client';

import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type PhoneStatus } from '@/lib/api';

const CHOICES = [
  { via: 'tailscale', title: 'Over Tailscale', hint: 'Works anywhere, encrypted. Needs Tailscale on this computer and your phone.' },
  { via: 'lan', title: 'On this Wi-Fi', hint: 'Your phone must be on the same network. Not encrypted, so only at home.' },
] as const;

/**
 * "Connect your phone": opens the café to phones (over Tailscale or the home Wi-Fi) and shows the
 * pairing link as a QR code. Only on this computer: the server refuses these calls from a phone.
 */
export function PhoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      setStatus(null);
      api.phone().then(setStatus, (err) => setError(err instanceof ApiError ? err.message : String(err)));
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

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
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label="Connect your phone"
      className="m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-slate-line bg-night-2 p-0 text-chalk shadow-[0_30px_80px_rgba(0,0,0,.6)] transition-[opacity,scale] duration-150 backdrop:bg-black/55 starting:scale-[.98] starting:opacity-0"
    >
      <div className="p-5">
        <h2 className="pr-10 font-display text-[26px] font-normal leading-none">Connect your phone</h2>

        {open && status && !status.available && (
          <p className="mt-4 text-[13px] text-chalk-dim">
            Phone access works when the café runs with <code className="text-chalk">pnpm start</code> or the{' '}
            <code className="text-chalk">agent-cafe</code> command.
          </p>
        )}

        {open && status?.available && !status.sharing && (
          <>
            <p className="mt-3 text-[13px] text-chalk-dim">Open the café to your phone, then scan the code it shows.</p>
            <div className="mt-4 flex flex-col gap-2">
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

        {open && status?.sharing && (
          <Sharing sharing={status.sharing} stopping={busy === 'stop'} onStop={() => run('stop', api.stopPhone)} />
        )}

        {open && !status && !error && <p className="mt-4 text-[13px] text-chalk-faint">Checking…</p>}
        {error && (
          <p role="alert" className="mt-4 text-[13px] text-coral">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-chalk-dim hover:bg-slate hover:text-chalk"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 3l8 8M11 3l-8 8" /></svg>
      </button>
    </dialog>
  );
}

function Sharing({ sharing, stopping, onStop }: { sharing: NonNullable<PhoneStatus['sharing']>; stopping: boolean; onStop: () => void }) {
  const [svg, setSvg] = useState('');
  const [copied, setCopied] = useState(false);

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
      <p className="mt-3 text-[13px] text-chalk-dim">Scan this with your phone’s camera.</p>
      {/* Our own SVG, made from the link just above. White behind it so any camera can read it. */}
      <div
        aria-label="QR code that pairs your phone"
        role="img"
        className="mx-auto mt-4 size-56 overflow-hidden rounded-xl bg-white [&>svg]:size-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="mt-4 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-code px-2.5 py-2 text-[12px] text-chalk-dim">{sharing.link}</code>
        <button type="button" onClick={copy} className="shrink-0 rounded-lg border border-slate-line px-3 py-2 text-[12px] text-chalk-dim hover:bg-slate hover:text-chalk">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {sharing.via === 'tailscale' ? (
        <p className="mt-3 text-[12px] text-chalk-faint">Over Tailscale: works wherever your phone has Tailscale on.</p>
      ) : (
        <p className="mt-3 text-[12px] text-amber">Your phone has to be on the same network, and the connection isn’t encrypted. Use this at home, never on public Wi-Fi.</p>
      )}
      <p className="mt-2 text-[12px] text-chalk-faint">Anyone with this code or link can control your café, so keep it to yourself.</p>
      <button
        type="button"
        disabled={stopping}
        onClick={onStop}
        className="mt-4 rounded-lg border border-slate-line px-3 py-2 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk disabled:opacity-60"
      >
        {stopping ? 'Closing…' : 'Close to phones'}
      </button>
    </>
  );
}
