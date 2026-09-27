import {
  PROVIDER_IDS,
  type ProviderId,
  type ProviderMode,
  type ProviderStatusDTO,
} from '@agent-cafe/shared';
import type { Db } from '../db/client.js';
import { decryptSecret, encryptSecret, maskKey } from '../secrets/vault.js';

/** A user-correctable settings problem (maps to HTTP 400/409). */
export class ConfigError extends Error {}

export interface ProviderPatch {
  mode?: ProviderMode;
  apiKey?: string;
  clearKey?: boolean;
  dailyCapUsd?: number;
}

/**
 * Provider settings, key resolution and daily spend.
 * This is the only module that ever sees a decrypted key.
 */
export class ProviderConfigService {
  constructor(
    private readonly db: Db,
    private readonly envKeys: Partial<Record<ProviderId, string>>,
    private readonly masterKey: Buffer,
  ) {}

  async all(): Promise<ProviderStatusDTO[]> {
    return Promise.all(PROVIDER_IDS.map((id) => this.status(id)));
  }

  async status(id: ProviderId): Promise<ProviderStatusDTO> {
    const row = await this.row(id);
    const envKey = this.envKeys[id];
    const spentTodayUsd = await this.spentToday(id);
    return {
      id,
      mode: row.mode as ProviderMode,
      hasKey: Boolean(envKey || row.encryptedKey),
      keySource: envKey ? 'env' : row.encryptedKey ? 'stored' : null,
      keyHint: envKey ? maskKey(envKey) : row.keyHint,
      dailyCapUsd: row.dailyCapUsd,
      spentTodayUsd,
      closed: spentTodayUsd >= row.dailyCapUsd,
    };
  }

  async update(id: ProviderId, patch: ProviderPatch): Promise<ProviderStatusDTO> {
    const row = await this.row(id);
    const data: {
      mode?: string;
      encryptedKey?: string | null;
      keyHint?: string | null;
      dailyCapUsd?: number;
    } = {};

    if (patch.clearKey) {
      data.encryptedKey = null;
      data.keyHint = null;
      // Never leave a provider live with nothing to authenticate with.
      if (!this.envKeys[id] && row.mode === 'live') data.mode = 'mock';
    }
    if (patch.apiKey !== undefined) {
      const key = patch.apiKey.trim();
      if (key.length < 12) throw new ConfigError('That does not look like an API key.');
      data.encryptedKey = encryptSecret(key, this.masterKey);
      data.keyHint = maskKey(key);
    }
    if (patch.dailyCapUsd !== undefined) {
      if (!(patch.dailyCapUsd >= 0)) throw new ConfigError('Daily cap must be 0 or more.');
      data.dailyCapUsd = patch.dailyCapUsd;
    }
    if (patch.mode !== undefined) {
      const storedAfter = data.encryptedKey !== undefined ? data.encryptedKey : row.encryptedKey;
      if (patch.mode === 'live' && !this.envKeys[id] && !storedAfter) {
        throw new ConfigError(`Add an API key before switching ${id} to live.`);
      }
      data.mode = patch.mode;
    }

    await this.db.providerConfig.update({ where: { id }, data });
    return this.status(id);
  }

  async mode(id: ProviderId): Promise<ProviderMode> {
    return (await this.row(id)).mode as ProviderMode;
  }

  /** The decrypted key, env first. Keep the result inside the server process. */
  async resolveKey(id: ProviderId): Promise<string | null> {
    const envKey = this.envKeys[id];
    if (envKey) return envKey;
    const row = await this.row(id);
    return row.encryptedKey ? decryptSecret(row.encryptedKey, this.masterKey) : null;
  }

  /** Live (non-mock) spend for tasks started since local midnight. */
  async spentToday(id: ProviderId): Promise<number> {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const agg = await this.db.task.aggregate({
      _sum: { costUsd: true },
      where: { providerId: id, isMock: false, startedAt: { gte: midnight } },
    });
    return agg._sum.costUsd ?? 0;
  }

  private row(id: ProviderId) {
    return this.db.providerConfig.upsert({ where: { id }, create: { id }, update: {} });
  }
}
