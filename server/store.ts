import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { FinancialSnapshot } from "@stock/financial-analysis";
import type { Security } from "./providers";
export type Job = {
  id: string;
  issuerId: string;
  state: "queued" | "fetching" | "ready" | "failed";
  attempts: number;
  createdAt: string;
  nextAt: number;
  leaseUntil: number;
  error?: string;
  financialVersion?: string;
};
export type IssuerState = {
  snapshot?: FinancialSnapshot;
  versions: Record<string, FinancialSnapshot>;
  sourceCheckedAt?: string;
  lastRequestedAt: number;
  error?: string;
  jobId?: string;
};
export type State = {
  issuers: Record<string, IssuerState>;
  securities: Record<string, Security>;
  jobs: Record<string, Job>;
};
export class Store {
  private pool: Pool | null;
  private pending = Promise.resolve();
  readonly directory: string;
  constructor(
    directory = process.env.DATA_DIR || ".stock-data",
    databaseUrl = process.env.DATABASE_URL,
  ) {
    this.directory = directory;
    this.pool = databaseUrl
      ? new Pool({ connectionString: databaseUrl })
      : null;
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    if (this.pool) {
      await this.pool.query(
        "CREATE TABLE IF NOT EXISTS stock_state (id integer PRIMARY KEY, body jsonb NOT NULL)",
      );
      await this.pool.query(
        "INSERT INTO stock_state VALUES (1,$1) ON CONFLICT DO NOTHING",
        [{ issuers: {}, securities: {}, jobs: {} }],
      );
    }
  }
  async transaction<T>(fn: (state: State) => T): Promise<T> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query(
          "SELECT body FROM stock_state WHERE id=1 FOR UPDATE",
        );
        const state = row.rows[0].body as State;
        const result = fn(state);
        await client.query("UPDATE stock_state SET body=$1 WHERE id=1", [
          state,
        ]);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    let release!: () => void;
    const previous = this.pending;
    this.pending = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      let state: State;
      try {
        state = JSON.parse(
          await readFile(path.join(this.directory, "state.json"), "utf8"),
        ) as State;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        state = { issuers: {}, securities: {}, jobs: {} };
      }
      const result = fn(state);
      const file = path.join(this.directory, "state.json");
      await writeFile(file + ".tmp", JSON.stringify(state));
      await rename(file + ".tmp", file);
      return result;
    } finally {
      release();
    }
  }
  async close() {
    await this.pool?.end();
  }
}
