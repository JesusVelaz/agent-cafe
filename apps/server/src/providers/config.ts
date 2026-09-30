import {
  HARNESS,
  PROVIDER_IDS,
  type ProviderId,
  type ProviderMode,
  type ProviderStatusDTO,
} from '@agent-cafe/shared';
import type { Db } from '../db/client.js';
import type { HarnessService } from './harness.js';

/** A user-correctable settings problem (maps to HTTP 400/409). */
export class ConfigError extends Error {}

export interface ProviderPatch {
  mode?: ProviderMode;
}

/**
 * Per-floor mode (live / demo / off) and status. Live runs use the floor's harness,
 * signed in by the user; there are no keys or dollar caps here.
 */
export class ProviderConfigService {
  constructor(
    private readonly db: Db,
    readonly harnesses: HarnessService,
  ) {}

  async all(): Promise<ProviderStatusDTO[]> {
    return Promise.all(PROVIDER_IDS.map((id) => this.status(id)));
  }

  async status(id: ProviderId): Promise<ProviderStatusDTO> {
    const row = await this.row(id);
    const usage = this.harnesses.planUsage(id);
    return {
      id,
      mode: row.mode as ProviderMode,
      harness: HARNESS[id].id,
      connection: this.harnesses.connection(id),
      usage,
      liveAvailable: HARNESS[id].live && this.harnesses.connection(id).state === 'ready',
      closed: row.mode === 'live' && usage?.status === 'rejected',
    };
  }

  async update(id: ProviderId, patch: ProviderPatch): Promise<ProviderStatusDTO> {
    if (patch.mode === 'live') {
      if (!HARNESS[id].live) throw new ConfigError(`Live ${HARNESS[id].name} runs are coming next. Use Demo for now.`);
      const c = await this.harnesses.check(id);
      if (c.state !== 'ready') throw new ConfigError(c.message ?? `${HARNESS[id].name} isn't ready.`);
    }
    if (patch.mode !== undefined) await this.db.providerConfig.update({ where: { id }, data: { mode: patch.mode } });
    return this.status(id);
  }

  async mode(id: ProviderId): Promise<ProviderMode> {
    return (await this.row(id)).mode as ProviderMode;
  }

  private row(id: ProviderId) {
    return this.db.providerConfig.upsert({ where: { id }, create: { id }, update: {} });
  }
}
