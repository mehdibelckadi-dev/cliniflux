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

async function sendEmail({ to, subject, html, replyTo }) {
  const from = process.env.EMAIL_FROM || 'Cliniflux <onboarding@resend.dev>';

  // Resend (preferido — HTTP, sin problemas de firewall)
  if (process.env.RESEND_API_KEY) {
    try {
      // Si dominio no verificado, enviar a la cuenta Resend como fallback
      const toAddr = process.env.RESEND_VERIFIED ? to : (process.env.EMAIL_NOTIFY || to);
      const body = { from, to: toAddr, subject: toAddr !== to ? `[PARA: ${to}] ${subject}` : subject, html };
      if (replyTo) body.reply_to = replyTo;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      console.log('Email enviado via Resend:', data.id);
    } catch(e) { console.error('Resend error:', e.message); }
    return;
  }

  // Fallback SMTP (nodemailer)
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const port = parseInt(process.env.SMTP_PORT || '465');
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000, socketTimeout: 15000,
  });
  try {
    await t.sendMail({ from, to, subject, html, replyTo });
    console.log('Email enviado via SMTP');
  } catch(e) { console.error('SMTP error:', e.message); }
}

// ── Plantillas de email ──────────────────────────────────────────────────────
const EMAIL_BASE = (body, preheader = '') => `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cliniflux</title>
<!--[if mso]><style>td,th,div,p,a{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f1f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f1f5f1;line-height:1px">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f1">
<tr><td align="center" style="padding:32px 16px 48px">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px">
  <!-- HEADER -->
  <tr><td style="background:#0f172a;border-radius:16px 16px 0 0;padding:32px 44px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <a href="https://cliniflux.es" style="text-decoration:none;display:inline-block">
            <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">clini</span><span style="font-size:24px;font-weight:800;color:#22c55e;letter-spacing:-0.8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">flux</span>
          </a>
          <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Automatización WhatsApp para clínicas</p>
        </td>
      </tr>
    </table>
  </td></tr>
  <!-- BODY -->
  <tr><td style="background:#ffffff;padding:44px 44px 36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
    ${body}
  </td></tr>
  <!-- FOOTER -->
  <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:22px 44px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td><span style="font-size:15px;font-weight:800;color:#16a34a;letter-spacing:-0.4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">cliniflux</span></td>
        <td align="right"><a href="https://cliniflux.es" style="font-size:12px;color:#6b7280;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin-left:16px">Web</a>&nbsp;&nbsp;<a href="mailto:contacto@cliniflux.es" style="font-size:12px;color:#6b7280;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin-left:8px">Contacto</a></td>
      </tr>
      <tr><td colspan="2" style="padding-top:12px"><p style="margin:0;font-size:11px;color:#9ca3af;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">© 2025 Cliniflux. Si tienes dudas, escríbenos a <a href="mailto:contacto@cliniflux.es" style="color:#16a34a;text-decoration:none">contacto@cliniflux.es</a></p></td></tr>
    </table>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

function emailSetupLink(name, plan, setupUrl) {
  const planLabel = { starter: 'Starter', pro: 'Pro', clinica: 'Clínica' }[plan] || plan;
  const firstName = name.split(' ')[0];
  return EMAIL_BASE(`
