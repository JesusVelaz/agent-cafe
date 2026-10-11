'use client';

import { useEffect, useRef, useState } from 'react';
import { CupIcon } from './CupIcon';

const RELEASE = 'https://github.com/JesusVelaz/agent-cafe/releases/latest/download';
/** The Windows installer: a direct download. */
export const WINDOWS_INSTALLER = `${RELEASE}/AgentCafeSetup.exe`;
const UNIX_INSTALL = `curl -fsSL ${RELEASE}/install.sh | sh`;

type Os = 'windows' | 'unix';

/** The demo site's "how do I get this?": install steps, opened on the tab for `os`. */
export function InstallDialog({ open, os: initial, onClose }: { open: boolean; os: Os; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [os, setOs] = useState<Os>(initial);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setOs(initial);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, initial]);

  const copy = () => {
    void navigator.clipboard?.writeText(UNIX_INSTALL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const tab = (id: Os, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={os === id}
      onClick={() => setOs(id)}
      className={`rounded-md px-3 py-1.5 text-[13px] ${os === id ? 'bg-slate-2 text-chalk' : 'text-chalk-dim hover:text-chalk'}`}
    >
      {label}
    </button>
  );

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // click on the backdrop
      }}
      aria-labelledby="install-title"
      className="m-auto w-[min(460px,calc(100vw-2rem))] rounded-2xl border border-slate-line bg-night-2 p-6 text-chalk shadow-[0_30px_80px_rgba(0,0,0,.55)] transition-[opacity,scale] duration-200 backdrop:bg-black/50 backdrop:backdrop-blur-[2px] starting:scale-95 starting:opacity-0"
    >
      <CupIcon size={36} mood="quiet" />
      <h2 id="install-title" className="mt-3 font-display text-[30px] font-normal leading-none">Get Agent Café</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-chalk-dim">
        This is a demo: the agents run scripted tasks. Install the café on your computer to run real Claude Code and Codex
        agents with your own subscription. No API keys needed.
      </p>

      <div role="tablist" aria-label="Your computer" className="mt-4 flex gap-1 rounded-lg border border-slate-line bg-slate p-1">
        {tab('windows', 'Windows')}
        {tab('unix', 'macOS and Linux')}
      </div>

      {os === 'windows' ? (
        <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed text-chalk-dim">
          <li>
            <a href={WINDOWS_INSTALLER} className="font-medium text-accent underline decoration-dotted hover:text-chalk">
              Download AgentCafeSetup.exe
            </a>{' '}
            and run it.
          </li>
          <li>
            Windows may say it “protected your PC” (the app isn’t code-signed yet): click <b className="text-chalk">More info → Run anyway</b>.
          </li>
          <li>Open <b className="text-chalk">Agent Café</b> from the Start menu.</li>
        </ol>
      ) : (
        <div className="mt-4 flex flex-col gap-2 text-[13px] leading-relaxed text-chalk-dim">
          <p>Run this in a terminal:</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-line bg-night px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-chalk">{UNIX_INSTALL}</code>
            <button type="button" onClick={copy} className="shrink-0 rounded-md border border-slate-line px-2 py-1 text-[12px] text-chalk-dim hover:bg-slate hover:text-chalk">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p>
            Then open <b className="text-chalk">Agent Café</b> from Applications or your app menu, or run <code className="font-mono text-[12px] text-chalk">agent-cafe</code>.
          </p>
        </div>
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-chalk-faint">
        The café opens in your browser. To go live, install Claude Code or Codex, then connect your account in Settings → Providers.
        Run the installer again to update.
      </p>
      <div className="mt-5 flex justify-end">
        <button type="button" autoFocus onClick={onClose} className="h-9 rounded-lg border border-slate-line px-3.5 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk">
          Back to the demo
        </button>
      </div>
    </dialog>
  );
}
