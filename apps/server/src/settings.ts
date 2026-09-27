import type { SettingsDTO } from '@agent-cafe/shared';
import type { Db } from './db/client.js';

/** App-wide settings in the Setting key/value table. */
export class SettingsService {
  constructor(private readonly db: Db) {}

  async get(): Promise<SettingsDTO> {
    const rows = await this.db.setting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return { ambient: map.get('ambient') === 'true' };
  }

  async update(patch: Partial<SettingsDTO>): Promise<SettingsDTO> {
    if (patch.ambient !== undefined) {
      const value = String(patch.ambient);
      await this.db.setting.upsert({ where: { key: 'ambient' }, create: { key: 'ambient', value }, update: { value } });
    }
    return this.get();
  }
}
