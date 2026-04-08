require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const OpenAI = require('openai');
const crypto = require('crypto');
const Stripe = require('stripe');
const { pool, initDb, getSession, saveSession, saveLead, getClinicByEmail, getClinicByWhatsapp, getClinicBySetupToken, createClinic, updateClinicConfig, buildPromptForClinic, getLeads, getAppointments, saveAppointment, verifyPassword, hashPassword, importLeads, getImportedLeads, updateLeadEstado } = require('./db');

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const nodemailer = require('nodemailer');

function getMailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendEmail({ to, subject, html, replyTo }) {
  const t = getMailTransport();
  if (!t) return;
  const from = process.env.EMAIL_FROM || `"Cliniflux" <${process.env.SMTP_USER}>`;
  try {
    await t.sendMail({ from, to, subject, html, replyTo });
  } catch(e) { console.error('Email error:', e.message); }
}

// ── Plantillas de email ──────────────────────────────────────────────────────
const EMAIL_BASE = (content) => `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#f8f9fb;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif}
.wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07)}
.hd{background:linear-gradient(135deg,#14532d,#16a34a);padding:32px 40px}
.logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-.5px;text-decoration:none}
.body{padding:36px 40px}
h1{font-size:22px;font-weight:700;color:#0f172a;margin:0 0 12px;letter-spacing:-.4px}
p{font-size:15px;color:rgba(15,23,42,.65);line-height:1.75;margin:0 0 16px}
.btn{display:inline-block;background:#16a34a;color:#fff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:40px;text-decoration:none;margin:8px 0 24px}
.note{font-size:13px;color:rgba(15,23,42,.4);background:#f8f9fb;border-radius:8px;padding:14px 16px;margin-top:16px}
.ft{padding:20px 40px;border-top:1px solid rgba(0,0,0,.07);font-size:12px;color:rgba(15,23,42,.35);text-align:center}
.tag{display:inline-block;background:rgba(22,163,74,.1);color:#15803d;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;letter-spacing:.3px;margin-bottom:20px}
.row{display:flex;gap:8px;margin-bottom:10px}
.label{font-size:13px;font-weight:600;color:#0f172a;min-width:100px}
.value{font-size:13px;color:rgba(15,23,42,.6)}</style></head>
<body><div class="wrap">
<div class="hd"><span class="logo">cliniflux</span></div>
<div class="body">${content}</div>
<div class="ft">© 2025 Cliniflux · <a href="https://cliniflux.com" style="color:inherit">cliniflux.com</a></div>
</div></body></html>`;

function emailSetupLink(name, plan, setupUrl) {
  const planLabel = { starter: 'Starter', pro: 'Pro', clinica: 'Clínica' }[plan] || plan;
  return EMAIL_BASE(`
<div class="tag">Plan ${planLabel} activado</div>
<h1>¡Bienvenido/a a Cliniflux!</h1>
<p>Hola ${name.split(' ')[0]},</p>
<p>Tu suscripción está activa. Solo necesitas configurar tu clínica para que Natalia empiece a atender pacientes en WhatsApp.</p>
<p>El proceso dura menos de 5 minutos:</p>
<a href="${setupUrl}" class="btn">Configurar mi clínica →</a>
<div class="note">Este enlace es único y caduca tras su primer uso. Si tienes algún problema, responde a este email.</div>`);
}

function emailContactNotification({ nombre, clinica, email, telefono, tipo, mensaje }) {
  return EMAIL_BASE(`
<div class="tag">Nuevo contacto web</div>
<h1>${tipo}</h1>
<div class="row"><span class="label">Nombre</span><span class="value">${nombre}</span></div>
<div class="row"><span class="label">Clínica</span><span class="value">${clinica||'—'}</span></div>
<div class="row"><span class="label">Email</span><span class="value"><a href="mailto:${email}" style="color:#16a34a">${email}</a></span></div>
<div class="row"><span class="label">Teléfono</span><span class="value">${telefono||'—'}</span></div>
${mensaje ? `<div class="note">${mensaje}</div>` : ''}`);
}

