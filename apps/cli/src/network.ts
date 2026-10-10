import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { CliError } from './options.js';

export type RemoteKind = 'tailscale' | 'lan' | 'address';
type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** Tailscale gives every device an address in 100.64.0.0/10. */
export function isTailscale(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b !== undefined && b >= 64 && b <= 127;
}

/** Home and office networks use these ranges (192.168.x.x first: that's almost always Wi-Fi). */
function lanRank(ip: string): number | null {
  const [a, b] = ip.split('.').map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return 2;
  return null;
}

// Virtual adapters (containers, VMs, VPN tunnels) aren't the network a phone is on.
const VIRTUAL = /^(docker|br-|veth|vmnet|vboxnet|virbr|utun|tun|tap|lo)/i;

const ipv4 = (interfaces: Interfaces) =>
  Object.entries(interfaces).flatMap(([name, infos]) =>
    (infos ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })),
  );

/**
 * The address to serve paired devices on: `tailscale` (this computer's Tailscale address),
 * `lan` (its Wi-Fi / home network address) or an address of this computer.
 */
export function remoteAddress(choice: string, interfaces: Interfaces = networkInterfaces()): { address: string; kind: RemoteKind } {
  const all = ipv4(interfaces);
  if (choice === 'tailscale') {
    const found = all.find((i) => isTailscale(i.address));
    if (!found) throw new CliError('No Tailscale address on this computer. Is Tailscale installed and connected?');
    return { address: found.address, kind: 'tailscale' };
  }
  if (choice === 'lan') {
    const found = all
      .filter((i) => !VIRTUAL.test(i.name) && lanRank(i.address) !== null)
      .sort((x, y) => lanRank(x.address)! - lanRank(y.address)!)[0];
    if (!found) throw new CliError('No Wi-Fi or home network address found. Is this computer on a network?');
    return { address: found.address, kind: 'lan' };
  }
  if (choice === '0.0.0.0' || choice === '::') {
    throw new CliError('Listening on every address would expose the café on networks you didn’t choose. Pick one: --host tailscale, --host lan, or an address.');
  }
  const known = Object.values(interfaces).flatMap((infos) => (infos ?? []).map((i) => i.address));
  if (!known.includes(choice)) throw new CliError(`${choice} isn't an address of this computer.`);
  if (choice.startsWith('127.') || choice === '::1') throw new CliError('That address is only reachable from this computer. Leave out --host for that.');
  return { address: choice, kind: isTailscale(choice) ? 'tailscale' : 'address' };
}
