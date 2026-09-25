// ------------------------------------------------------------
// Postgres (Neon / Supabase / أي Postgres). Pool واحد لكل instance.
// ------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { CHARACTERS } = require('./characters');

let pool = null;
let migrated = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set — ضع رابط Supabase في ملف .env');
  const local = /localhost|127\.0\.0\.1/.test(url);
  pool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    ssl: local || process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  return pool;
}

const SCHEMA_VERSION = '5'; // غيّره عند تعديل الجداول أو الشخصيات

async function migrate() {
  if (!migrated) {
    migrated = (async () => {
      const pool = getPool();
      // التشغيل البارد: استعلام واحد فقط إن كانت الجداول محدّثة
      try {
        const r = await pool.query("SELECT value FROM app_meta WHERE key='schema'");
        if (r.rows[0] && r.rows[0].value === SCHEMA_VERSION) return;
      } catch {}
      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      const c = await pool.connect();
      try {
        // داخل Transaction واحدة: آمن مع Supabase Pooler (وضع Transaction)
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(424242)');
        await c.query(sql);
        const vals = [];
        const params = [];
        CHARACTERS.forEach((ch, i) => {
          vals.push(`($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`);
          params.push(ch.characterId, ch.characterName, ch.title, ch.characterImage, ch.characterPortrait);
        });
        await c.query(
          `INSERT INTO characters (id, name, title, image, portrait) VALUES ${vals.join(',')}
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, title=EXCLUDED.title, image=EXCLUDED.image, portrait=EXCLUDED.portrait`,
          params
        );
        await c.query("INSERT INTO app_meta (key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [SCHEMA_VERSION]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    })().catch((e) => {
      migrated = null;
      throw e;
    });
  }
  return migrated;
}

async function query(text, params) {
  await migrate();
  return getPool().query(text, params);
}

async function tx(fn) {
  await migrate();
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function close() {
  if (pool) await pool.end();
  pool = null;
  migrated = null;
}

module.exports = { query, tx, migrate, close };
