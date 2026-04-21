const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
});

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
  // clinics primero — el resto tienen FK a clinics(id)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinics (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      config JSONB DEFAULT '{}',
      whatsapp_number TEXT,
      setup_token TEXT,
      plan TEXT DEFAULT 'starter',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      history JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      clinic_id INTEGER REFERENCES clinics(id),
      nombre TEXT,
      clinica TEXT,
      telefono TEXT,
      email TEXT,
      tipo TEXT,
      mensaje TEXT,
      source TEXT DEFAULT 'web',
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id           SERIAL PRIMARY KEY,
      clinic_id    INTEGER REFERENCES clinics(id),
      session_id   TEXT NOT NULL,
      direction    TEXT NOT NULL,
      content      TEXT NOT NULL,
      from_number  TEXT,
      responded_by TEXT DEFAULT 'ai',
      created_at   TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conv_states (
      session_id   TEXT PRIMARY KEY,
      clinic_id    INTEGER REFERENCES clinics(id),
      manual_mode  BOOLEAN DEFAULT FALSE,
      priority     TEXT DEFAULT 'normal',
      notes        TEXT DEFAULT '',
      status       TEXT DEFAULT 'open',
      last_msg_at  TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         SERIAL PRIMARY KEY,
      clinic_id  INTEGER REFERENCES clinics(id),
      endpoint   TEXT UNIQUE NOT NULL,
      keys       JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Migraciones: añadir columnas si no existen
  const migrations = [
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS setup_token TEXT`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_number TEXT`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'starter'`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS clinic_id INTEGER`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS conv_count INTEGER DEFAULT 0`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS conv_reset_at TIMESTAMP DEFAULT NOW()`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS conv_warned BOOLEAN DEFAULT FALSE`,
    // whatsapp_normalized: columna indexable para lookup rápido
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS whatsapp_normalized TEXT`,
    `UPDATE clinics SET whatsapp_normalized = right(regexp_replace(whatsapp_number,'\\D','','g'),9) WHERE whatsapp_number IS NOT NULL AND whatsapp_normalized IS NULL`,
    // Índices de rendimiento
    `CREATE INDEX IF NOT EXISTS idx_messages_clinic_session ON messages(clinic_id, session_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_clinic_created ON messages(clinic_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_clinic ON leads(clinic_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_appointments_clinic ON appointments(clinic_id, scheduled_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_imported_leads_clinic ON imported_leads(clinic_id, estado)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_clinics_whatsapp_norm ON clinics(whatsapp_normalized)`,
  ];
  for (const sql of migrations) await pool.query(sql);

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
  const { nombre, clinica, telefono, email, tipo, mensaje, source, clinic_id } = data;
  await pool.query(
    'INSERT INTO leads (clinic_id, nombre, clinica, telefono, email, tipo, mensaje, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [clinic_id||null, nombre, clinica||null, telefono||null, email, tipo||null, mensaje||null, source||'web']
  );
}

async function getClinicByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM clinics WHERE email = $1', [email]);
  return rows[0] || null;
}

async function getClinicByWhatsapp(number) {
  const clean = number.replace(/\D/g, '').slice(-9);
  const { rows } = await pool.query(
    'SELECT * FROM clinics WHERE whatsapp_normalized = $1',
    [clean]
  );
  return rows[0] || null;
}

async function getClinicBySetupToken(token) {
  const { rows } = await pool.query('SELECT * FROM clinics WHERE setup_token = $1', [token]);
  return rows[0] || null;
}

async function createClinic(data) {
  const { email, password_hash, name, config, whatsapp_number, plan, setup_token, stripe_customer_id, stripe_subscription_id } = data;
  const { rows } = await pool.query(
    'INSERT INTO clinics (email,password_hash,name,config,whatsapp_number,plan,setup_token,stripe_customer_id,stripe_subscription_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [email, password_hash, name, JSON.stringify(config||{}), whatsapp_number||null, plan||'starter', setup_token||null, stripe_customer_id||null, stripe_subscription_id||null]
  );
  return rows[0];
}

