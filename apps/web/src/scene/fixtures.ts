/** A fixed café for tests and snapshots: three agents a floor, three cats, everyone mid-task. */
import type { CatView } from '@/sim/cats';
import { FLOORS } from '@/sim/layout';
import type { SceneAgent } from './building';

const G = FLOORS.openai, U = FLOORS.anthropic;

export const crew: SceneAgent[] = [
  { id: 'mocha', name: 'Mocha', providerId: 'openai', ...G.seats[0]!, pose: 'type', t: 1, bubble: { kind: 'think' }, spriteSeed: 11, demo: true },
  { id: 'chai', name: 'Chai', providerId: 'openai', ...G.stations.bookcase[0]!, pose: 'work', t: 1, bubble: { kind: 'tool', tool: 'read_file' }, spriteSeed: 23, demo: true },
  { id: 'biscotti', name: 'Biscotti', providerId: 'openai', ...G.stations.register[0]!, pose: 'work', t: 1, bubble: { kind: 'fail' }, spriteSeed: 37, demo: false },
  { id: 'earl', name: 'Earl', providerId: 'anthropic', ...U.seats[0]!, pose: 'type', t: 1, bubble: { kind: 'think' }, spriteSeed: 41, demo: false },
  { id: 'matcha', name: 'Matcha', providerId: 'anthropic', ...U.seats[1]!, pose: 'sit', t: 1, bubble: { kind: 'done' }, spriteSeed: 53, demo: false },
  { id: 'scone', name: 'Scone', providerId: 'anthropic', ...U.stations.archive[0]!, pose: 'work', t: 1, bubble: { kind: 'zzz' }, spriteSeed: 67, demo: false },
];

export const cats: CatView[] = [
  { id: 'ink', floor: 'openai', fur: 0, ...G.catSpots[0]!, z: 7, face: 'y+', pose: 'sleep', t: 1 },
  { id: 'marmalade', floor: 'openai', fur: 1, x: 7.8, y: 7.2, z: 0, face: 'x+', pose: 'walk', t: 0.1 },
  { id: 'pebble', floor: 'anthropic', fur: 2, ...U.catSpots[0]!, z: 0, face: 'x+', pose: 'loaf', t: 1 },
];
