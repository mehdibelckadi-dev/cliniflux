require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const OpenAI = require('openai');
const { pool, initDb, getSession, saveSession, saveLead, getClinicByEmail, getLeads, getAppointments, saveAppointment, verifyPassword, importLeads, getImportedLeads, updateLeadEstado } = require('./db');

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

  return `Eres Natalia, recepcionista virtual de BarnaDental. Eres amable, profesional y hablas con naturalidad. Hoy es ${fecha}. Saluda con "${saludo}".

CLÍNICA:
- Nombre: BarnaDental
- Dirección: Carrer de València, 245, 08007 Barcelona (cerca de Paseo de Gracia)
- Teléfono: +34 932 123 456
- Email: info@barnadental.cat
- Metro: Diagonal (L3/L5) o FGC Provença
- Parking: 1h gratis para pacientes en Parking de Carrer d'Aragó

HORARIOS:
- Lunes a Viernes: 09:00 – 20:30 (ininterrumpido)
- Sábados: 10:00 – 14:00 (solo visitas concertadas)
- Domingos: cerrado
- Agosto: cerramos la segunda quincena por vacaciones

SERVICIOS Y PRECIOS:
- Higiene dental: 55€ (incluye revisión y radiografía panorámica si es necesario)
- Blanqueamiento LED: 280€ (sesión única en clínica)
- Invisalign / Ortodoncia invisible: desde 2.900€ (valoración gratuita previa)
- Implante dental: desde 850€ (implante; corona aparte, se presupuesta)
- Urgencias dentales: 40€ visita diagnóstico (en horario comercial)
- Primera visita de diagnóstico y presupuesto: GRATUITA

EQUIPO:
- Dra. Laia Puig: Directora médica, especialista en Implantología
- Dr. Marc Soler: Especialista en Ortodoncia Invisible y Estética Dental

SEGUROS: Adeslas, Sanitas y Mapfre. Otras aseguradoras consultar.

PROTOCOLO DE CITAS:
1. Recoge: nombre completo → servicio de interés → franja horaria preferida
2. Informa que Marta (secretaria) llamará en menos de 30 min para confirmar el hueco exacto
3. Cancelaciones: avisar con mínimo 24h de antelación
4. Se envía SMS recordatorio 48h antes de la cita

NORMAS ESTRICTAS:
- Responde siempre en español, trato de usted
- Máximo 3 párrafos cortos por respuesta
- Nunca inventes precios, servicios ni disponibilidades que no estén aquí
- Nunca confirmes un horario concreto (solo Marta puede hacerlo)
- Si preguntan por algo no listado, di "le recomiendo llamarnos al +34 932 123 456"
- Nunca digas que eres una IA salvo que te lo pregunten directamente
- Cuando el paciente dé su nombre, servicio y franja horaria, termina con esta línea exacta (invisible para el paciente):
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