<p style="margin:0 0 20px"><span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 14px;border-radius:100px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Plan ${planLabel} activado</span></p>
<h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-0.6px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">¡Bienvenido/a a Cliniflux, ${firstName}!</h1>
<p style="margin:0 0 28px;font-size:16px;color:#64748b;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Tu suscripción está activa. Ya solo falta un paso.</p>
<p style="margin:0 0 18px;font-size:15px;color:#475569;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Hola ${firstName}, nos alegra mucho tenerte a bordo 🎉</p>
<p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">En menos de <strong style="color:#0f172a;font-weight:600">5 minutos</strong> puedes tener tu clínica configurada y lista para que Natalia empiece a atender pacientes en WhatsApp — incluso fuera de horario.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
  <tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f1">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="width:32px;height:32px;background:#dcfce7;border-radius:50%;text-align:center;vertical-align:middle"><span style="font-size:13px;font-weight:800;color:#16a34a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:32px">1</span></td>
      <td style="padding-left:12px;font-size:14px;color:#475569;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6"><strong style="color:#0f172a">Configura tu clínica</strong> — nombre, servicios, horario y precios</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f1">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="width:32px;height:32px;background:#dcfce7;border-radius:50%;text-align:center;vertical-align:middle"><span style="font-size:13px;font-weight:800;color:#16a34a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:32px">2</span></td>
      <td style="padding-left:12px;font-size:14px;color:#475569;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6"><strong style="color:#0f172a">Personaliza a Natalia</strong> — tono, nombre del asistente y más</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:12px 0">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="width:32px;height:32px;background:#dcfce7;border-radius:50%;text-align:center;vertical-align:middle"><span style="font-size:13px;font-weight:800;color:#16a34a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:32px">3</span></td>
      <td style="padding-left:12px;font-size:14px;color:#475569;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6"><strong style="color:#0f172a">Conecta WhatsApp</strong> — te guiamos paso a paso</td>
    </tr></table>
  </td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 24px">
  <tr><td align="center">
    <a href="${setupUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:40px;letter-spacing:-0.2px;mso-padding-alt:0" target="_blank">
      <span style="color:#ffffff;text-decoration:none">Configurar mi clínica ahora →</span>
    </a>
  </td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px">
    <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">🔒 Este enlace es personal y de un solo uso. Si tienes cualquier problema, responde directamente a este email y te ayudamos enseguida.</p>
  </td></tr>
</table>
`, `Tu clínica está a 5 minutos de estar lista. Pulsa aquí para configurarla.`);
}

function emailWelcomeOnboarding(clinicName, loginUrl) {
  return EMAIL_BASE(`
<p style="margin:0 0 20px"><span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 14px;border-radius:100px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Todo listo</span></p>
<h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-0.6px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${clinicName} ya está en marcha</h1>
<p style="margin:0 0 28px;font-size:16px;color:#64748b;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Natalia está lista para atender a tus pacientes.</p>
<p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">¡Enhorabuena! La configuración de <strong style="color:#0f172a;font-weight:600">${clinicName}</strong> está completada. A partir de ahora, Natalia responderá a tus pacientes por WhatsApp de forma automática.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
  <tr><td style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:24px;text-align:center">
    <p style="margin:0 0 4px;font-size:36px;font-weight:800;color:#15803d;letter-spacing:-1px;line-height:1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">24/7</p>
    <p style="margin:0;font-size:13px;color:#166534;font-weight:500;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Tu clínica responde — incluso cuando estás cerrado</p>
  </td></tr>
</table>
<p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Accede a tu panel para ver las conversaciones en tiempo real, revisar citas y ajustar la configuración cuando quieras.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 24px">
  <tr><td align="center">
    <a href="${loginUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:40px;letter-spacing:-0.2px" target="_blank">
      <span style="color:#ffffff;text-decoration:none">Ir a mi panel →</span>
    </a>
  </td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px">
    <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">💡 Si necesitas ayuda o tienes cualquier duda, estamos a un email de distancia: <strong>contacto@cliniflux.es</strong></p>
  </td></tr>
</table>
`, `${clinicName} está configurada. Natalia ya puede atender a tus pacientes.`);
}

function emailContactNotification({ nombre, clinica, email, telefono, tipo, mensaje }) {
  const ts = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  return EMAIL_BASE(`
