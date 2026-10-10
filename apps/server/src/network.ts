import { execFileSync } from 'node:child_process';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export type RemoteKind = 'tailscale' | 'lan' | 'address';

/** Why phone access can't be turned on, in words for the person who asked. */
export class RemoteSetupError extends Error {}
type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Tailscale gives every device an address in 100.64.0.0/10. ISPs (carrier-grade NAT) and other
 * VPNs use that range too, so on its own it doesn’t mean Tailscale (see `remoteAddress`).
 */
export function isTailscale(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b !== undefined && b >= 64 && b <= 127;
}

// Where the tailscale command lives: on the PATH, or inside the Mac app.
const TAILSCALE_CLIS = ['tailscale', ...(process.platform === 'darwin' ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : [])];

/** This computer's Tailscale IPv4 addresses, as the tailscale command reports them (empty if it can't). */
export function tailscaleCliAddresses(): string[] {
  for (const cli of TAILSCALE_CLIS) {
    try {
      const out = execFileSync(cli, ['ip', '-4'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      return out.split(/\s+/).filter(isTailscale);
    } catch {
      // Not installed here, or not running: try the next place.
    }
  }
  return [];
}

// Tailscale names its adapter tailscale0 on Linux and "Tailscale" on Windows (macOS uses utunN).
const TAILSCALE_ADAPTER = /^tailscale/i;

/** Home and office networks use these ranges (192.168.x.x first: that's almost always Wi-Fi). */
function lanRank(ip: string): number | null {
  const [a, b] = ip.split('.').map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return 2;
  return null;
}

// Virtual adapters (containers, VMs, VPN tunnels) aren't the network a phone is on. The first
// group are Linux/macOS names (by prefix); the second, words in Windows adapter names.
const VIRTUAL = /^(docker|br-|veth|vmnet|vboxnet|virbr|utun|tun|tap|lo\d*$)|virtualbox|vmware|hyper-v|vethernet|wsl|loopback/i;

const ipv4 = (interfaces: Interfaces) =>
  Object.entries(interfaces).flatMap(([name, infos]) =>
    (infos ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })),
  );

/**
 * The address to serve paired devices on: `tailscale` (this computer's Tailscale address),
 * `lan` (its Wi-Fi / home network address) or an address of this computer.
 */
export function remoteAddress(
  choice: string,
  interfaces: Interfaces = networkInterfaces(),
  tailscaleCli: () => string[] = tailscaleCliAddresses,
): { address: string; kind: RemoteKind } {
  const all = ipv4(interfaces);
  // Only addresses Tailscale itself vouches for (its command, or its own adapter) count as Tailscale.
  let confirmed: string[] | undefined;
  const tailscale = () => {
    confirmed ??= [
      ...tailscaleCli(),
      ...all.filter((i) => TAILSCALE_ADAPTER.test(i.name) && isTailscale(i.address)).map((i) => i.address),
    ];
    return confirmed;
  };
  if (choice === 'tailscale') {
    const found = all.find((i) => tailscale().includes(i.address));
    if (!found) throw new RemoteSetupError('No Tailscale address on this computer. Is Tailscale installed and connected?');
    return { address: found.address, kind: 'tailscale' };
  }
  if (choice === 'lan') {
    const found = all
      .filter((i) => !VIRTUAL.test(i.name) && lanRank(i.address) !== null)
      .sort((x, y) => lanRank(x.address)! - lanRank(y.address)!)[0];
    if (!found) throw new RemoteSetupError('No Wi-Fi or home network address found. Is this computer on a network?');
    return { address: found.address, kind: 'lan' };
  }
  if (choice === '0.0.0.0' || choice === '::') {
    throw new RemoteSetupError('Listening on every address would expose the café on networks you didn’t choose. Pick one: --host tailscale, --host lan, or an address.');
  }
  const known = Object.values(interfaces).flatMap((infos) => (infos ?? []).map((i) => i.address));
  if (!known.includes(choice)) throw new RemoteSetupError(`${choice} isn't an address of this computer.`);
  if (choice.startsWith('127.') || choice === '::1') throw new RemoteSetupError('That address is only reachable from this computer. Leave out --host for that.');
  return { address: choice, kind: isTailscale(choice) && tailscale().includes(choice) ? 'tailscale' : 'address' };
}
