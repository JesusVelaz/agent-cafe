'use client';

import { useEffect, useState } from 'react';
import { InstallDialog, WINDOWS_INSTALLER } from './InstallDialog';

type Os = 'windows' | 'mac' | 'linux';

const NAMES: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

/** The visitor's desktop system, or null on a phone or anything unrecognised. */
function detectOs(): Os | null {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return null;
}

function OsIcon({ os }: { os: Os }) {
  if (os === 'windows') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M0 2.2 6.5 1.3v6.2H0zM7.3 1.2 16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.7zM7.3 8.3H16V16l-8.7-1.2z" />
      </svg>
    );
  }
  if (os === 'mac') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M11.2 8.5c0-1.5 1.2-2.2 1.3-2.3-.7-1-1.8-1.2-2.2-1.2-.9-.1-1.8.5-2.3.5s-1.2-.5-2-.5C4.9 5 3.8 5.6 3.2 6.6c-1.3 2.2-.3 5.5.9 7.3.6.9 1.3 1.8 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.6 1.5-.9 2.1-1.8c.7-1 .9-1.9 1-2-.1 0-1.8-.7-1.8-2.9ZM9.7 3.9c.5-.6.8-1.4.7-2.2-.7 0-1.5.5-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.5-.4 2-.9Z" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="m4.5 6.5 2 1.8-2 1.8M8.5 10.5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const BUTTON =
  'flex h-9 items-center gap-2 rounded-lg bg-[#f4f5f7] px-3 sm:px-3.5 text-[13px] font-semibold whitespace-nowrap text-[#15171b] shadow-[0_6px_18px_rgba(0,0,0,.35)] hover:bg-white';

/**
 * The demo site's call to action: "Download for Windows" (or macOS, Linux) for the
 * visitor's own system. Windows gets the installer straight away; macOS and Linux
 * install from a terminal, so they get the steps. Phones get the steps for both.
 */
export function DownloadButton() {
  // Decided after mount: the static page can't know the visitor's system.
  const [os, setOs] = useState<Os | null>(null);
  useEffect(() => setOs(detectOs()), []);
  const [steps, setSteps] = useState<'windows' | 'unix' | null>(null);

  const label = (
    <>
      {os && <OsIcon os={os} />}
      <span>
        Download{os && <span className="hidden sm:inline"> for {NAMES[os]}</span>}
      </span>
    </>
  );
  return (
    <>
      {os === 'windows' ? (
        <a href={WINDOWS_INSTALLER} className={BUTTON}>
          {label}
        </a>
      ) : (
        <button type="button" onClick={() => setSteps(os === null ? 'windows' : 'unix')} className={BUTTON}>
          {label}
        </button>
      )}
      <InstallDialog open={steps !== null} os={steps ?? 'windows'} onClose={() => setSteps(null)} />
    </>
  );
}
