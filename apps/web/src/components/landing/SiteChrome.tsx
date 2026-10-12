'use client';

import type { ProviderId } from '@agent-cafe/shared';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { Avatar } from '../Avatar';
import { CupIcon } from '../CupIcon';
import { detectOs, type Os } from '../DownloadButton';
import { WINDOWS_INSTALLER } from '../InstallDialog';
import s from './landing.module.css';

export const REPO = 'https://github.com/JesusVelaz/agent-cafe';

/** The demo's six agents, by floor, with the sprite seeds the demo café uses. */
export const UPSTAIRS: Array<{ name: string; seed: number; providerId: ProviderId }> = [
  { name: 'Earl', seed: 41, providerId: 'anthropic' },
  { name: 'Matcha', seed: 53, providerId: 'anthropic' },
  { name: 'Scone', seed: 67, providerId: 'anthropic' },
];
export const DOWNSTAIRS: Array<{ name: string; seed: number; providerId: ProviderId }> = [
  { name: 'Mocha', seed: 11, providerId: 'openai' },
  { name: 'Chai', seed: 23, providerId: 'openai' },
  { name: 'Biscotti', seed: 37, providerId: 'openai' },
];

export function Faces({ agents, scale = 2 }: { agents: typeof UPSTAIRS; scale?: number }) {
  return (
    <span className={s.faces}>
      {agents.map((a) => (
        <Avatar key={a.name} seed={a.seed} providerId={a.providerId} scale={scale} />
      ))}
    </span>
  );
}

export function Nav({ current }: { current?: 'download' }) {
  return (
    <nav className={s.nav} aria-label="Site">
      <div className={s.wrap}>
        <Link className={s.logo} href="/">
          <CupIcon size={24} />
          <span>
            Agents <b>Café</b>
          </span>
        </Link>
        <div className={s.links}>
          <a className={s.hideSmall} href={REPO}>
            GitHub
          </a>
          {current === 'download' ? (
            <Link href="/download" aria-current="page">
              Download
            </Link>
          ) : (
            <Link className={`${s.btn} ${s.light} ${s.small}`} href="/download">
              Download
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className={s.foot}>
      <div className={s.wrap}>
        <span className={s.logo}>
          Agents <b>Café</b>
        </span>
        <span>Local-first. Your subscriptions, your computer.</span>
        <nav>{children}</nav>
      </div>
    </footer>
  );
}

/** The visitor's platform, known only after mount: the page is static. */
export function useOs(): Os | null | undefined {
  const [os, setOs] = useState<Os | null | undefined>(undefined);
  useEffect(() => setOs(detectOs()), []);
  return os;
}

/**
 * The main call to action, for the visitor's own system: Windows gets the installer,
 * macOS and Linux the download page at their section (they install from a terminal).
 */
export function DownloadCta({ className }: { className?: string }) {
  const os = useOs();
  if (os === 'windows') {
    return (
      <a className={className} href={WINDOWS_INSTALLER}>
        Download for Windows
      </a>
    );
  }
  const label = os === 'mac' ? 'Download for macOS' : os === 'linux' ? 'Install on Linux' : 'Download';
  return (
    <Link className={className} href={os ? `/download#${os === 'mac' ? 'macos' : 'linux'}` : '/download'}>
      {label}
    </Link>
  );
}

/** "Windows · Linux · other": the platforms the main button doesn't cover. */
export function OtherPlatforms({ className }: { className?: string }) {
  const os = useOs();
  const label =
    os === 'windows' ? 'macOS · Linux · other' : os === 'linux' ? 'Windows · macOS · other' : os === 'mac' ? 'Windows · Linux · other' : 'All downloads';
  return (
    <Link className={className} href="/download">
      {label}
    </Link>
  );
}

/** A green pixel tick, for lists. */
export function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      <path fill="currentColor" d="M6 1h1v1h1v1H7v1H6v1H5v1H4v1H3V6H2V5H1V4h1v1h1v1h1V5h1V4h1V3h1V2H6z" />
    </svg>
  );
}
