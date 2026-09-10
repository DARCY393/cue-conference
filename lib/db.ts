import { isDemoMode } from "./store";

export type QueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number | null;
};

let pool: import("pg").Pool | null = null;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL is not configured (demo mode)");
  }
  if (!pool) {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount };
}

export function assertDbOrDemo(): "db" | "demo" {
  return isDemoMode() ? "demo" : "db";
}
