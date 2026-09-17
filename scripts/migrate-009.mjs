#!/usr/bin/env node
/** One-shot: apply migrations/009_locations.sql only (for Tailscale DBs). */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "..", "migrations", "009_locations.sql"),
  "utf8"
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(sql);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO schema_migrations (filename) VALUES ('009_locations.sql')
    ON CONFLICT DO NOTHING;
  `);
  await client.end();
  console.log("009_locations.sql applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
