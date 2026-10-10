import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isTailscale, remoteAddress } from './network.js';
import { CliError } from './options.js';

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo;
const v6 = (address: string) => ({ address, family: 'IPv6', internal: false }) as NetworkInterfaceInfo;

const laptop = {
  lo0: [v4('127.0.0.1', true)],
  docker0: [v4('172.17.0.1')],
  en0: [v6('fe80::1'), v4('192.168.1.23')],
  utun4: [v4('100.101.102.103')],
};

describe('remoteAddress', () => {
  const cli = (...addresses: string[]) => () => addresses;

  it('finds the Tailscale address the tailscale command reports', () => {
    expect(remoteAddress('tailscale', laptop, cli('100.101.102.103'))).toEqual({ address: '100.101.102.103', kind: 'tailscale' });
    expect(() => remoteAddress('tailscale', { en0: [v4('192.168.1.23')] }, cli())).toThrow(/Tailscale/);
  });

  it("finds Tailscale by its adapter's name without the command", () => {
    expect(remoteAddress('tailscale', { tailscale0: [v4('100.80.1.2')] }, cli())).toEqual({ address: '100.80.1.2', kind: 'tailscale' });
    expect(remoteAddress('tailscale', { Tailscale: [v4('100.80.1.2')] }, cli()).kind).toBe('tailscale');
  });

  it("doesn't take another 100.64.0.0/10 address (an ISP's or another VPN's) for Tailscale", () => {
    expect(() => remoteAddress('tailscale', { eth0: [v4('100.72.1.2')] }, cli())).toThrow(/Tailscale/);
    expect(() => remoteAddress('tailscale', laptop, cli('100.90.0.1'))).toThrow(/Tailscale/);
    expect(remoteAddress('100.72.1.2', { eth0: [v4('100.72.1.2')] }, cli())).toEqual({ address: '100.72.1.2', kind: 'address' });
  });

  it('finds the Wi-Fi address, skipping containers and tunnels', () => {
    expect(remoteAddress('lan', laptop)).toEqual({ address: '192.168.1.23', kind: 'lan' });
    expect(remoteAddress('lan', { docker0: [v4('172.17.0.1')], eth0: [v4('10.0.0.5')] })).toEqual({ address: '10.0.0.5', kind: 'lan' });
    expect(() => remoteAddress('lan', { lo: [v4('127.0.0.1', true)], docker0: [v4('172.17.0.1')] })).toThrow(/network/);
  });

  it('skips Windows virtual adapters', () => {
    const wifi = { 'Wi-Fi': [v4('10.0.0.5')] };
    for (const name of [
      'VirtualBox Host-Only Ethernet Adapter',
      'VMware Network Adapter VMnet8',
      'vEthernet (WSL)',
      'vEthernet (Default Switch)',
      'Hyper-V Virtual Ethernet Adapter',
      'Npcap Loopback Adapter',
    ]) {
      expect(remoteAddress('lan', { [name]: [v4('192.168.56.1')], ...wifi })).toEqual({ address: '10.0.0.5', kind: 'lan' });
    }
  });

  it('keeps real Windows adapters whose names start like a virtual one', () => {
    expect(remoteAddress('lan', { 'Local Area Connection': [v4('192.168.1.40')] })).toEqual({ address: '192.168.1.40', kind: 'lan' });
  });

  it("takes one of this computer's addresses", () => {
    expect(remoteAddress('192.168.1.23', laptop)).toEqual({ address: '192.168.1.23', kind: 'address' });
    expect(remoteAddress('100.101.102.103', laptop, cli('100.101.102.103')).kind).toBe('tailscale');
  });

  it('refuses addresses that are everywhere, nowhere or only here', () => {
    for (const bad of ['0.0.0.0', '::', '10.9.9.9', '127.0.0.1']) expect(() => remoteAddress(bad, laptop)).toThrow(CliError);
  });
});

describe('isTailscale', () => {
  it('knows the 100.64.0.0/10 range', () => {
    expect(isTailscale('100.64.0.1')).toBe(true);
    expect(isTailscale('100.127.255.254')).toBe(true);
    expect(isTailscale('100.63.0.1')).toBe(false);
    expect(isTailscale('100.128.0.1')).toBe(false);
    expect(isTailscale('192.168.1.1')).toBe(false);
  });
});
