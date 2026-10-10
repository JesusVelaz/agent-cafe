import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { checkFirewall, fixFirewall, type FirewallProblem } from './firewall.js';
import { remoteAddress, RemoteSetupError, type RemoteKind } from './network.js';
import { hostPort, remoteHandler, type RemoteAccess } from './remote.js';
import { pairingToken } from './token.js';

/** Phone access as the café page sees it: how phones reach the café, and the link that pairs one. */
export interface PhoneSharing {
  via: RemoteKind;
  /** The pairing link (it carries the token): show it as a QR code, only on this computer. */
  link: string;
  /** A device has reached the café on this address since phone access was turned on. */
  reached: boolean;
  /** What would stop a phone getting through (Windows Firewall), or null if nothing we can see. */
  firewall: FirewallProblem | null;
}

interface Options {
  /** How a choice (`tailscale`, `lan`, an address) becomes an address. */
  resolve?: (choice: string) => { address: string; kind: RemoteKind };
  check?: (address: string, port: number) => Promise<FirewallProblem | null>;
  fix?: (address: string, port: number) => Promise<void>;
}

/**
 * Phone access, which can be turned on at start (`agent-cafe --host`) or later from the café page.
 * On: a second listener on the chosen address serves the same app, to paired devices only.
 */
export class PhoneAccess {
  private app?: FastifyInstance;
  private server?: Server;
  private access?: RemoteAccess & { via: RemoteKind };
  private reached = false;
  private firewall: FirewallProblem | null = null;
  private readonly resolve: NonNullable<Options['resolve']>;
  private readonly check: NonNullable<Options['check']>;
  private readonly fix: NonNullable<Options['fix']>;

  /** `dataDir` keeps the pairing token. Without one (or without the built UI to serve), there is no phone access. */
  constructor(
    private readonly port: number,
    private readonly dataDir: string | undefined,
    options: Options = {},
  ) {
    this.resolve = options.resolve ?? remoteAddress;
    this.check = options.check ?? checkFirewall;
    this.fix = options.fix ?? fixFirewall;
  }

  get available(): boolean {
    return this.dataDir !== undefined;
  }

  /** How phones reached the café when it last closed (`tailscale`, `lan` or an address), if they could. */
  saved(): string | undefined {
    if (!this.dataDir) return undefined;
    try {
      return readFileSync(join(this.dataDir, 'phone-access'), 'utf8').trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Where paired devices reach the café right now, for the app's checks. */
  readonly current = (): RemoteAccess | undefined => this.access;

  attach(app: FastifyInstance) {
    this.app = app;
  }

  status(): PhoneSharing | null {
    if (!this.access) return null;
    return {
      via: this.access.via,
      link: `http://${hostPort(this.access.host, this.port)}/?token=${this.access.token}`,
      reached: this.reached,
      firewall: this.reached ? null : this.firewall,
    };
  }

  /** Turns phone access on: `tailscale`, `lan` or one of this computer's addresses. */
  async start(choice: string): Promise<PhoneSharing> {
    if (!this.app || !this.dataDir) throw new RemoteSetupError('Network access needs the café started with `pnpm start` or `agent-cafe`.');
    const { address, kind } = this.resolve(choice);
    if (this.access?.host === address) return this.status()!;
    await this.stop();

    const handle = remoteHandler(this.app);
    const server = createServer((req, res) => {
      this.reached = true; // the way in is open, whatever happens next
      handle(req, res);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.port, address, () => resolve());
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EADDRNOTAVAIL') throw new RemoteSetupError(`${address} isn't available on this computer right now.`);
      if (code === 'EADDRINUSE') throw new RemoteSetupError(`Port ${this.port} on ${address} is in use by another program.`);
      throw err;
    }
    this.server = server;
    this.access = { host: address, token: pairingToken(this.dataDir).token, via: kind };
    this.reached = false;
    // Looked up before the person scans, so the page can say what's wrong while they try.
    // Stays on next time the café starts, until it's turned off.
    writeFileSync(join(this.dataDir, 'phone-access'), `${choice}\n`);
    this.firewall = await this.check(address, this.port);
    return this.status()!;
  }

  /**
   * Fixes what the firewall check found (Windows asks the person first), then checks again.
   * Throws a RemoteSetupError when it couldn't.
   */
  async repair(): Promise<PhoneSharing> {
    if (!this.access) throw new RemoteSetupError('Network access is off.');
    if (!this.firewall?.fixable) throw new RemoteSetupError('There’s nothing here the café can fix.');
    const { host } = this.access;
    try {
      await this.fix(host, this.port);
    } catch {
      throw new RemoteSetupError('Windows didn’t make the change. Click Yes when it asks for permission, then try again.');
    }
    if (this.access?.host === host) this.firewall = await this.check(host, this.port);
    const status = this.status();
    if (!status) throw new RemoteSetupError('Network access is off.');
    return status;
  }

  /** Turns phone access off, for next time too. Paired devices stay paired. */
  async turnOff() {
    await this.stop();
    if (this.dataDir) rmSync(join(this.dataDir, 'phone-access'), { force: true });
  }

  /** Closes the way in for now (the café is closing, or switching addresses). */
  async stop() {
    const server = this.server;
    this.access = undefined;
    this.firewall = null;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
