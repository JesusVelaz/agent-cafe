import type { HarnessCommandDTO } from '@agent-cafe/shared';

/** The command fragment after a leading slash, while the first token is still being typed. */
export function slashCommandQuery(prompt: string): string | null {
  const match = prompt.match(/^\/([^\s]*)$/);
  return match ? match[1]!.toLowerCase() : null;
}

export function filterHarnessCommands(commands: HarnessCommandDTO[], query: string): HarnessCommandDTO[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  const primary = (command: HarnessCommandDTO) => [command.name, command.invocation.replace(/^[/$]/, '')].map((value) => value.toLowerCase());
  const starting = commands.filter((command) => primary(command).some((value) => value.startsWith(needle)));
  if (starting.length) return starting;
  const named = commands.filter((command) => primary(command).some((value) => value.includes(needle)));
  if (named.length) return named;
  const aliased = commands.filter((command) => command.aliases?.some((value) => value.toLowerCase().includes(needle)));
  if (aliased.length) return aliased;
  return commands.filter((command) => command.description.toLowerCase().includes(needle));
}