async function updateClinicConfig(id, config) {
  await pool.query('UPDATE clinics SET config=$1, setup_token=NULL WHERE id=$2', [JSON.stringify(config), id]);
}

function buildPromptForClinic(clinic) {
  const cfg = clinic.config || {};
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const fecha = new Date().toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short' });
  const name = cfg.assistant_name || 'Natalia';
  const phone = cfg.phone || '';
  return `Eres ${name}, recepcionista de ${clinic.name} (${fecha}). Tono: cálido, natural, humano. Frases: "Claro que sí", "Perfecto", "No se preocupe". 1-2 emojis/msg. Respuestas cortas (≤3 párrafos). Español siempre.
Saludo inicial: "¡${saludo}! Soy ${name} 😊 ¿En qué le ayudo?"
📍 ${cfg.address||''} | 📞 ${phone} | ⏰ ${cfg.hours||'L-V 9:00-20:00'}${cfg.email ? ' | ✉ '+cfg.email : ''}
Servicios: ${cfg.services||'consultar por teléfono'}${cfg.extra ? '\n'+cfg.extra : ''}
Citas: recoge nombre→servicio→franja horaria. Di que llamarán para confirmar. Cancelaciones con 24h+. No inventes precios ni horarios exactos.
Desconocido: "Llámenos al ${phone||'la clínica'}, le atendemos encantados."
No confirmes ser IA salvo pregunta directa.
Con nombre+servicio+franja: CITA_CONFIRMADA|tratamiento=...|fecha=...|hora=...|nombre=...|email=...`;
}

async function getLeads(clinic_id, limit = 50) {
  // Los leads de contacto web son globales (no tienen clinic_id) — los ve la clínica con id=1 (demo/admin)
  // En producción multi-tenant los leads llegan con clinic_id si el formulario lo incluye
  const { rows } = await pool.query(
    'SELECT * FROM leads WHERE clinic_id=$1 OR (clinic_id IS NULL AND $1=1) ORDER BY created_at DESC LIMIT $2',
    [clinic_id, limit]
  );
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

const PLAN_LIMITS = { starter: 300, pro: 2000, clinica: null };

// Devuelve { count, limit, pct, blocked }. Incrementa el contador con reset mensual.
async function incrementConversation(clinic_id) {
  const { rows } = await pool.query(`
    UPDATE clinics SET
      conv_count = CASE WHEN date_trunc('month', conv_reset_at) < date_trunc('month', NOW())
                        THEN 1 ELSE conv_count + 1 END,
      conv_reset_at = CASE WHEN date_trunc('month', conv_reset_at) < date_trunc('month', NOW())
                           THEN NOW() ELSE conv_reset_at END,
      conv_warned = CASE WHEN date_trunc('month', conv_reset_at) < date_trunc('month', NOW())
                         THEN FALSE ELSE conv_warned END
    WHERE id=$1
    RETURNING conv_count, plan, email, name, conv_warned
  `, [clinic_id]);
  const r = rows[0];
  if (!r) return { count: 0, limit: null, pct: 0, blocked: false };
  const limit = PLAN_LIMITS[r.plan] ?? null;
  const count = r.conv_count;
  const pct = limit ? Math.round(count / limit * 100) : 0;
  const blocked = limit ? count > limit : false;
  return { count, limit, pct, blocked, email: r.email, name: r.name, plan: r.plan, warned: r.conv_warned };
}

async function saveMessage({ clinic_id, session_id, direction, content, from_number, responded_by = 'ai' }) {
  await pool.query(
    'INSERT INTO messages (clinic_id,session_id,direction,content,from_number,responded_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [clinic_id, session_id, direction, content, from_number || null, responded_by]
  );
}

async function getMessages(clinic_id, session_id, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE clinic_id=$1 AND session_id=$2 ORDER BY created_at ASC LIMIT $3',
    [clinic_id, session_id, limit]
  );
  return rows;
}

