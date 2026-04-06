require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const OpenAI = require('openai');
const crypto = require('crypto');
const { pool, initDb, getSession, saveSession, saveLead, getClinicByEmail, getClinicByWhatsapp, getClinicBySetupToken, createClinic, updateClinicConfig, buildPromptForClinic, getLeads, getAppointments, saveAppointment, verifyPassword, hashPassword, importLeads, getImportedLeads, updateLeadEstado } = require('./db');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new PgSession({ pool, tableName: 'web_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'cliniflux-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true }
}));
app.use(express.static('public'));

// ── Auth middleware ─────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.clinic) return next();
  res.redirect('/login');
}

// ── Demo prompt (BarnaDental) — usado por /demo y /webhook sin clinic_id ───
function buildDemoPrompt() {
  const now = new Date();
  const hora = now.getHours();
  const saludo = hora < 12 ? '¡Buenos días!' : hora < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';
  const fecha = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `Eres Natalia, la recepcionista de BarnaDental. Hoy es ${fecha}.

PERSONALIDAD: Eres cercana, cálida y natural — como una persona real que coge el teléfono, no un bot. Usas un tono conversacional con pequeñas muestras de empatía ("Perfecto", "Claro que sí", "No se preocupe", "¡Qué bien!"). Nunca suenas robótica ni formal en exceso.

PRIMER MENSAJE: Saluda siempre con "${saludo} Soy Natalia, de BarnaDental 😊 ¿En qué le puedo ayudar?"

CLÍNICA: BarnaDental · Carrer de València 245, Barcelona (cerca de Paseo de Gracia)
📞 +34 932 123 456 · info@barnadental.cat
🚇 Metro Diagonal (L3/L5) · 🅿️ 1h gratis en parking de Carrer d'Aragó

HORARIO: Lunes a viernes 9:00–20:30 · Sábados 10:00–14:00 (concertadas) · Domingos cerrado · 2ª quincena agosto: vacaciones

SERVICIOS:
- Higiene dental: 55€ (incluye revisión y radiografía si hace falta)
- Blanqueamiento LED: 280€ (sesión única)
- Invisalign: desde 2.900€ — primera valoración GRATIS
- Implante: desde 850€ (corona aparte, se presupuesta)
- Urgencias: 40€ visita diagnóstico
- Primera visita diagnóstico y presupuesto: GRATUITA

EQUIPO: Dra. Laia Puig (Implantología) · Dr. Marc Soler (Ortodoncia y Estética)
SEGUROS: Adeslas, Sanitas, Mapfre. Otras: consultar.

CÓMO GESTIONAR CITAS:
1. Recoge con naturalidad: nombre → servicio → franja horaria preferida
2. Di que Marta les llamará en menos de 30 minutos para confirmar el hueco exacto
3. Cancelaciones: avisar con 24h mínimo. Recordatorio SMS 48h antes.

NORMAS:
- Responde siempre en español
- Mensajes cortos y naturales (máx 3 párrafos), nada de listas largas
- Nunca inventes precios ni confirmes horario concreto (solo Marta puede)
- Si preguntan algo que no sabes: "Le recomiendo llamarnos al +34 932 123 456, le atendemos encantados"
- Nunca digas que eres una IA salvo pregunta directa
- Puedes usar emojis con moderación (1-2 por mensaje máximo)
- Cuando tengas nombre + servicio + franja horaria del paciente, añade al final (sin mostrarlo):
  CITA_CONFIRMADA|tratamiento=...|fecha=...|hora=...|nombre=...|email=...`;
}

// ── Rutas páginas públicas ──────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile('landing.html', { root: 'public' }));
app.get('/demo', (req, res) => res.sendFile('demo.html', { root: 'public' }));
app.get('/about', (req, res) => res.sendFile('about.html', { root: 'public' }));
app.get('/contacto', (req, res) => res.sendFile('contacto.html', { root: 'public' }));
app.get('/blog', (req, res) => res.sendFile('blog.html', { root: 'public' }));
app.get('/login', (req, res) => {
  if (req.session?.clinic) return res.redirect('/dashboard');
  res.sendFile('login.html', { root: 'public' });
});
app.get('/legal/privacidad', (req, res) => res.sendFile('legal/privacidad.html', { root: 'public' }));
app.get('/legal/terminos', (req, res) => res.sendFile('legal/terminos.html', { root: 'public' }));
app.get('/legal/cookies', (req, res) => res.sendFile('legal/cookies.html', { root: 'public' }));

const FEATURES = ['respuesta-automatica','agenda-inteligente','reactivacion-pacientes','panel-control','implementacion','rgpd'];
FEATURES.forEach(slug => {
  app.get(`/features/${slug}`, (req, res) => res.sendFile(`features/${slug}.html`, { root: 'public' }));
});

// ── Dashboard (protegido) ───────────────────────────────────────────────────

app.get('/dashboard', requireAuth, (req, res) => res.sendFile('dashboard.html', { root: 'public' }));

// ── Admin ───────────────────────────────────────────────────────────────────

app.get('/admin', (req, res) => res.sendFile('admin.html', { root: 'public' }));