function emailWelcomeOnboarding(clinicName, loginUrl) {
  return EMAIL_BASE(`
<div class="tag">Configuración completada</div>
<h1>Tu clínica está lista</h1>
<p>Hola,</p>
<p><strong>${clinicName}</strong> ya está configurada en Cliniflux. Natalia empezará a responder WhatsApp en cuanto conectes tu número de WhatsApp Business.</p>
<a href="${loginUrl}" class="btn">Acceder al panel →</a>
<div class="note">Si necesitas ayuda, escríbenos a <a href="mailto:hola@cliniflux.com" style="color:#16a34a">hola@cliniflux.com</a> y te respondemos en menos de 24h.</div>`);
}

// Stripe price IDs (test mode)
const STRIPE_PRICES = {
  starter: { mes: 'price_1TJuTfCegLT4YskFbMdyTro1', ano: 'price_1TJuUBCegLT4YskFemo6YFZ6' },
  pro:     { mes: 'price_1TJuUiCegLT4YskFgWob0MlZ', ano: 'price_1TJuV2CegLT4YskFsvRnEF7W' },
  clinica: { mes: 'price_1TJuVbCegLT4YskFgiv64JUn', ano: 'price_1TJuWACegLT4YskFwnJvYAIc' }
};

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Seguridad: headers HTTP ─────────────────────────────────────────────────
app.disable('x-powered-by');
app.set('trust proxy', 1); // Railway / proxies: detectar HTTPS correctamente

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ── Rate limiting simple (sin dependencias) ────────────────────────────────
const rateLimits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const entry = rateLimits.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    rateLimits.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: 'Demasiadas solicitudes. Espera un momento.' });
    next();
  };
}
// Limpiar mapa cada hora
setInterval(() => rateLimits.clear(), 3600000);

