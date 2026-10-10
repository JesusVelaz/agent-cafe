import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { remoteAddress, RemoteSetupError, type RemoteKind } from './network.js';
import { hostPort, remoteHandler, type RemoteAccess } from './remote.js';
import { pairingToken } from './token.js';

/** Phone access as the café page sees it: how phones reach the café, and the link that pairs one. */
export interface PhoneSharing {
  via: RemoteKind;
  /** The pairing link (it carries the token): show it as a QR code, only on this computer. */
  link: string;
}

/**
 * Phone access, which can be turned on at start (`agent-cafe --host`) or later from the café page.
 * On: a second listener on the chosen address serves the same app, to paired devices only.
 */
export class PhoneAccess {
  private app?: FastifyInstance;
  private server?: Server;
  private access?: RemoteAccess & { via: RemoteKind };

  /** `dataDir` keeps the pairing token. Without one (or without the built UI to serve), there is no phone access. */
  constructor(
    private readonly port: number,
    private readonly dataDir: string | undefined,
    private readonly resolve: (choice: string) => { address: string; kind: RemoteKind } = remoteAddress,
  ) {}

  get available(): boolean {
    return this.dataDir !== undefined;
  }

  /** Where paired devices reach the café right now, for the app's checks. */
  readonly current = (): RemoteAccess | undefined => this.access;

  attach(app: FastifyInstance) {
    this.app = app;
  }

  status(): PhoneSharing | null {
    if (!this.access) return null;
    return { via: this.access.via, link: `http://${hostPort(this.access.host, this.port)}/?token=${this.access.token}` };
  }

  /** Turns phone access on: `tailscale`, `lan` or one of this computer's addresses. */
  async start(choice: string): Promise<PhoneSharing> {
    if (!this.app || !this.dataDir) throw new RemoteSetupError('Phone access needs the café started with `pnpm start` or `agent-cafe`.');
    const { address, kind } = this.resolve(choice);
    if (this.access?.host === address) return this.status()!;
    await this.stop();

    const server = createServer(remoteHandler(this.app));
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
    return this.status()!;
  }

  /** Turns phone access off. Paired devices stay paired for next time. */
  async stop() {
    const server = this.server;
    this.access = undefined;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
