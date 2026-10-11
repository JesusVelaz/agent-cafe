'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { workingThreads, type ThreadSummary } from '@/store/reduce';
import { Popover } from './ui';

/** Threads this one delegated, and theirs in turn: they go with it when it's deleted. */
function delegatedCount(th: ThreadSummary): number {
  return th.children.reduce((n, c) => n + 1 + delegatedCount(c), 0);
}

/**
 * A thread's ⋮ menu: rename, pin, archive, delete. Changes go to the server, and
 * come back to every open café on the stream.
 */
export function ThreadMenu({ thread, onRename, className = '' }: { thread: ThreadSummary; onRename: () => void; className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, close: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const delegated = delegatedCount(thread);
  const working = workingThreads(thread) > 0;
  const item = 'flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] text-chalk hover:bg-slate-2 disabled:opacity-40';

  return (
    <Popover
      label={`Thread: ${thread.title}`}
      side="auto"
      align="end"
      className="w-[240px]"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-label="Thread options"
          title="Thread options"
          aria-expanded={open}
          onClick={() => {
            setConfirming(false);
            setError(null);
            toggle();
          }}
          className={`grid size-7 place-items-center rounded-lg text-chalk-dim hover:bg-slate-2 hover:text-chalk ${open ? 'bg-slate-2 text-chalk opacity-100' : ''} ${className}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            <circle cx="7" cy="3" r="1.3" />
            <circle cx="7" cy="7" r="1.3" />
            <circle cx="7" cy="11" r="1.3" />
          </svg>
        </button>
      )}
    >
      {(close) =>
        confirming ? (
          <div className="flex flex-col gap-2 p-3">
            <p className="text-[13px] font-medium text-chalk">Delete this thread?</p>
            <p className="text-[12px] leading-snug text-chalk-dim">
              {thread.messages} {thread.messages === 1 ? 'message' : 'messages'}
              {delegated > 0 && <> and {delegated} delegated {delegated === 1 ? 'thread' : 'threads'}</>} will be removed from Agents Café.
              {working && <> This will stop the running work.</>} This can’t be undone.
            </p>
            {error && <p role="alert" className="text-[12px] text-coral">{error}</p>}
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setConfirming(false)} className="h-7 rounded-full px-3 text-[12px] text-chalk-dim hover:bg-slate-2 hover:text-chalk">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => api.deleteThread(thread.id), close)}
                className="h-7 rounded-full bg-coral px-3 text-[12px] font-medium text-night hover:brightness-110 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col p-1.5">
            <button type="button" className={item} onClick={() => (close(), onRename())}>
              Rename
            </button>
            <button type="button" className={item} disabled={busy} onClick={() => run(() => api.updateThread(thread.id, { pinned: !thread.pinned }), close)}>
              {thread.pinned ? 'Unpin' : 'Pin to top'}
            </button>
            <button type="button" className={item} disabled={busy} onClick={() => run(() => api.updateThread(thread.id, { archived: !thread.archived }), close)}>
              {thread.archived ? 'Unarchive' : 'Archive'}
            </button>
            <span aria-hidden className="mx-2 my-1 h-px bg-slate-line" />
            <button type="button" className={`${item} text-coral`} onClick={() => setConfirming(true)}>
              Delete
            </button>
            {error && <p role="alert" className="px-2.5 pb-1 pt-1.5 text-[12px] text-coral">{error}</p>}
          </div>
        )
      }
    </Popover>
  );
}

/** Rename in place: Enter or leaving the field saves, Escape cancels, an empty name resets. */
export function ThreadTitleEditor({ thread, onDone, className = '' }: { thread: ThreadSummary; onDone: () => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(thread.title);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const save = async () => {
    if (settled.current) return;
    settled.current = true;
    if (value.trim() === thread.title) return onDone();
    try {
      await api.updateThread(thread.id, { title: value });
      onDone();
    } catch (err) {
      settled.current = false;
      setError((err as Error).message);
    }
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <input
        ref={ref}
        value={value}
        maxLength={200}
        aria-label="Thread name"
        placeholder="Name this thread"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            settled.current = true;
            onDone();
          }
        }}
        className="h-7 w-full rounded-md border border-slate-line bg-night px-2 text-[13px] text-chalk outline-none focus:border-chalk-faint"
      />
      {error && <p role="alert" className="mt-1 text-[12px] text-coral">{error}</p>}
    </div>
  );
}

/**
 * A thread row with its ⋮ menu at the row's right edge, vertically centred, shown on hover or
 * focus in place of the row's time (rows hide it with `group-hover:invisible`).
 * On touch screens, the open thread's top bar has the same menu. Renaming swaps
 * the row for the name field.
 */
export function ThreadRowActions({ thread, children }: { thread: ThreadSummary; children: ReactNode }) {
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <div className="px-2 py-1.5">
        <ThreadTitleEditor thread={thread} onDone={() => setRenaming(false)} />
      </div>
    );
  }
  return (
    <div className="group relative">
      {children}
      {/* Centred with flex, not a transform: a transformed ancestor would misplace the fixed menu. */}
      <div className="invisible absolute inset-y-0 right-1.5 flex items-center group-focus-within:visible group-hover:visible has-[[aria-expanded=true]]:visible">
        <ThreadMenu thread={thread} onRename={() => setRenaming(true)} className="bg-slate" />
      </div>
    </div>
  );
}

export function PinMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-label="Pinned" className="shrink-0 text-chalk-faint">
      <path d="M4.5 1.5h3M5 1.5v3.2L3 6.8h6L7 4.7V1.5M6 6.8v3.7" />
    </svg>
  );
}
