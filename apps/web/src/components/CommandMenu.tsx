import { HARNESS, type HarnessCommandDTO, type ProviderId } from '@agent-cafe/shared';

export function CommandMenu({
  id,
  provider,
  commands,
  active,
  loading,
  error,
  onActive,
  onPick,
}: {
  id: string;
  provider: ProviderId;
  commands: HarnessCommandDTO[];
  active: number;
  loading: boolean;
  error: string | null;
  onActive: (index: number) => void;
  onPick: (command: HarnessCommandDTO) => void;
}) {
  return (
    <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl border border-slate-line bg-night-2 shadow-[0_18px_44px_rgba(0,0,0,.45)]">
      <div id={id} role="listbox" aria-label={`${HARNESS[provider].name} commands`} className="scroll-chalk flex max-h-72 flex-col overflow-y-auto p-1.5">
        {commands.map((command, index) => (
          <button
            id={`${id}-${index}`}
            key={`${command.kind}:${command.invocation}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => onActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(command)}
            className={`grid grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-lg px-2 py-1.5 text-left ${index === active ? 'bg-slate-2' : 'hover:bg-slate-2'}`}
          >
            <span aria-hidden className={`grid size-7 place-items-center rounded-md bg-slate font-mono text-[13px] font-semibold ${command.kind === 'skill' ? 'text-mint' : 'text-accent'}`}>
              {command.invocation[0]}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-[13px] font-medium text-chalk">
                {command.invocation}{command.argumentHint ? ` ${command.argumentHint}` : ''}
              </span>
              <span className="block truncate text-[11px] text-chalk-dim">
                {command.description || (command.kind === 'skill' ? 'Harness skill' : 'Harness command')}
                {command.kind === 'skill' ? ' · skill' : ''}
              </span>
            </span>
          </button>
        ))}
        {!commands.length && (
          <p role="status" className={`px-2.5 py-3 text-[12px] ${error ? 'text-coral' : 'text-chalk-dim'}`}>
            {loading ? `Loading ${HARNESS[provider].name} commands…` : error ?? 'No commands match.'}
          </p>
        )}
      </div>
    </div>
  );
}
