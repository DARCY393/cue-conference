#!/usr/bin/env node
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const migrationsDir = join(root, "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required for db:migrate");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (
      await client.query(`SELECT filename FROM schema_migrations`)
    ).rows.map((r) => r.filename)
  );

  // Bootstrap: if core tables already exist but tracking is empty, mark 001–008 applied
  // so a populated Tailscale DB only runs new files (e.g. 009).
  if (applied.size === 0) {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'spaces'
      ) AS has_spaces
    `);
    if (rows[0]?.has_spaces) {
      const legacy = readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql") && /^00[1-8]_/.test(f))
        .sort();
      for (const file of legacy) {
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
          [file]
        );
        applied.add(file);
      }
      console.log(
        `Bootstrapped schema_migrations for ${legacy.length} existing files (001–008).`
      );
    }
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ${file}… skip (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`  ${file}… `);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [file]
      );
      await client.query("COMMIT");
      console.log("ok");
      ran += 1;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }

  await client.end();
  console.log(ran === 0 ? "Done (nothing new)." : `Done (${ran} applied).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
