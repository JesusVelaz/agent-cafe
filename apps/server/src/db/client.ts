import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { databaseUrl } from '../paths.js';

export type Db = PrismaClient;

export function createDb(url: string = databaseUrl()): Db {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}
