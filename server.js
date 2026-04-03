require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const OpenAI = require('openai');
const { pool, initDb, getSession, saveSession, saveLead, getClinicByEmail, getLeads, getAppointments, saveAppointment, verifyPassword } = require('./db');

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

// ── Sistema de prompts ──────────────────────────────────────────────────────

function buildSystemPrompt() {
  const now = new Date();
  const hora = now.getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  const fecha = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return `Eres Natalia, recepcionista virtual de ${process.env.CLINIC_NAME || 'la clínica'}. Eres amable, profesional y eficiente.

Hoy es ${fecha}. El saludo apropiado es "${saludo}".

Tu objetivo es:
1. Responder preguntas sobre la clínica (horarios, servicios, ubicación)
2. Agendar citas recogiendo: tipo de tratamiento → fecha y hora preferida → nombre completo → email (opcional)
3. Reactivar pacientes inactivos con un mensaje cálido

Información de la clínica:
- Nombre: ${process.env.CLINIC_NAME || 'Clínica Demo'}
- Teléfono: ${process.env.CLINIC_PHONE || '+34 900 000 000'}
- Email: ${process.env.CLINIC_EMAIL || 'info@clinica.com'}
- Horario: ${process.env.CLINIC_HOURS || 'Lunes a Viernes 9:00–20:00, Sábados 9:00–14:00'}
- Servicios: ${process.env.CLINIC_SERVICES || 'Consulta general, Medicina estética, Nutrición, Fisioterapia'}

Normas:
- Responde siempre en español, trato de usted
- Sé concisa (máximo 3 párrafos cortos)
- Nunca reveles que eres una IA a menos que te lo pregunten directamente
- Si el paciente confirma una cita, termina tu respuesta con esta línea exacta (no la muestres al paciente):
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
  // Twilio envía form-urlencoded: From=whatsapp:+34..., Body=texto
  const from = req.body.From || '';
  const msg  = (req.body.Body || '').trim();
  const phone = from.replace('whatsapp:', '');

  if (!phone || !msg) {
    return res.type('text/xml').send('<Response></Response>');
  }

  // Validación de token opcional (añade TWILIO_TOKEN en Railway para producción)
  if (process.env.TWILIO_TOKEN && req.headers['x-twilio-signature'] === undefined) {
    return res.status(403).send('Forbidden');
  }

  // Limitar longitud de mensaje
  const safeMsg = msg.slice(0, 500);
  // Session por número de teléfono
  const sessionId = 'wa_' + phone.replace(/\D/g, '').slice(-12);

  try {
    const history = await getSession(sessionId);
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: safeMsg }
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages,
      max_tokens: 350,
      temperature: 0.4
    });

    let reply = completion.choices[0].message.content;

    // Detectar cita confirmada
    const match = reply.match(/CITA_CONFIRMADA\|(.+)/);
    if (match) {
      reply = reply.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
      const parts = Object.fromEntries(match[1].split('|').map(p => p.split('=')));
      await saveAppointment({
        clinic_id: 1,
        patient_name: parts.nombre || 'Paciente WhatsApp',
        patient_phone: phone,
        service: parts.tratamiento || null,
        scheduled_at: `${parts.fecha || ''} ${parts.hora || ''}`.trim()
      }).catch(e => console.error('Appt save:', e.message));
      console.log('[WA] Cita confirmada:', match[1]);
    }

    history.push({ role: 'user', content: safeMsg });
    history.push({ role: 'assistant', content: reply });
    await saveSession(sessionId, history.slice(-20));

    // TwiML — Twilio envía este reply al paciente
    const escapedReply = reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapedReply}</Message></Response>`);

  } catch (err) {
    console.error('[WA] Error:', err.message);
    res.type('text/xml').send('<Response><Message>Lo sentimos, ha ocurrido un error. Por favor intente de nuevo en unos minutos.</Message></Response>');
  }
});

// ── POST /chat ──────────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { session_id, msg } = req.body;
  if (!session_id || !msg || msg.length > 500) return res.status(400).json({ error: 'Parámetros inválidos' });
  const safeId = session_id.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  try {
    const history = await getSession(safeId);
    const messages = [{ role: 'system', content: buildSystemPrompt() }, ...history, { role: 'user', content: msg }];
    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages,
      max_tokens: 350,
      temperature: 0.4
    });
    let reply = completion.choices[0].message.content;
    const match = reply.match(/CITA_CONFIRMADA\|(.+)/);
    if (match) {
      reply = reply.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
      // Parsear y guardar cita
      const parts = Object.fromEntries(match[1].split('|').map(p => p.split('=')));
      await saveAppointment({
        clinic_id: 1, // demo clinic — multi-tenant en fase 2
        patient_name: parts.nombre || 'Paciente',
        patient_phone: null,
        service: parts.tratamiento || null,
        scheduled_at: `${parts.fecha || ''} ${parts.hora || ''}`.trim()
      }).catch(e => console.error('Appt save:', e.message));
      console.log('Cita confirmada:', match[1]);
    }
    history.push({ role: 'user', content: msg });
    history.push({ role: 'assistant', content: reply });
    await saveSession(safeId, history.slice(-20));
    res.json({ reply });
  } catch (err) {
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
