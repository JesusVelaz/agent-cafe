import { describe, expect, it } from 'vitest';
import { networkPrefix } from './phone';

describe('networkPrefix', () => {
  it("gives the start of a phone's address on the same home network", () => {
    expect(networkPrefix('http://192.168.68.51:4318/?token=abc')).toBe('192.168.68.');
    expect(networkPrefix('http://10.0.0.5:4318/?token=abc')).toBe('10.0.0.');
  });
});
