/**
 * Essential connectivity check against the CockroachDB URL in the repo root
 * .env (key COCKROACHURL or DATABASE_URL). Prints only a verdict — never the
 * URL itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';

const envFile = join(import.meta.dirname, '..', '..', '.env');
const text = readFileSync(envFile, 'utf8');
const pick = (key) => {
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : undefined;
};

const url = pick('DATABASE_URL') || pick('COCKROACHURL');
if (!url) {
  console.log('[dbcheck] NO DB URL in .env (COCKROACHURL / DATABASE_URL)');
  process.exit(2);
}
process.env.DATABASE_URL = url;

try {
  const store = await createStore(); // connects + self-provisions the schema
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query('SELECT version() AS v');
  const v = String(rows[0].v);
  console.log(`[dbcheck] OK store_mode=${store.mode}`);
  console.log(`[dbcheck] database: ${v.split(' ').slice(0, 3).join(' ')} (${v.split('v')[1] ? 'v' + v.split('v')[1].split(' ')[0] : '??'})`);
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('devices','device_state','readings','alerts','commands_log') ORDER BY table_name`);
  console.log(`[dbcheck] schema tables: ${tables.rows.map((r) => r.table_name).join(', ')}`);
  await pool.end();
} catch (err) {
  console.log(`[dbcheck] FAIL: ${err.message}`);
  process.exit(1);
}
