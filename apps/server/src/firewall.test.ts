import { describe, expect, it } from 'vitest';
import { checkFirewall, checkScript, fixScript, psString, readCheck } from './firewall.js';

const out = (r: object) => JSON.stringify({ network: 'Private', enabled: true, block: 0, allow: 1, ...r });

describe('readCheck', () => {
  it('sees nothing in the way when Node is allowed, or the firewall is off', () => {
    expect(readCheck(out({}))).toBeNull();
    expect(readCheck(out({ enabled: false, allow: 0 }))).toBeNull();
  });

  it('finds a rule blocking Node (Cancel on the first prompt)', () => {
    expect(readCheck(out({ block: 1 }))).toEqual({ kind: 'blocked', network: 'Private', fixable: true });
  });

  it('finds no way in on a Public network (Allow only covered Private ones)', () => {
    expect(readCheck(out({ network: 'Public', allow: 0 }))).toEqual({ kind: 'not-allowed', network: 'Public', fixable: true });
  });

  it("leaves work-managed networks to IT", () => {
    expect(readCheck(out({ network: 'DomainAuthenticated', allow: 0 }))?.fixable).toBe(false);
  });
});

describe('scripts', () => {
  it('quotes paths for PowerShell', () => {
    expect(psString("C:\\Users\\O'Neil\\node.exe")).toBe("'C:\\Users\\O''Neil\\node.exe'");
    expect(checkScript('192.168.1.5', 4318, "C:\\O'Neil\\node.exe")).toContain("$node = 'C:\\O''Neil\\node.exe'");
  });

  it('only opens the café port, to the local network, on Private networks, behind an admin prompt', () => {
    const outer = fixScript('192.168.1.5', 4318, 'C:\\node.exe');
    expect(outer).toContain('-Verb RunAs');
    const inner = Buffer.from(outer.match(/'-EncodedCommand','([^']+)'/)![1]!, 'base64').toString('utf16le');
    expect(inner).toContain('-LocalPort 4318');
    expect(inner).toContain('-Profile Private');
    expect(inner).toContain('-RemoteAddress LocalSubnet');
    expect(inner).toContain("-IPAddress '192.168.1.5'");
  });
});

describe('checkFirewall', () => {
  it('only looks on Windows, and stays quiet when it can’t tell', async () => {
    expect(await checkFirewall('192.168.1.5', 4318, async () => out({ block: 1 }), 'darwin')).toBeNull();
    expect(await checkFirewall('192.168.1.5', 4318, async () => out({ block: 1 }), 'win32')).toMatchObject({ kind: 'blocked' });
    expect(await checkFirewall('192.168.1.5', 4318, async () => 'not json', 'win32')).toBeNull();
    expect(await checkFirewall('192.168.1.5', 4318, () => Promise.reject(new Error('no powershell')), 'win32')).toBeNull();
  });
});
