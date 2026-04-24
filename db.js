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
    CREATE TABLE IF NOT EXISTS broadcasts (
      id         SERIAL PRIMARY KEY,
      clinic_id  INTEGER REFERENCES clinics(id),
      name       TEXT,
      message    TEXT NOT NULL,
      segment    TEXT DEFAULT 'all',
      status     TEXT DEFAULT 'pending',
      total      INTEGER DEFAULT 0,
      sent       INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nps_pending (
      id           SERIAL PRIMARY KEY,
      clinic_id    INTEGER REFERENCES clinics(id),
      session_id   TEXT NOT NULL,
      from_number  TEXT NOT NULL,
      scheduled_at TIMESTAMP NOT NULL,
      sent_at      TIMESTAMP,
      score        SMALLINT,
      created_at   TIMESTAMP DEFAULT NOW()
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
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_nps_session ON nps_pending(session_id)`,
    `ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS failed INTEGER DEFAULT 0`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS scheduled_ts TIMESTAMP`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_min INTEGER DEFAULT 60`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_id INTEGER`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`,
    `CREATE INDEX IF NOT EXISTS idx_appointments_clinic_ts ON appointments(clinic_id, scheduled_ts)`,
  ];
  for (const sql of migrations) await pool.query(sql);

  // F5: Roles + Audit
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_members (
      id           SERIAL PRIMARY KEY,
      clinic_id    INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'staff',
      active       BOOLEAN DEFAULT TRUE,
      created_at   TIMESTAMP DEFAULT NOW(),
      UNIQUE(clinic_id, email)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         SERIAL PRIMARY KEY,
      clinic_id  INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
      actor_id   INTEGER,
      actor_type TEXT DEFAULT 'owner',
      actor_name TEXT,
      action     TEXT NOT NULL,
      entity     TEXT,
      entity_id  TEXT,
      meta       JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_clinic ON audit_logs(clinic_id, created_at DESC)`);

  // RGPD consent
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gdpr_consents (
      id           SERIAL PRIMARY KEY,
      clinic_id    INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
      phone        TEXT NOT NULL,
      channel      TEXT DEFAULT 'whatsapp',
      consented_at TIMESTAMP DEFAULT NOW(),
      source       TEXT DEFAULT 'inbound',
      ip           TEXT,
      UNIQUE(clinic_id, phone)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gdpr_clinic ON gdpr_consents(clinic_id, consented_at DESC)`);
  await pool.query(`ALTER TABLE imported_leads ADD COLUMN IF NOT EXISTS gdpr_consent BOOLEAN DEFAULT FALSE`);

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

async function getAnalytics(clinic_id) {
  const [msgs, appts, resolution, daily, avgResp] = await Promise.all([
    // Mensajes este mes + semana pasada (para trend)
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))                      AS month_total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')                       AS week_total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days'
                           AND created_at <  NOW() - INTERVAL '7 days')                       AS prev_week
      FROM messages WHERE clinic_id=$1 AND direction='inbound'
    `, [clinic_id]),

    // Citas este mes
    pool.query(`
      SELECT COUNT(*) AS total FROM appointments
      WHERE clinic_id=$1 AND created_at >= date_trunc('month', NOW())
    `, [clinic_id]),

    // Resolución IA: sesiones sin manual este mes / total sesiones este mes
    pool.query(`
      SELECT
        COUNT(DISTINCT session_id)                                                              AS total_sessions,
        COUNT(DISTINCT session_id) FILTER (
          WHERE session_id NOT IN (
            SELECT session_id FROM conv_states WHERE clinic_id=$1 AND manual_mode=TRUE
          )
        )                                                                                       AS ia_sessions
      FROM messages WHERE clinic_id=$1 AND created_at >= date_trunc('month', NOW())
    `, [clinic_id]),

    // Mensajes por día últimos 7 días
    pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', created_at), 'Dy') AS day,
        COUNT(*)                                       AS cnt
      FROM messages
      WHERE clinic_id=$1 AND direction='inbound' AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('day', created_at), day
      ORDER BY DATE_TRUNC('day', created_at)
    `, [clinic_id]),

    // Tiempo medio respuesta IA (segundos)
    pool.query(`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (o.created_at - i.created_at))))::INT AS avg_secs
      FROM messages i
      JOIN LATERAL (
        SELECT created_at FROM messages
        WHERE clinic_id=$1 AND session_id=i.session_id
          AND direction='outbound' AND responded_by='ai' AND created_at > i.created_at
        ORDER BY created_at LIMIT 1
      ) o ON TRUE
      WHERE i.clinic_id=$1 AND i.direction='inbound'
        AND i.created_at >= date_trunc('month', NOW())
    `, [clinic_id]),
  ]);

  const m = msgs.rows[0];
  const r = resolution.rows[0];
  const totalSess = parseInt(r.total_sessions) || 0;
  const iaSess   = parseInt(r.ia_sessions)    || 0;
  const weekTotal = parseInt(m.week_total)    || 0;
  const prevWeek  = parseInt(m.prev_week)     || 1;
  const weekTrend = prevWeek ? Math.round((weekTotal - prevWeek) / prevWeek * 100) : 0;

  return {
    month_messages : parseInt(m.month_total) || 0,
    week_messages  : weekTotal,
    week_trend_pct : weekTrend,
    ia_resolution  : totalSess ? Math.round(iaSess / totalSess * 100) : 0,
    citas_mes      : parseInt(appts.rows[0].total) || 0,
    avg_response_s : parseInt(avgResp.rows[0]?.avg_secs) || 0,
    daily          : daily.rows, // [{day, cnt}]
  };
}

// Construye historial OpenAI directamente desde messages (elimina round-trip a chat_sessions)
async function getHistoryFromMessages(clinic_id, session_id, limit = 30) {
  const { rows } = await pool.query(
    'SELECT direction, content FROM messages WHERE clinic_id=$1 AND session_id=$2 ORDER BY created_at ASC LIMIT $3',
    [clinic_id, session_id, limit]
  );
  return rows.map(r => ({ role: r.direction === 'inbound' ? 'user' : 'assistant', content: r.content }));
}

// ── F3: CRM / Retención ───────────────────────────────────────────────────────

async function getPatientData(clinic_id, phone) {
  const clean = (phone || '').replace(/\D/g, '').slice(-9);
  const [appts, lead] = await Promise.all([
    pool.query(
      `SELECT service, scheduled_at, created_at FROM appointments
       WHERE clinic_id=$1 AND right(regexp_replace(coalesce(patient_phone,''),'\\D','','g'),9)=$2
       ORDER BY scheduled_at DESC LIMIT 5`,
      [clinic_id, clean]
    ),
    pool.query(
      `SELECT nombre, email, ultima_visita, servicio, notas, estado FROM imported_leads
       WHERE clinic_id=$1 AND right(regexp_replace(coalesce(telefono,''),'\\D','','g'),9)=$2 LIMIT 1`,
      [clinic_id, clean]
    ),
  ]);
  return { appointments: appts.rows, lead: lead.rows[0] || null };
}

async function getAtRiskPatients(clinic_id) {
  // ultima_visita stored as DD/MM/YYYY — convert via TO_DATE before comparing
  const { rows } = await pool.query(`
    SELECT id, nombre, telefono, email, ultima_visita, servicio
    FROM imported_leads
    WHERE clinic_id=$1
      AND ultima_visita IS NOT NULL AND ultima_visita <> ''
      AND TO_DATE(ultima_visita, 'DD/MM/YYYY') < NOW() - INTERVAL '90 days'
      AND estado != 'contactado'
    ORDER BY TO_DATE(ultima_visita, 'DD/MM/YYYY') ASC LIMIT 100
  `, [clinic_id]);
  return rows;
}

async function scheduleNps(clinic_id, session_id, from_number, delayHours = 24) {
  await pool.query(`
    INSERT INTO nps_pending (clinic_id, session_id, from_number, scheduled_at)
    VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)
    ON CONFLICT (session_id) DO NOTHING
  `, [clinic_id, session_id, from_number, delayHours]);
}

async function getPendingNps() {
  const { rows } = await pool.query(`
    SELECT np.id, np.clinic_id, np.session_id, np.from_number,
           c.config, c.name AS clinic_name
    FROM nps_pending np
    JOIN clinics c ON c.id = np.clinic_id
    WHERE np.sent_at IS NULL AND np.scheduled_at <= NOW()
    LIMIT 50
  `);
  return rows;
}

async function markNpsSent(id) {
  await pool.query('UPDATE nps_pending SET sent_at=NOW() WHERE id=$1', [id]);
}

async function saveNpsScore(session_id, score) {
  await pool.query('UPDATE nps_pending SET score=$1 WHERE session_id=$2 AND score IS NULL', [score, session_id]);
}

// ── F4: Broadcast ─────────────────────────────────────────────────────────────

async function createBroadcast(clinic_id, { name, message, segment }) {
  const { rows } = await pool.query(
    'INSERT INTO broadcasts (clinic_id, name, message, segment) VALUES ($1,$2,$3,$4) RETURNING *',
    [clinic_id, name || null, message, segment || 'all']
  );
  return rows[0];
}

async function getBroadcasts(clinic_id) {
  const { rows } = await pool.query(
    'SELECT * FROM broadcasts WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 20',
    [clinic_id]
  );
  return rows;
}

async function updateBroadcast(id, { status, sent, total, failed } = {}) {
  await pool.query(
    'UPDATE broadcasts SET status=COALESCE($2,status), sent=COALESCE($3,sent), total=COALESCE($4,total), failed=COALESCE($5,failed) WHERE id=$1',
    [id, status ?? null, sent ?? null, total ?? null, failed ?? null]
  );
}

async function getUpcomingAppointments() {
  const { rows } = await pool.query(`
    SELECT a.*, c.config, c.name AS clinic_name, c.id AS cid
    FROM appointments a
    JOIN clinics c ON c.id = a.clinic_id
    WHERE a.reminder_sent = FALSE AND a.patient_phone IS NOT NULL
    ORDER BY a.created_at DESC LIMIT 300
  `);
  const now = Date.now();
  return rows.filter(a => {
    const d = new Date(a.scheduled_at);
    if (isNaN(d)) return false;
    const diff = d - now;
    return diff > 23 * 3600000 && diff < 25 * 3600000;
  });
}

async function markReminderSent(id) {
  await pool.query('UPDATE appointments SET reminder_sent=TRUE WHERE id=$1', [id]);
}

async function getAtRiskForAutoReact(clinic_id) {
  const cutoff = new Date(Date.now() - 90 * 24 * 3600000).toISOString().slice(0, 10);
  const { rows } = await pool.query(`
    SELECT id, nombre, telefono, ultima_visita, servicio
    FROM imported_leads
    WHERE clinic_id=$1 AND estado='pendiente'
      AND ultima_visita IS NOT NULL AND ultima_visita < $2
      AND telefono IS NOT NULL
    LIMIT 50
  `, [clinic_id, cutoff]);
  return rows;
}

async function markLeadsContactado(ids) {
  if (!ids.length) return;
  await pool.query(`UPDATE imported_leads SET estado='contactado' WHERE id = ANY($1)`, [ids]);
}

// ── RGPD ──────────────────────────────────────────────────────────────────────

async function recordConsent(clinic_id, phone, source = 'inbound', ip = null) {
  const clean = (phone || '').replace(/\D/g, '').slice(-9);
  await pool.query(`
    INSERT INTO gdpr_consents (clinic_id, phone, source, ip)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (clinic_id, phone) DO NOTHING
  `, [clinic_id, clean, source, ip]);
}

async function hasConsent(clinic_id, phone) {
  const clean = (phone || '').replace(/\D/g, '').slice(-9);
  const { rows } = await pool.query(
    `SELECT id FROM gdpr_consents WHERE clinic_id=$1 AND phone=$2 LIMIT 1`,
    [clinic_id, clean]
  );
  return rows.length > 0;
}

async function getConsents(clinic_id) {
  const { rows } = await pool.query(
    `SELECT phone, channel, source, consented_at FROM gdpr_consents WHERE clinic_id=$1 ORDER BY consented_at DESC`,
    [clinic_id]
  );
  return rows;
}

async function revokeConsent(clinic_id, phone) {
  const clean = (phone || '').replace(/\D/g, '').slice(-9);
  await pool.query(`DELETE FROM gdpr_consents WHERE clinic_id=$1 AND phone=$2`, [clinic_id, clean]);
}

// ── F5: Roles + Audit ─────────────────────────────────────────────────────────

async function createStaff(clinic_id, { name, email, password, role }) {
  const { rows } = await pool.query(
    `INSERT INTO staff_members (clinic_id, name, email, password_hash, role)
     VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role,active,created_at`,
    [clinic_id, name, email, hashPassword(password), role || 'staff']
  );
  return rows[0];
}

async function getStaff(clinic_id) {
  const { rows } = await pool.query(
    `SELECT id,name,email,role,active,created_at FROM staff_members WHERE clinic_id=$1 ORDER BY created_at ASC`,
    [clinic_id]
  );
  return rows;
}

async function getStaffByEmail(clinic_id, email) {
  const { rows } = await pool.query(
    `SELECT * FROM staff_members WHERE clinic_id=$1 AND email=$2 AND active=TRUE LIMIT 1`,
    [clinic_id, email.toLowerCase().trim()]
  );
  return rows[0] || null;
}

async function updateStaffRole(id, clinic_id, role) {
  await pool.query(`UPDATE staff_members SET role=$1 WHERE id=$2 AND clinic_id=$3`, [role, id, clinic_id]);
}

async function deactivateStaff(id, clinic_id) {
  await pool.query(`UPDATE staff_members SET active=FALSE WHERE id=$1 AND clinic_id=$2`, [id, clinic_id]);
}

async function auditLog(clinic_id, actor, action, entity, entity_id, meta = {}) {
  await pool.query(
    `INSERT INTO audit_logs (clinic_id, actor_id, actor_type, actor_name, action, entity, entity_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [clinic_id, actor?.id || null, actor?.type || 'owner', actor?.name || null, action, entity || null, entity_id ? String(entity_id) : null, JSON.stringify(meta)]
  );
}