// ── Stripe webhook (raw body ANTES de express.json) ──────────────────────────
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.sendStatus(503);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const plan = s.metadata?.plan || 'starter';
    const email = s.customer_details?.email || s.metadata?.email || '';
    const name = s.customer_details?.name || email;
    const appBase = process.env.APP_URL || 'https://cliniflux.com';
    console.log(`[Stripe] checkout.session.completed email=${email} plan=${plan}`);
    try {
      // Buscar si ya existe (re-compra o test repetido)
      const existing = await pool.query('SELECT id, setup_token FROM clinics WHERE email=$1', [email]);
      let token;
      if (existing.rows.length) {
        // Reusar o regenerar token para que pueda configurar
        token = crypto.randomBytes(20).toString('hex');
        await pool.query(
          'UPDATE clinics SET plan=$1, setup_token=$2, stripe_customer_id=$3, stripe_subscription_id=$4 WHERE email=$5',
          [plan, token, s.customer, s.subscription, email]
        );
        console.log(`[Stripe] Clínica existente actualizada: ${email}`);
      } else {
        token = crypto.randomBytes(20).toString('hex');
        const tempPass = crypto.randomBytes(8).toString('hex');
        await createClinic({
          email, password_hash: hashPassword(tempPass), name, plan,
          setup_token: token, stripe_customer_id: s.customer, stripe_subscription_id: s.subscription
        });
        console.log(`[Stripe] Nueva clínica creada: ${email}`);
      }
      const setupUrl = `${appBase}/onboarding?token=${token}`;
      console.log(`[Stripe] Enviando email setup a ${email} → ${setupUrl}`);
      await sendEmail({
        to: email,
        subject: '¡Bienvenido/a a Cliniflux! Configura tu clínica ahora',
        html: emailSetupLink(name, plan, setupUrl)
      });
      console.log(`[Stripe] Email enviado OK`);
    } catch (e) {
      console.error('[Stripe] Error procesando pago:', e.message);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    try {
      await pool.query(
        "UPDATE clinics SET plan='cancelado' WHERE stripe_subscription_id=$1",
        [sub.id]
      );
      console.log(`Suscripción cancelada: ${sub.id}`);
    } catch (e) {
      console.error('Error cancelando suscripción:', e.message);
    }
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'web_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'cliniflux-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
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
app.get('/checkout-success', (req, res) => res.sendFile('checkout-success.html', { root: 'public' }));
app.get('/checkout-cancel', (req, res) => res.sendFile('checkout-cancel.html', { root: 'public' }));
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
    const loginUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`) + '/login';
    await sendEmail({
      to: clinic.email,
      subject: `${clinic.name || 'Tu clínica'} ya está lista en Cliniflux`,
      html: emailWelcomeOnboarding(clinic.name || 'Tu clínica', loginUrl)
    });
    res.json({ ok: true });
  } catch(e) {
    console.error('Onboarding:', e.message);
    res.status(500).json({ error: 'Error guardando configuración' });
  }
});

// ── Auth routes ─────────────────────────────────────────────────────────────

app.post('/auth/login', rateLimit(10, 60000), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Campos requeridos' });
  }
  try {
    const clinic = await getClinicByEmail(email.toLowerCase().trim());
    // Siempre verificar (evita timing attack)
    const valid = clinic && verifyPassword(password, clinic.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Error de sesión' });
      req.session.clinic = { id: clinic.id, name: clinic.name, email: clinic.email };
      res.json({ ok: true, name: clinic.name });
    });
  } catch (err) {
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
    const leads = await getLeads(req.session.clinic.id, 50);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// ── Importar leads (CSV raw text) ───────────────────────────────────────────
app.post('/api/leads/import', requireAuth, rateLimit(10, 60000), async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'CSV vacío' });
    if (csv.length > 500000) return res.status(400).json({ error: 'CSV demasiado grande (max 500KB)' });
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

app.post('/chat', rateLimit(30, 60000), async (req, res) => {
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

app.post('/api/contact', rateLimit(5, 60000), async (req, res) => {
  const { nombre, clinica, email, telefono, tipo, mensaje } = req.body;
  if (!nombre || !email || !tipo || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Campos requeridos' });
  }
  try { await saveLead({ nombre, clinica, email, telefono, tipo, mensaje, source: 'contacto' }); } catch(e) { console.error('Lead save:', e.message); }
  await sendEmail({
    to: process.env.EMAIL_NOTIFY || process.env.SMTP_USER || 'hola@cliniflux.com',
    replyTo: email,
    subject: `[Contacto Web] ${tipo} — ${nombre} (${clinica||'-'})`,
    html: emailContactNotification({ nombre, clinica, email, telefono, tipo, mensaje })
  });
  res.json({ ok: true });
});

app.get('/api/settings', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT name,email,plan,whatsapp_number,config FROM clinics WHERE id=$1', [req.session.clinic.id]);
  res.json(rows[0] || {});
});

app.post('/api/settings', requireAuth, async (req, res) => {
  const { name, phone, email_clinic, address, hours, services, extra, assistant_name, whatsapp_number } = req.body;
  try {
    const { rows } = await pool.query('SELECT config FROM clinics WHERE id=$1', [req.session.clinic.id]);
    const cfg = { ...(rows[0]?.config || {}), phone, email: email_clinic, address, hours, services, extra, assistant_name };
    await pool.query('UPDATE clinics SET config=$1, name=COALESCE($2,name), whatsapp_number=COALESCE(NULLIF($3,\'\'),whatsapp_number) WHERE id=$4',
      [JSON.stringify(cfg), name || null, whatsapp_number || '', req.session.clinic.id]);
    req.session.clinic.name = name || req.session.clinic.name;
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings/password', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });
  await pool.query('UPDATE clinics SET password_hash=$1 WHERE id=$2', [hashPassword(password), req.session.clinic.id]);
  res.json({ ok: true });
});

// ── Stripe checkout ──────────────────────────────────────────────────────────
app.post('/api/checkout', rateLimit(20, 60000), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Pagos no configurados' });
  const { plan, billing } = req.body;
  if (!STRIPE_PRICES[plan] || !['mes','ano'].includes(billing))
    return res.status(400).json({ error: 'Plan o ciclo inválido' });

  const priceId = STRIPE_PRICES[plan][billing];
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { plan, billing },
      success_url: `${base}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/checkout-cancel`,
      allow_promotion_codes: true,
      locale: 'es',
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Stripe checkout error:', e.message);
    res.status(500).json({ error: 'Error al crear sesión de pago' });
  }
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