app.get('/admin/clinics', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query('SELECT id,name,email,plan,whatsapp_number,created_at FROM clinics ORDER BY created_at DESC');
  res.json(rows);
});

// ── Onboarding ──────────────────────────────────────────────────────────────

// Tú creas el token: GET /admin/new-clinic?secret=ADMIN_SECRET&email=x&name=y&plan=pro
app.get('/admin/new-clinic', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) {
    return res.status(403).send('Forbidden');
  }
  const { email, name, plan } = req.query;
  if (!email || !name) return res.status(400).send('email y name requeridos');
  try {
    const token = crypto.randomBytes(16).toString('hex');
    const tempPass = crypto.randomBytes(8).toString('hex');
    await createClinic({ email, password_hash: hashPassword(tempPass), name, plan: plan||'starter', setup_token: token });
    res.json({ ok: true, setup_url: `/onboarding?token=${token}`, temp_password: tempPass });
  } catch(e) {
    res.status(500).send(e.message);
  }
});

app.get('/onboarding', async (req, res) => {
  const clinic = await getClinicBySetupToken(req.query.token).catch(() => null);
  if (!clinic) return res.redirect('/login');
  res.sendFile('onboarding.html', { root: 'public' });
});

app.post('/api/onboarding', async (req, res) => {
  const { token, phone, address, hours, services, extra, assistant_name, whatsapp_number, new_password } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  try {
    const clinic = await getClinicBySetupToken(token);
    if (!clinic) return res.status(404).json({ error: 'Token inválido o ya usado' });
    const config = { phone, address, hours, services, extra, assistant_name: assistant_name||'Natalia', email: clinic.email };
    await updateClinicConfig(clinic.id, config);
    if (whatsapp_number) {
      await pool.query('UPDATE clinics SET whatsapp_number=$1 WHERE id=$2', [whatsapp_number, clinic.id]);
    }
    if (new_password) {
      await pool.query('UPDATE clinics SET password_hash=$1 WHERE id=$2', [hashPassword(new_password), clinic.id]);
    }
    res.json({ ok: true });
  } catch(e) {
    console.error('Onboarding:', e.message);
    res.status(500).json({ error: 'Error guardando configuración' });
  }
});

// ── Auth routes ─────────────────────────────────────────────────────────────

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Campos requeridos' });
  try {
    const clinic = await getClinicByEmail(email.toLowerCase().trim());
    if (!clinic || !verifyPassword(password, clinic.password_hash)) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    req.session.clinic = { id: clinic.id, name: clinic.name, email: clinic.email };
    res.json({ ok: true, name: clinic.name });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── API dashboard (protegida) ───────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  if (!req.session?.clinic) return res.status(401).json({ error: 'No autenticado' });
  res.json(req.session.clinic);
});

app.get('/api/dashboard/leads', requireAuth, async (req, res) => {
  try {
    const leads = await getLeads(50);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// ── Importar leads (CSV raw text) ───────────────────────────────────────────
app.post('/api/leads/import', requireAuth, async (req, res) => {
  try {
    const { csv } = req.body; // cliente envía el texto del CSV
    if (!csv) return res.status(400).json({ error: 'CSV vacío' });
    const lines = csv.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV sin datos' });
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase()
      .replace('úl','ul').replace('ú','u').replace('é','e').replace('ó','o'));
    const rows = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cols[i] || null; });
      return {
        nombre: obj.nombre || obj.name || null,
        telefono: obj.telefono || obj.phone || obj.tel || null,
        email: obj.email || null,
        ultima_visita: obj['ultima visita'] || obj.ultima_visita || obj.fecha || null,
        servicio: obj.servicio || obj.tratamiento || obj.service || null,
        notas: obj.notas || obj.notes || null
      };
    }).filter(r => r.nombre || r.telefono || r.email);
    const count = await importLeads(req.session.clinic.id, rows);
    res.json({ ok: true, imported: count });
  } catch (err) {
    console.error('Import error:', err.message);
    res.status(500).json({ error: 'Error importando' });
  }
});

