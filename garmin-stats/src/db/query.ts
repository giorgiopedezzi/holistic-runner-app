import type { PoolClient, QueryResultRow } from "pg";
import type { PostgresDatabase } from "./postgres.ts";

/** The narrow query surface shared by the pool and a transaction client. */
export interface Queryable {
  get<T extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<T | undefined>;
  all<T extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  run(sql: string, values?: readonly unknown[]): Promise<number>;
}

export function clientQueryable(client: PoolClient): Queryable {
  return {
    async get<T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) { return (await client.query<T>(sql, [...values])).rows[0]; },
    async all<T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) { return (await client.query<T>(sql, [...values])).rows; },
    async run(sql: string, values: readonly unknown[] = []) { return (await client.query(sql, [...values])).rowCount ?? 0; },
  };
}
export type RuntimeDatabase = PostgresDatabase;
