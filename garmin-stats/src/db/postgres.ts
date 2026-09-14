import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// node-postgres returns BIGINT (OID 20) as a string by default, since it
// can't guarantee JS number precision for the full 64-bit range. Every id,
// foreign key, and unix-ms timestamp column in this schema is BIGINT, and
// call sites compare those values against real JS numbers (URL params,
// JSON bodies) — leaving the driver default silently breaks those
// comparisons (e.g. `row.instance_id !== instanceId` is always true). IDs
// here never approach Number.MAX_SAFE_INTEGER, so parsing to a number is safe.
types.setTypeParser(20, (value: string) => Number(value));

export type SqlValues = readonly unknown[];

/**
 * Small asynchronous PostgreSQL access layer for the application runtime.
 * It deliberately exposes only parameterized queries and transaction scopes;
 * schema creation belongs exclusively to db:migrate.
 */
export class PostgresDatabase {
  readonly #pool: Pool;

  constructor(databaseUrl: string, schema?: string) {
    // Test schemas are an explicit PostgreSQL isolation mechanism. Normal
    // runtime callers never provide a schema and use the ordinary search path.
    this.#pool = new Pool({
      connectionString: databaseUrl,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
  }

  async get<T extends QueryResultRow>(sql: string, values: SqlValues = []): Promise<T | undefined> {
    const result = await this.#pool.query<T>(sql, [...values]);
    return result.rows[0];
  }

  async all<T extends QueryResultRow>(sql: string, values: SqlValues = []): Promise<T[]> {
    return (await this.#pool.query<T>(sql, [...values])).rows;
  }

  async run(sql: string, values: SqlValues = []): Promise<number> {
    return (await this.#pool.query(sql, [...values])).rowCount ?? 0;
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export function openPostgresDatabase(): PostgresDatabase {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");
  return new PostgresDatabase(databaseUrl);
}
