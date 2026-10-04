import type { HarnessCommandDTO } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { filterHarnessCommands, slashCommandQuery } from './commands';

const commands: HarnessCommandDTO[] = [
  { name: 'skills', invocation: '/skills', description: 'List commands', argumentHint: '', kind: 'catalog' },
  { name: 'openai-docs', invocation: '$openai-docs', description: 'Read current documentation', argumentHint: '', kind: 'skill' },
  { name: 'review', invocation: '/review', description: 'Run a skillful review', argumentHint: '', kind: 'command' },
  { name: 'find-skills', invocation: '/find-skills', description: 'Find additions', argumentHint: '', aliases: ['anthropic-skills:find-skills'], kind: 'skill' },
];

describe('slash command composer helpers', () => {
  it('opens only while the first slash command token is being typed', () => {
    expect(slashCommandQuery('/')).toBe('');
    expect(slashCommandQuery('/SKI')).toBe('ski');
    expect(slashCommandQuery('/skills now')).toBeNull();
    expect(slashCommandQuery('explain /skills')).toBeNull();
  });

  it('prefers names, invocations and aliases before falling back to descriptions', () => {
    expect(filterHarnessCommands(commands, 'skills')).toEqual([commands[0]]);
    expect(filterHarnessCommands(commands, 'doc')).toEqual([commands[1]]);
    expect(filterHarnessCommands(commands, 'sk')).toEqual([commands[0]]);
    expect(filterHarnessCommands(commands, 'skillful')).toEqual([commands[2]]);
    expect(filterHarnessCommands(commands, '')).toEqual(commands);
  });
});