async function getRecentConversations(clinic_id, limit = 30) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (session_id)
      session_id, from_number, content, direction, responded_by, created_at
    FROM messages
    WHERE clinic_id=$1
    ORDER BY session_id, created_at DESC
  `, [clinic_id]);
  // Ordenar por created_at DESC y limitar en JS (DISTINCT ON requiere ORDER BY session_id primero)
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
}

async function setConvState(session_id, clinic_id, { manual_mode, priority, notes, status, last_msg_at } = {}) {
  await pool.query(`
    INSERT INTO conv_states (session_id, clinic_id, manual_mode, priority, notes, status, last_msg_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), NOW())
    ON CONFLICT (session_id) DO UPDATE
      SET manual_mode = COALESCE($3, conv_states.manual_mode),
          priority    = COALESCE($4, conv_states.priority),
          notes       = COALESCE($5, conv_states.notes),
          status      = COALESCE($6, conv_states.status),
          last_msg_at = COALESCE($7, conv_states.last_msg_at),
          updated_at  = NOW()
  `, [session_id, clinic_id, manual_mode ?? null, priority ?? null, notes ?? null, status ?? null, last_msg_at ?? null]);
}

// Cierra conversaciones sin actividad — llamado por cron interno
async function closeInactiveConversations(inactiveMinutes = 60) {
  const { rows } = await pool.query(`
    UPDATE conv_states SET status='closed', updated_at=NOW()
    WHERE status='open'
      AND last_msg_at < NOW() - ($1 || ' minutes')::INTERVAL
    RETURNING session_id, clinic_id
  `, [inactiveMinutes]);
  return rows;
}

async function getManualSessions() {
  const { rows } = await pool.query('SELECT session_id FROM conv_states WHERE manual_mode = TRUE');
  return rows.map(r => r.session_id);
}

async function getConvNotes(session_id, clinic_id) {
  const { rows } = await pool.query('SELECT notes FROM conv_states WHERE session_id=$1 AND clinic_id=$2', [session_id, clinic_id]);
  return rows[0]?.notes || '';
}

async function savePushSubscription(clinic_id, subscription) {
  await pool.query(`
    INSERT INTO push_subscriptions (clinic_id, endpoint, keys)
    VALUES ($1, $2, $3)
    ON CONFLICT (endpoint) DO UPDATE SET clinic_id=$1, keys=$3
  `, [clinic_id, subscription.endpoint, JSON.stringify(subscription.keys)]);
}

async function getPushSubscriptions(clinic_id) {
  const { rows } = await pool.query('SELECT endpoint, keys FROM push_subscriptions WHERE clinic_id=$1', [clinic_id]);
  return rows.map(r => ({ endpoint: r.endpoint, keys: r.keys }));
}

async function removePushSubscription(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
}

// Construye historial OpenAI directamente desde messages (elimina round-trip a chat_sessions)
async function getHistoryFromMessages(clinic_id, session_id, limit = 30) {
  const { rows } = await pool.query(
    'SELECT direction, content FROM messages WHERE clinic_id=$1 AND session_id=$2 ORDER BY created_at ASC LIMIT $3',
    [clinic_id, session_id, limit]
  );
  return rows.map(r => ({ role: r.direction === 'inbound' ? 'user' : 'assistant', content: r.content }));
}

module.exports = { pool, initDb, getSession, saveSession, saveLead, getClinicByEmail, getClinicByWhatsapp, getClinicBySetupToken, createClinic, updateClinicConfig, buildPromptForClinic, getLeads, saveAppointment, getAppointments, verifyPassword, hashPassword, importLeads, getImportedLeads, updateLeadEstado, incrementConversation, PLAN_LIMITS, saveMessage, getMessages, getRecentConversations, getHistoryFromMessages, setConvState, getManualSessions, getConvNotes, savePushSubscription, getPushSubscriptions, removePushSubscription, closeInactiveConversations };
