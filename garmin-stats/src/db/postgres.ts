import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type SqlValues = readonly unknown[];

/**
 * Small asynchronous PostgreSQL access layer for the application runtime.
 * It deliberately exposes only parameterized queries and transaction scopes;
 * schema creation belongs exclusively to db:migrate.
 */
export class PostgresDatabase {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
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