async function getAuditLogs(clinic_id, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM audit_logs WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [clinic_id, limit]
  );
  return rows;
}

// ── Calendar ──────────────────────────────────────────────────────────────────

async function getAppointmentsByRange(clinic_id, start, end) {
  const { rows } = await pool.query(`
    SELECT * FROM appointments
    WHERE clinic_id=$1 AND scheduled_ts >= $2 AND scheduled_ts < $3
    ORDER BY scheduled_ts ASC
  `, [clinic_id, start, end]);
  return rows;
}

async function createAppointmentFull({ clinic_id, patient_name, patient_phone, service, scheduled_ts, duration_min, notes, patient_id, source }) {
  const { rows } = await pool.query(
    `INSERT INTO appointments (clinic_id, patient_name, patient_phone, service, scheduled_ts, duration_min, notes, patient_id, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`,
    [clinic_id, patient_name||null, patient_phone||null, service||null, scheduled_ts, duration_min||60, notes||null, patient_id||null, source||'manual']
  );
  return rows[0];
}

async function updateAppointmentFull(id, clinic_id, { patient_name, patient_phone, service, scheduled_ts, duration_min, notes, status }) {
  const { rows } = await pool.query(
    `UPDATE appointments SET
       patient_name=COALESCE($3,patient_name), patient_phone=COALESCE($4,patient_phone),
       service=COALESCE($5,service), scheduled_ts=COALESCE($6,scheduled_ts),
       duration_min=COALESCE($7,duration_min), notes=COALESCE($8,notes),
       status=COALESCE($9,status)
     WHERE id=$1 AND clinic_id=$2 RETURNING *`,
    [id, clinic_id, patient_name??null, patient_phone??null, service??null, scheduled_ts??null, duration_min??null, notes??null, status??null]
  );
  return rows[0] || null;
}