app.get('/api/leads/imported', requireAuth, async (req, res) => {
  try { res.json(await getImportedLeads(req.session.clinic.id)); }
  catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.patch('/api/leads/imported/:id', requireAuth, async (req, res) => {
  try {
    await updateLeadEstado(req.params.id, req.body.estado);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// Exportar a CSV (compatible Google Sheets)
app.get('/api/leads/export', requireAuth, async (req, res) => {
  try {
    const leads = await getImportedLeads(req.session.clinic.id);
    const header = 'nombre,telefono,email,ultima_visita,servicio,notas,estado,creado';
    const rows = leads.map(l =>
      [l.nombre,l.telefono,l.email,l.ultima_visita,l.servicio,l.notas,l.estado,
        new Date(l.created_at).toLocaleDateString('es-ES')]
      .map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',')
    );
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="leads-reactivacion.csv"');
    res.send('\uFEFF' + [header,...rows].join('\n')); // BOM para Excel/Sheets
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/dashboard/appointments', requireAuth, async (req, res) => {
  try {
    const appts = await getAppointments(req.session.clinic.id, 20);
    res.json(appts);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// ── POST /webhook/whatsapp (Twilio) ────────────────────────────────────────

app.post('/webhook/whatsapp', async (req, res) => {
  const from  = (req.body.From || '').replace('whatsapp:', '');
  const to    = (req.body.To   || '').replace('whatsapp:', '');
  const msg   = (req.body.Body || '').trim().slice(0, 500);
  if (!from || !msg) return res.type('text/xml').send('<Response></Response>');

  // Identificar clínica por número destino (multi-tenant)
  const clinic = to ? await getClinicByWhatsapp(to).catch(() => null) : null;
  const prompt = clinic ? buildPromptForClinic(clinic) : buildDemoPrompt();
  const clinicId = clinic?.id || 1;
  const sessionId = `wa_${clinicId}_` + from.replace(/\D/g,'').slice(-10);

  try {
    const history = await getSession(sessionId);
    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [{ role:'system', content: prompt }, ...history, { role:'user', content: msg }],
      max_tokens: 350, temperature: 0.4
    });
    let reply = completion.choices[0].message.content;
    const match = reply.match(/CITA_CONFIRMADA\|(.+)/);
    if (match) {
      reply = reply.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
      const parts = Object.fromEntries(match[1].split('|').map(p => p.split('=')));
      await saveAppointment({ clinic_id: clinicId, patient_name: parts.nombre||'Paciente', patient_phone: from, service: parts.tratamiento||null, scheduled_at: `${parts.fecha||''} ${parts.hora||''}`.trim() }).catch(e => console.error('Appt:', e.message));
    }
    history.push({ role:'user', content: msg });
    history.push({ role:'assistant', content: reply });
    await saveSession(sessionId, history.slice(-20));
    const safe = reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`);
  } catch(err) {
    console.error('[WA]', err.message);
    res.type('text/xml').send('<Response><Message>Lo sentimos, ha ocurrido un error. Inténtelo de nuevo en unos minutos.</Message></Response>');
  }
});

// ── POST /chat ──────────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { session_id, msg, clinic_id } = req.body;
  if (!session_id || !msg || msg.length > 500) return res.status(400).json({ error: 'Parámetros inválidos' });
  const safeId = session_id.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  // Obtener prompt según clínica (demo usa BarnaDental por defecto)
  let prompt = buildDemoPrompt();
  let clinicId = 1;
  if (clinic_id && Number.isInteger(+clinic_id)) {
    const { rows } = await pool.query('SELECT * FROM clinics WHERE id=$1', [+clinic_id]).catch(() => ({ rows: [] }));
    if (rows[0]) { prompt = buildPromptForClinic(rows[0]); clinicId = rows[0].id; }
  }
  try {
    const history = await getSession(safeId);
    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [{ role:'system', content: prompt }, ...history, { role:'user', content: msg }],
      max_tokens: 350, temperature: 0.4
    });
    let reply = completion.choices[0].message.content;
    const match = reply.match(/CITA_CONFIRMADA\|(.+)/);
    if (match) {
      reply = reply.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
      const parts = Object.fromEntries(match[1].split('|').map(p => p.split('=')));
      await saveAppointment({ clinic_id: clinicId, patient_name: parts.nombre||'Paciente', patient_phone: null, service: parts.tratamiento||null, scheduled_at: `${parts.fecha||''} ${parts.hora||''}`.trim() }).catch(e => console.error('Appt:', e.message));
    }
    history.push({ role:'user', content: msg });
    history.push({ role:'assistant', content: reply });
    await saveSession(safeId, history.slice(-20));
    res.json({ reply });
  } catch(err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/contact ───────────────────────────────────────────────────────

app.post('/api/contact', async (req, res) => {
  const { nombre, clinica, email, telefono, tipo, mensaje } = req.body;
  if (!nombre || !email || !tipo) return res.status(400).json({ error: 'Campos requeridos' });
  try { await saveLead({ nombre, clinica, email, telefono, tipo, mensaje, source: 'contacto' }); } catch(e) { console.error('Lead save:', e.message); }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      await t.sendMail({
        from: '"Cliniflux Web" <' + process.env.SMTP_USER + '>',
        to: 'contacto@cliniflux.com',
        replyTo: email,
        subject: '[Contacto Web] ' + tipo + ' - ' + nombre + ' (' + (clinica||'-') + ')',
        html: '<h2>Nuevo contacto</h2><p><b>Nombre:</b> ' + nombre + '</p><p><b>Clínica:</b> ' + (clinica||'-') + '</p><p><b>Email:</b> ' + email + '</p><p><b>Teléfono:</b> ' + (telefono||'-') + '</p><p><b>Tipo:</b> ' + tipo + '</p><p><b>Mensaje:</b> ' + (mensaje||'-') + '</p>'
      });
    } catch(e) { console.error('Email error:', e.message); }
  }
  res.json({ ok: true });
});

app.post('/api/demo-request', async (req, res) => {
  try { await saveLead(req.body); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: 'Error' }); }
});

// ── Arrancar ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Cliniflux en http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
