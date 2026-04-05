const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pass, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pass, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pass, salt, 64).toString('hex');
  return check === hash;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      history JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      nombre TEXT,
      clinica TEXT,
      telefono TEXT,
      email TEXT,
      tipo TEXT,
      mensaje TEXT,
      source TEXT DEFAULT 'web',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clinics (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      config JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS imported_leads (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER REFERENCES clinics(id),
      nombre TEXT,
      telefono TEXT,
      email TEXT,
      ultima_visita TEXT,
      servicio TEXT,
      notas TEXT,
      estado TEXT DEFAULT 'pendiente',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER REFERENCES clinics(id),
      patient_name TEXT,
      patient_phone TEXT,
      service TEXT,
      scheduled_at TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Seed demo clinic if not exists
  const { rows } = await pool.query("SELECT id FROM clinics WHERE email = 'demo@cliniflux.com'");
  if (!rows.length) {
    const demoPass = process.env.DEMO_PASSWORD || 'demo1234';
    await pool.query(
      "INSERT INTO clinics (email, password_hash, name, config) VALUES ($1,$2,$3,$4)",
      ['demo@cliniflux.com', hashPassword(demoPass), 'Clínica Demo', JSON.stringify({
        phone: '+34 900 000 000', hours: 'L-V 9:00-20:00', services: 'Dental, Estética, Nutrición'
      })]
    );
    console.log(`Demo clinic created — email: demo@cliniflux.com / pass: ${demoPass}`);
  }

  console.log('DB ready');
}

async function getSession(sessionId) {
  const { rows } = await pool.query(
    'SELECT history FROM chat_sessions WHERE id = $1',
    [sessionId]
  );
  return rows[0]?.history || [];
}

async function saveSession(sessionId, history) {
  await pool.query(`
    INSERT INTO chat_sessions (id, history, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (id) DO UPDATE SET history = $2, updated_at = NOW()
  `, [sessionId, JSON.stringify(history)]);
}

async function saveLead(data) {
  const { nombre, clinica, telefono, email, tipo, mensaje, source } = data;
  await pool.query(
    'INSERT INTO leads (nombre, clinica, telefono, email, tipo, mensaje, source) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [nombre, clinica||null, telefono||null, email, tipo||null, mensaje||null, source||'web']
  );
}

async function getClinicByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM clinics WHERE email = $1', [email]);
  return rows[0] || null;
}

async function getLeads(limit = 50) {
  const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function saveAppointment(data) {
  const { clinic_id, patient_name, patient_phone, service, scheduled_at } = data;
  await pool.query(
    'INSERT INTO appointments (clinic_id, patient_name, patient_phone, service, scheduled_at) VALUES ($1,$2,$3,$4,$5)',
    [clinic_id, patient_name, patient_phone, service, scheduled_at]
  );
}

async function getAppointments(clinic_id, limit = 20) {
  const { rows } = await pool.query(
    'SELECT * FROM appointments WHERE clinic_id = $1 ORDER BY created_at DESC LIMIT $2',
    [clinic_id, limit]
  );
  return rows;
}

async function importLeads(clinic_id, rows) {
  if (!rows.length) return 0;
  const flat = rows.flatMap(r => [clinic_id, r.nombre||null, r.telefono||null, r.email||null, r.ultima_visita||null, r.servicio||null, r.notas||null]);
  const v2 = rows.map((_, i) => {
    const o = i * 7;
    return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`;
  }).join(',');
  await pool.query(`INSERT INTO imported_leads (clinic_id,nombre,telefono,email,ultima_visita,servicio,notas) VALUES ${v2}`, flat);
  return rows.length;
}

async function getImportedLeads(clinic_id) {
  const { rows } = await pool.query(
    'SELECT * FROM imported_leads WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 500',
    [clinic_id]
  );
  return rows;
}

async function updateLeadEstado(id, estado) {
  await pool.query('UPDATE imported_leads SET estado=$1 WHERE id=$2', [estado, id]);
}

module.exports = { pool, initDb, getSession, saveSession, saveLead, getClinicByEmail, getLeads, saveAppointment, getAppointments, verifyPassword, importLeads, getImportedLeads, updateLeadEstado };
