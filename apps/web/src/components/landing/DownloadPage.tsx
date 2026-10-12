'use client';

import Link from 'next/link';
import { type ReactNode, useRef, useState } from 'react';
import type { Os } from '../DownloadButton';
import { RELEASE, UNIX_INSTALL, WINDOWS_INSTALLER } from '../InstallDialog';
import s from './landing.module.css';
import { Footer, Nav, REPO, useOs } from './SiteChrome';

/** A command with a Copy button; if the clipboard refuses, the command is selected instead. */
function CopyCommand({ label, command }: { label: string; command: string }) {
  const code = useRef<HTMLElement>(null);
  const [done, setDone] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setDone('Copied');
    } catch {
      const range = document.createRange();
      if (code.current) range.selectNodeContents(code.current);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      setDone('Selected');
    }
    setTimeout(() => setDone(null), 1600);
  };
  return (
    <div className={s.copy}>
      <span>{label}</span>
      <code ref={code}>{command}</code>
      <button type="button" onClick={copy}>
        {done ?? 'Copy'}
      </button>
    </div>
  );
}

function Row({ href, name, note, ext }: { href: string; name: string; note: string; ext: string }) {
  return (
    <a className={s.row} href={href}>
      <span>
        <b>{name}</b>
        <small>{note}</small>
      </span>
      <span className={s.ext}>{ext}</span>
      <span className={s.get}>Download</span>
    </a>
  );
}

const PLATFORMS: Array<{ os: Os; id: string; title: string; body: ReactNode }> = [
  {
    os: 'mac',
    id: 'macos',
    title: 'macOS',
    body: (
      <>
        <div className={s.rows}>
          <CopyCommand label="Easiest: paste this in Terminal, then open Agents Café from Applications" command={UNIX_INSTALL} />
          <Row href={`${RELEASE}/agent-cafe-macos-arm64.tar.gz`} name="Apple silicon" note="M1 and newer" ext=".tar.gz" />
        </div>
        <p className={s.aside}>
          On an Intel Mac? <a href={`${RELEASE}/agent-cafe-macos-x64.tar.gz`}>Download the x64 build</a>. The install command
          picks the right one for you.
        </p>
      </>
    ),
  },
  {
    os: 'windows',
    id: 'windows',
    title: 'Windows',
    body: (
      <>
        <div className={s.rows}>
          <Row href={WINDOWS_INSTALLER} name="Windows 10, 11" note="Installer, adds Agents Café to the Start menu" ext=".exe" />
        </div>
        <p className={s.aside}>
          The installer isn&apos;t code-signed yet, so Windows may say it protected your PC. Choose More info, then Run
          anyway. It can also let phones on your home Wi-Fi through the firewall, on private networks only.
        </p>
      </>
    ),
  },
  {
    os: 'linux',
    id: 'linux',
    title: 'Linux',
    body: (
      <>
        <div className={s.rows}>
          <CopyCommand label="Easiest: installs the app and adds it to your app menu" command={UNIX_INSTALL} />
          <Row href={`${RELEASE}/agent-cafe-linux-x64.tar.gz`} name="x86_64" note="Most PCs and laptops" ext=".tar.gz" />
        </div>
        <p className={s.aside}>
          On ARM? <a href={`${RELEASE}/agent-cafe-linux-arm64.tar.gz`}>Download the arm64 build</a>.
        </p>
      </>
    ),
  },
];

/** agentscafe.dev/download: every build, with the visitor's own platform first. */
export function DownloadPage() {
  const os = useOs();
  const platforms = [...PLATFORMS].sort((a, b) => Number(b.os === os) - Number(a.os === os));
  return (
    <div className={s.page}>
      <Nav current="download" />
      <main className={`${s.wrap} ${s.narrow}`}>
        <header className={s.pageHead}>
          <h1>Download Agents Café</h1>
          <p>
            Everything it needs ships inside the download: no Node or pnpm to install. Your café&apos;s data stays in
            ~/.agent-cafe, and installing again updates it. Every build is also on the{' '}
            <a href={`${REPO}/releases/latest`}>GitHub releases page</a>.
          </p>
        </header>

        {platforms.map((p) => (
          <section key={p.id} id={p.id} className={s.os}>
            <h2>
              {p.title}
              {p.os === os && <span className={s.yours}>Your computer</span>}
            </h2>
            {p.body}
          </section>
        ))}

        <section id="phone" className={s.os}>
          <h2>On your phone</h2>
          <div className={s.rows}>
            <p className={s.phone}>
              <svg width="40" height="56" viewBox="0 0 10 14" shapeRendering="crispEdges" aria-hidden>
                <path fill="var(--color-chalk-dim)" d="M1 0h8v1h1v12H9v1H1v-1H0V1h1z" />
                <path fill="var(--color-night-2)" d="M1 2h8v9H1z" />
                <path fill="var(--color-crema)" d="M3 5h4v3H3zM7 6h1v1H7z" />
                <path fill="var(--color-night-2)" d="M4 12h2v1H4z" />
              </svg>
              <span>
                <b>No app store needed.</b> The café keeps running on your computer and your phone becomes another screen
                for it. Turn on Network access in Settings, then scan the QR code it shows. It works anywhere with
                Tailscale, or on your home Wi-Fi.
              </span>
            </p>
          </div>
        </section>

        <section id="source" className={s.os}>
          <h2>From source</h2>
          <div className={s.rows}>
            <CopyCommand label="With Node 22+ and pnpm 10+" command={`git clone ${REPO} && cd agent-cafe && pnpm install && pnpm dev`} />
          </div>
        </section>
      </main>
      <div style={{ height: 96 }} />
      <Footer>
        <a href={REPO}>GitHub</a>
        <Link href="/">Home</Link>
      </Footer>
    </div>
  );
}
