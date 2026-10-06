'use client';

import { useEffect, useRef, useState } from 'react';
import { CUP_FILL_ROWS } from '@/lib/cup';
import { approach, fillGoal, MARKS } from '@/lib/loader';
import type { ConnectionState } from '@/lib/stream';
import { CupIcon } from './CupIcon';

/** A fast load still shows the cup this long (from navigation start), so it doesn't flash. */
const MIN_MS = 600;
/** With no café state after this long, say the server isn't answering (it keeps listening). */
const CLOSED_AFTER_MS = 6000;
const SIZE = 64;
const TICK_MS = 33;

interface Props {
  /** The panel's remembered fold has been applied. */
  settled: boolean;
  /** The café's state has arrived from the server. */
  hydrated: boolean;
  /** The scene has drawn its first frame at its real size. */
  sceneReady: boolean;
  connection: ConnectionState;
  onDone: () => void;
}

/**
 * The first-load cover: an empty cup that fills as the café gets ready. It's in the
 * server render, so it's on screen before any script runs. Once all three steps have
 * landed, the cup wakes up (face, steam) and flies into the top bar's logo while the
 * cover clears; under reduced motion it just fades. It never comes back after that.
 */
export function CafeLoader({ settled, hydrated, sceneReady, connection, onDone }: Props) {
  const done = Number(settled) + Number(hydrated) + Number(sceneReady);
  const [rows, setRows] = useState(Math.round(MARKS[0] * CUP_FILL_ROWS));
  const [phase, setPhase] = useState<'filling' | 'awake' | 'leaving'>('filling');
  const [stalled, setStalled] = useState(false);
  const closed = !hydrated && (connection === 'down' || stalled);

  const coverRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<HTMLDivElement>(null);
  const cupRef = useRef<HTMLDivElement>(null);
  const live = useRef({ done, at: 0, onDone });
  useEffect(() => {
    live.current.done = done;
    live.current.at = performance.now();
  }, [done]);
  useEffect(() => {
    live.current.onDone = onDone;
  }, [onDone]);

  useEffect(() => {
    if (hydrated) return;
    const t = setTimeout(() => setStalled(true), CLOSED_AFTER_MS);
    return () => clearTimeout(t);
  }, [hydrated]);

  // Fill toward the current goal; React only hears about whole rows. A timer, not
  // requestAnimationFrame, so a page opened in a background tab is ready when you look.
  useEffect(() => {
    let p: number = MARKS[0];
    let last = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = performance.now();
      const { done, at } = live.current;
      p = approach(p, fillGoal(done, now - at), now - last);
      last = now;
      setRows(Math.round(p * CUP_FILL_ROWS));
      if (done === 3 && p >= 0.999 && now >= MIN_MS) return setPhase('awake');
      timer = setTimeout(tick, TICK_MS);
    };
    timer = setTimeout(tick, TICK_MS);
    return () => clearTimeout(timer);
  }, []);

  // Full: wake up, then leave into the logo.
  useEffect(() => {
    if (phase !== 'awake') return;
    const t = setTimeout(() => setPhase('leaving'), 450);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'leaving') return;
    const cover = coverRef.current;
    const ground = groundRef.current;
    const cup = cupRef.current;
    const logo = document.querySelector('[data-cafe-logo]');
    const finish = () => live.current.onDone();
    if (!cover || !ground || !cup) return finish();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !logo) {
      cover.animate({ opacity: [1, 0] }, { duration: 160, fill: 'forwards' }).finished.then(finish, finish);
      return;
    }
    const a = cup.getBoundingClientRect();
    const b = logo.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const scale = b.width / a.width;
    ground.animate({ opacity: [1, 0] }, { duration: 450, easing: 'ease', fill: 'forwards' });
    cup
      .animate({ transform: ['none', `translate(${dx}px, ${dy}px) scale(${scale})`] }, { duration: 520, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' })
      .finished.then(finish, finish);
  }, [phase]);

  const awake = phase !== 'filling';
  return (
    <div
      ref={coverRef}
      role="status"
      aria-label={closed ? 'The café is closed' : 'Opening the café'}
      className="fixed inset-0 z-50 grid place-content-center justify-items-center gap-5 p-6"
    >
      <div ref={groundRef} className="absolute inset-0 -z-10 bg-night" />
      <div ref={cupRef} className={awake ? 'cup-wake' : undefined} style={{ width: SIZE, height: SIZE }}>
        {closed ? <CupIcon size={SIZE} mood="quiet" /> : awake ? <CupIcon size={SIZE} mood="working" /> : <CupIcon size={SIZE} fill={rows / CUP_FILL_ROWS} />}
      </div>
      {closed && (
        <div className="max-w-sm text-center">
          <p className="font-display text-3xl leading-none">The café is closed</p>
          <p className="mt-2 text-xs text-chalk-dim">
            The server isn’t answering on 127.0.0.1:4318. Start everything with <code className="font-mono text-accent">pnpm dev</code> from the repo root.
            This page reconnects by itself.
          </p>
        </div>
      )}
    </div>
  );
}
