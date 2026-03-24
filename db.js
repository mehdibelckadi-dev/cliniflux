const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      history JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      nombre TEXT,
      telefono TEXT,
      email TEXT,
      centro TEXT,
      tipo TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}

async function getSession(sessionId) {
  const { rows } = await pool.query(
    'SELECT history FROM sessions WHERE id = $1',
    [sessionId]
  );
  return rows[0]?.history || [];
}

async function saveSession(sessionId, history) {
  await pool.query(`
    INSERT INTO sessions (id, history, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (id) DO UPDATE SET history = $2, updated_at = NOW()
  `, [sessionId, JSON.stringify(history)]);
}

async function saveLead(data) {
  const { nombre, telefono, email, centro, tipo } = data;
  await pool.query(
    'INSERT INTO leads (nombre, telefono, email, centro, tipo) VALUES ($1,$2,$3,$4,$5)',
    [nombre, telefono, email, centro, tipo]
  );
}

module.exports = { pool, initDb, getSession, saveSession, saveLead };