async function deleteAppointment(id, clinic_id) {
  const { rowCount } = await pool.query('DELETE FROM appointments WHERE id=$1 AND clinic_id=$2', [id, clinic_id]);
  return rowCount > 0;
}

module.exports = { pool, initDb, createBroadcast, getBroadcasts, updateBroadcast, getUpcomingAppointments, markReminderSent, getAtRiskForAutoReact, markLeadsContactado, getAnalytics, getSession, saveSession, saveLead, getClinicByEmail, getClinicByWhatsapp, getClinicBySetupToken, createClinic, updateClinicConfig, buildPromptForClinic, getLeads, saveAppointment, getAppointments, verifyPassword, hashPassword, importLeads, getImportedLeads, updateLeadEstado, incrementConversation, PLAN_LIMITS, saveMessage, getMessages, getRecentConversations, getHistoryFromMessages, setConvState, getManualSessions, getConvNotes, savePushSubscription, getPushSubscriptions, removePushSubscription, closeInactiveConversations, getPatientData, getAtRiskPatients, scheduleNps, getPendingNps, markNpsSent, saveNpsScore, getAppointmentsByRange, createAppointmentFull, updateAppointmentFull, deleteAppointment, createStaff, getStaff, getStaffByEmail, updateStaffRole, deactivateStaff, auditLog, getAuditLogs, recordConsent, hasConsent, getConsents, revokeConsent };