<p style="margin:0 0 20px"><span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 14px;border-radius:100px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Nuevo contacto web</span></p>
<h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.4px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${tipo}</h1>
<p style="margin:0 0 24px;font-size:14px;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Recibido el ${ts}</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #f1f5f9;margin-bottom:8px">
  <tr>
    <td style="padding:12px 16px 12px 0;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-bottom:1px solid #f1f5f9">Nombre</td>
    <td style="padding:12px 0;font-size:14px;color:#0f172a;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-bottom:1px solid #f1f5f9">${nombre}</td>
  </tr>
  <tr>
    <td style="padding:12px 16px 12px 0;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-bottom:1px solid #f1f5f9">Clínica</td>
    <td style="padding:12px 0;font-size:14px;color:#334155;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-bottom:1px solid #f1f5f9">${clinica||'—'}</td>
  </tr>
  <tr>
    <td style="padding:12px 16px 12px 0;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-bottom:1px solid #f1f5f9">Email</td>
    <td style="padding:12px 0;border-bottom:1px solid #f1f5f9"><a href="mailto:${email}" style="font-size:14px;color:#16a34a;font-weight:600;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${email}</a></td>
  </tr>
  <tr>
    <td style="padding:12px 16px 12px 0;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Teléfono</td>
    <td style="padding:12px 0;font-size:14px;color:#334155;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${telefono||'—'}</td>
  </tr>
</table>
${mensaje ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td style="background:#f8f9fb;border-left:3px solid #22c55e;border-radius:0 8px 8px 0;padding:16px 18px"><p style="margin:0;font-size:14px;color:#334155;line-height:1.7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${mensaje}</p></td></tr></table>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px">
  <tr><td align="center">
    <a href="mailto:${email}" style="display:inline-block;background:#16a34a;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:40px" target="_blank">
      <span style="color:#ffffff;text-decoration:none">Responder a ${nombre.split(' ')[0]} →</span>
    </a>
  </td></tr>
</table>
`, `${nombre} de ${clinica||'una clínica'} quiere hablar contigo.`);
}

// Stripe price IDs (test mode)
const STRIPE_PRICES = {
  starter: { mes: 'price_1TJuFFCzcmmCvDMjzNORnnZC', ano: 'price_1TJuFFCzcmmCvDMjrctpYWqo' },
  pro:     { mes: 'price_1TJuGDCzcmmCvDMjWWEk2LmF', ano: 'price_1TJuGrCzcmmCvDMjBHhWsDj0' },
  clinica: { mes: 'price_1TJuHZCzcmmCvDMjlQXorUBN', ano: 'price_1TJuICCzcmmCvDMjUiur152i' }
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
  console.log('[Stripe] Webhook recibido:', req.headers['stripe-signature'] ? 'con firma' : 'SIN FIRMA');
  if (!stripe) { console.error('[Stripe] SDK no inicializado'); return res.sendStatus(503); }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe] Webhook firma inválida:', err.message, '| STRIPE_WEBHOOK_SECRET set:', !!process.env.STRIPE_WEBHOOK_SECRET);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const plan = s.metadata?.plan || 'starter';
    const email = s.customer_details?.email || s.metadata?.email || '';
    const name = s.customer_details?.name || email;
    const appBase = (process.env.APP_URL || 'https://cliniflux.com').replace(/\/$/, '');
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

function requirePlan(...plans) {
  return (req, res, next) => {
    if (plans.includes(req.session?.clinic?.plan)) return next();
    res.status(403).json({ error: 'Esta función requiere el plan Pro o Clínica.', upgrade: true });
  };
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
app.post('/api/leads/import', requireAuth, requirePlan('pro','clinica'), rateLimit(10, 60000), async (req, res) => {
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

app.get('/api/leads/imported', requireAuth, requirePlan('pro','clinica'), async (req, res) => {
  try { res.json(await getImportedLeads(req.session.clinic.id)); }
  catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.patch('/api/leads/imported/:id', requireAuth, requirePlan('pro','clinica'), async (req, res) => {
  try {
    await updateLeadEstado(req.params.id, req.body.estado);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// Exportar a CSV (compatible Google Sheets)
app.get('/api/leads/export', requireAuth, requirePlan('pro','clinica'), async (req, res) => {
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
  const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
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

app.post('/api/billing-portal', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Pagos no configurados' });
  try {
    const { rows } = await pool.query('SELECT stripe_customer_id FROM clinics WHERE id=$1', [req.session.clinicId]);
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No hay suscripción activa' });
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/dashboard`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Billing portal error:', e.message);
    res.status(500).json({ error: 'Error al abrir portal' });
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
