require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const OpenAI = require('openai');
const crypto = require('crypto');
const Stripe = require('stripe');
const { pool, initDb, getSession, saveSession, saveLead, getClinicByEmail, getClinicByWhatsapp, getClinicBySetupToken, createClinic, updateClinicConfig, buildPromptForClinic, getLeads, getAppointments, saveAppointment, verifyPassword, hashPassword, importLeads, getImportedLeads, updateLeadEstado, incrementConversation, PLAN_LIMITS, saveMessage, getMessages, getRecentConversations, getHistoryFromMessages } = require('./db');

const compression = require('compression');
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

function emailOnboardingSetup({ clinic, cfg, whatsapp_number }) {
  const ts = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const waNum = whatsapp_number || '— (no proporcionado)';
  return EMAIL_BASE(`
<p style="margin:0 0 20px"><span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 14px;border-radius:100px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Nuevo cliente — acción requerida</span></p>
<h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.4px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${clinic.name}</h1>
<p style="margin:0 0 24px;font-size:14px;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Onboarding completado el ${ts} · Plan <strong style="color:#0f172a">${clinic.plan||'starter'}</strong></p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #f1f5f9;margin-bottom:24px">
  ${[
    ['Email', clinic.email],
    ['Teléfono clínica', cfg.phone||'—'],
    ['Dirección', cfg.address||'—'],
    ['Horario', cfg.hours||'—'],
    ['Asistente', cfg.assistant_name||'Natalia'],
    ['WhatsApp Business', `<strong style="color:#16a34a">${waNum}</strong>`],
  ].map(([l,v]) => `<tr>
    <td style="padding:10px 16px 10px 0;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-bottom:1px solid #f1f5f9">${l}</td>
    <td style="padding:10px 0;font-size:14px;color:#334155;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-bottom:1px solid #f1f5f9">${v}</td>
  </tr>`).join('')}
</table>
${cfg.services ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px"><tr><td style="background:#f8f9fb;border-left:3px solid #22c55e;border-radius:0 8px 8px 0;padding:14px 16px"><p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Servicios</p><p style="margin:0;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${cfg.services}</p></td></tr></table>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr><td style="background:#fef3c7;border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:16px 20px">
  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#92400e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">⚡ Pasos para activar WhatsApp (Meta Cloud API)</p>
  <ol style="margin:0;padding-left:18px;font-size:13px;color:#78350f;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
    <li>Entra en <strong>developers.facebook.com</strong> → WhatsApp → Configuration</li>
    <li>Añade el número del cliente <strong>${waNum}</strong> como WhatsApp Business sender</li>
    <li>Webhook configurado: <strong>POST https://cliniflux.es/webhook/whatsapp</strong></li>
    <li>Actualiza en la DB: <code>UPDATE clinics SET whatsapp_number='${waNum}' WHERE id=${clinic.id}</code></li>
    <li>Envía email al cliente confirmando activación</li>
  </ol>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
  <a href="mailto:${clinic.email}" style="display:inline-block;background:#16a34a;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:40px" target="_blank">
    <span style="color:#ffffff;text-decoration:none">Responder al cliente →</span>
  </a>
</td></tr></table>
`, `${clinic.name} completó el onboarding — activar WhatsApp`);
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

function emailUsageWarning(name, email, count, limit, pct) {
  const isBlocked = pct >= 100;
  const title = isBlocked ? `Has alcanzado el límite de conversaciones` : `Has usado el ${pct}% de tus conversaciones`;
  const badge = isBlocked ? 'Límite alcanzado' : `${pct}% usado`;
  const badgeBg = isBlocked ? '#fee2e2' : '#fef3c7';
  const badgeColor = isBlocked ? '#991b1b' : '#92400e';
  const body = isBlocked
    ? `Tu plan actual ha llegado al límite de <strong>${limit} conversaciones</strong> este mes. Natalia ha dejado de responder hasta que actualices el plan o empiece el próximo mes.`
    : `Ya llevas <strong>${count} de ${limit} conversaciones</strong> este mes. Si las agotás, Natalia dejará de responder automáticamente.`;
  return EMAIL_BASE(`
<p style="margin:0 0 20px"><span style="display:inline-block;background:${badgeBg};color:${badgeColor};font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 14px;border-radius:100px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${badge}</span></p>
<h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.6px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${title}</h1>
<p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${body}</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px"><tr><td style="background:#f8fafc;border-radius:12px;padding:20px 24px">
  <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Uso este mes</p>
  <p style="margin:0 0 10px;font-size:28px;font-weight:800;color:#0f172a;letter-spacing:-1px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${count} <span style="font-size:14px;font-weight:500;color:#94a3b8">/ ${limit}</span></p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#e5e7eb;border-radius:100px;height:8px"><table width="${Math.min(pct,100)}%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${isBlocked?'#ef4444':'#f59e0b'};border-radius:100px;height:8px"></td></tr></table></td></tr></table>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td align="center">
  <a href="https://cliniflux.es/dashboard" style="display:inline-block;background:#16a34a;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:40px" target="_blank">
    <span style="color:#ffffff;text-decoration:none">Ampliar plan →</span>
  </a>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px">
  <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">💡 El contador se reinicia automáticamente el 1 de cada mes. Si necesitas más, escríbenos a <strong>contacto@cliniflux.es</strong></p>
</td></tr></table>
`, title);
}

async function checkAndNotifyUsage(usage, clinicId) {
  if (!usage.limit) return; // Clínica = ilimitado
  if (usage.blocked && !usage.warned) {
    await pool.query('UPDATE clinics SET conv_warned=TRUE WHERE id=$1', [clinicId]);
    await sendEmail({ to: usage.email, subject: '⚠️ Límite de conversaciones alcanzado — Cliniflux', html: emailUsageWarning(usage.name, usage.email, usage.count, usage.limit, 100) });
  } else if (usage.pct >= 80 && usage.pct < 100 && !usage.warned) {
    await pool.query('UPDATE clinics SET conv_warned=TRUE WHERE id=$1', [clinicId]);
    await sendEmail({ to: usage.email, subject: `Aviso: has usado el ${usage.pct}% de tus conversaciones — Cliniflux`, html: emailUsageWarning(usage.name, usage.email, usage.count, usage.limit, usage.pct) });
  }
}

// Stripe price IDs (live)
const STRIPE_PRICES = {
  starter: { mes: 'price_1TJuFFCzcmmCvDMjzNORnnZC', ano: 'price_1TJuFFCzcmmCvDMjrctpYWqo' },
  pro:     { mes: 'price_1TJuGDCzcmmCvDMjWWEk2LmF', ano: 'price_1TJuGrCzcmmCvDMjBHhWsDj0' },
  clinica: { mes: 'price_1TJuHZCzcmmCvDMjlQXorUBN', ano: 'price_1TJuICCzcmmCvDMjUiur152i' }
};

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 15000,
  maxRetries: 2,
});

// ── Performance ─────────────────────────────────────────────────────────────
app.use(compression());
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

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
    const appBase = (process.env.APP_URL || 'https://cliniflux.es').replace(/\/$/, '');
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
const sessionMiddleware = session({
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
});
app.use(sessionMiddleware);
app.use(express.static('public', {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

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

// ── Token helpers ────────────────────────────────────────────────────────────
// Rough estimate: 1 token ≈ 3.8 chars in Spanish
function estimateTokens(text) { return Math.ceil((text || '').length / 3.8); }

// Smart context: fill budget from newest → oldest (keeps most recent turns)
function buildContextMessages(history, tokenBudget = 1200) {
  if (!history.length) return [];
  let used = 0;
  const kept = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const t = estimateTokens(history[i].content);
    if (used + t > tokenBudget && kept.length > 0) break;
    kept.unshift(history[i]);
    used += t;
  }
  return kept;
}

// Urgency keywords (Spanish) — used for badge detection
const URGENT_PATTERN = /urgente|emergencia|dolor intenso|sangra|no puedo|crisis|grave|inmediato|ahora mismo/i;
function isUrgent(text) { return URGENT_PATTERN.test(text || ''); }

// In-memory manual mode per session (cleared on restart — fine for now)
const manualSessions = new Set();

// ── Demo prompt (BarnaDental) ─────────────────────────────────────────────────
function buildDemoPrompt() {
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const fecha = new Date().toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short' });
  return `Eres Natalia, recepcionista de BarnaDental (${fecha}). Tono: cálido, natural, humano. 1-2 emojis/msg. Respuestas cortas (≤3 párrafos). Español siempre.
Saludo: "¡${saludo}! Soy Natalia, de BarnaDental 😊 ¿En qué le ayudo?"
📍 Carrer de València 245, Barcelona | 📞 +34 932 123 456 | ⏰ L-V 9-20:30 · S 10-14h
🚇 Metro Diagonal (L3/L5) | 🅿️ 1h gratis Carrer d'Aragó | ✉ info@barnadental.cat
Servicios: Higiene 55€ · Blanqueamiento LED 280€ · Invisalign desde 2.900€ (valoración GRATIS) · Implante desde 850€ · Urgencias 40€ · 1ª visita GRATUITA
Seguros: Adeslas, Sanitas, Mapfre. Equipo: Dra. Laia Puig (Implantología) · Dr. Marc Soler (Ortodoncia).
Citas: recoge nombre→servicio→franja. Di que Marta llamará en <30min para confirmar. Cancelar con 24h+.
Desconocido: "Llámenos al +34 932 123 456, le atendemos encantados." No confirmes ser IA salvo pregunta directa.
Con nombre+servicio+franja: CITA_CONFIRMADA|tratamiento=...|fecha=...|hora=...|nombre=...|email=...`;
}

// ── Sitemap dinámico ────────────────────────────────────────────────────────

app.get('/sitemap.xml', (req, res) => {
  const base = 'https://cliniflux.es';
  const { BLOG_POSTS } = require('./blog-posts');
  const static_urls = [
    { loc: '/', changefreq: 'weekly', priority: '1.0' },
    { loc: '/contacto', changefreq: 'monthly', priority: '0.9' },
    { loc: '/demo', changefreq: 'monthly', priority: '0.8' },
    { loc: '/blog', changefreq: 'weekly', priority: '0.8' },
    { loc: '/about', changefreq: 'monthly', priority: '0.6' },
    { loc: '/whatsapp-clinica-dental', changefreq: 'monthly', priority: '0.9' },
    { loc: '/whatsapp-fisioterapia', changefreq: 'monthly', priority: '0.9' },
    { loc: '/whatsapp-clinica-estetica', changefreq: 'monthly', priority: '0.9' },
    { loc: '/whatsapp-psicologia', changefreq: 'monthly', priority: '0.9' },
    { loc: '/whatsapp-nutricion', changefreq: 'monthly', priority: '0.9' },
    { loc: '/features/respuesta-automatica', changefreq: 'monthly', priority: '0.7' },
    { loc: '/features/agenda-inteligente', changefreq: 'monthly', priority: '0.7' },
    { loc: '/features/reactivacion-pacientes', changefreq: 'monthly', priority: '0.7' },
    { loc: '/features/panel-control', changefreq: 'monthly', priority: '0.7' },
    { loc: '/features/implementacion', changefreq: 'monthly', priority: '0.7' },
    { loc: '/features/rgpd', changefreq: 'monthly', priority: '0.6' },
    { loc: '/roadmap', changefreq: 'monthly', priority: '0.6' },
    { loc: '/rgpd-clinicas', changefreq: 'monthly', priority: '0.7' },
    { loc: '/legal/privacidad', changefreq: 'yearly', priority: '0.3' },
    { loc: '/legal/terminos', changefreq: 'yearly', priority: '0.3' },
    { loc: '/legal/cookies', changefreq: 'yearly', priority: '0.3' },
  ];
  const today = new Date().toISOString().split('T')[0];
  const blog_urls = BLOG_POSTS.map(p => ({ loc: `/blog/${p.slug}`, changefreq: 'monthly', priority: '0.8', lastmod: p.date || today }));
  const all = [...static_urls.map(u => ({...u, lastmod: today})), ...blog_urls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map(u => `  <url><loc>${base}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>`;
  res.type('application/xml').send(xml);
});

// ── Rutas páginas públicas ──────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile('landing.html', { root: 'public' }));
app.get('/demo', (req, res) => res.sendFile('demo.html', { root: 'public' }));
app.get('/about', (req, res) => res.sendFile('about.html', { root: 'public' }));
app.get('/roadmap', (req, res) => res.sendFile('roadmap.html', { root: 'public' }));
app.get('/rgpd-clinicas', (req, res) => res.sendFile('rgpd-clinicas.html', { root: 'public' }));
app.get('/contacto', (req, res) => res.sendFile('contacto.html', { root: 'public' }));
app.get('/blog', (req, res) => {
  const { BLOG_POSTS } = require('./blog-posts');
  const cards = BLOG_POSTS.map(p => `
    <a href="/blog/${p.slug}" class="bl-card">
      <span class="bl-cat">${p.category}</span>
      <h2>${p.title}</h2>
      <p>${p.excerpt || p.description}</p>
      <div class="bl-meta">
        <span>${p.author}</span>
        <span>${p.readingTime}</span>
        <span>${new Date(p.date).toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}</span>
      </div>
    </a>`).join('');
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blog — WhatsApp para Clínicas | Cliniflux</title>
<meta name="description" content="Guías y recursos sobre automatización WhatsApp para clínicas en España: reducir no-shows, RGPD, comparativas e integraciones con software médico.">
<link rel="canonical" href="https://cliniflux.es/blog">
<meta property="og:title" content="Blog — WhatsApp para Clínicas | Cliniflux">
<meta property="og:description" content="Guías y recursos sobre automatización WhatsApp para clínicas en España.">
<meta property="og:url" content="https://cliniflux.es/blog">
<meta property="og:type" content="website">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Blog","name":"Blog de Cliniflux","url":"https://cliniflux.es/blog","description":"Guías sobre automatización WhatsApp para clínicas en España.","publisher":{"@type":"Organization","name":"Cliniflux","url":"https://cliniflux.es"}}</script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--green:#16a34a;--text:#0f172a;--text2:#475569;--border:#e2e8f0;--bg2:#f8fafc;--px:clamp(20px,5vw,80px);--cmax:1120px;--r:12px}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);background:#fff;line-height:1.6}
  a{text-decoration:none;color:inherit}
  nav{position:fixed;top:0;left:0;right:0;z-index:200;background:rgba(255,255,255,0.93);backdrop-filter:blur(20px);box-shadow:0 1px 0 var(--border)}
  .nav-inner{max-width:var(--cmax);margin:0 auto;padding:0 var(--px);height:64px;display:flex;align-items:center;gap:24px}
  .nav-logo{font-size:21px;font-weight:800;color:var(--text);letter-spacing:-.6px}
  .nav-links{display:flex;align-items:center;gap:2px;list-style:none;margin:0 auto}
  .nav-links a{font-size:14px;font-weight:500;color:var(--text2);padding:7px 13px;border-radius:8px;transition:color .2s,background .2s}
  .nav-links a:hover{color:var(--text);background:rgba(0,0,0,0.04)}
  .nav-dropdown{position:relative;z-index:10;padding-bottom:8px;margin-bottom:-8px}
  .nav-dropdown>a{display:flex;align-items:center;gap:4px}
  .nav-dropdown>a svg{transition:transform .2s}
  .nav-dropdown:hover>a svg{transform:rotate(180deg)}
  .nav-dd-menu{display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.12);padding:8px;min-width:200px;z-index:300}
  .nav-dropdown:hover .nav-dd-menu{display:block}
  .nav-dd-menu a{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2);padding:8px 12px;border-radius:8px;transition:background .15s,color .15s;white-space:nowrap}
  .nav-dd-menu a:hover{background:#f0fdf4;color:var(--green)}
  .nav-cta{font-size:13.5px;font-weight:600;color:#fff;background:var(--green);padding:9px 20px;border-radius:100px;white-space:nowrap}
  .nav-cta:hover{background:#15803d}
  .nav-login{font-size:14px;font-weight:500;color:var(--text2);padding:8px 14px;border-radius:8px}
  .nav-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
  .hero{padding:calc(64px + 64px) var(--px) 40px;max-width:var(--cmax);margin:0 auto}
  .hero h1{font-size:clamp(28px,4vw,40px);font-weight:800;letter-spacing:-.03em;margin-bottom:12px}
  .hero p{font-size:17px;color:var(--text2);max-width:560px}
  .grid{max-width:var(--cmax);margin:0 auto;padding:24px var(--px) 80px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px}
  .bl-card{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:28px;display:flex;flex-direction:column;gap:12px;transition:box-shadow .2s,transform .2s}
  .bl-card:hover{box-shadow:0 8px 32px rgba(0,0,0,0.10);transform:translateY(-2px)}
  .bl-cat{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--green);background:#f0fdf4;border-radius:100px;padding:3px 10px;width:fit-content}
  .bl-card h2{font-size:18px;font-weight:700;letter-spacing:-.02em;line-height:1.35}
  .bl-card p{font-size:14px;color:var(--text2);line-height:1.55;flex:1}
  .bl-meta{display:flex;gap:16px;font-size:12px;color:#94a3b8;margin-top:4px}
  footer{border-top:1px solid var(--border);padding:32px var(--px);text-align:center;font-size:13px;color:var(--text2)}
  .nav-burger{display:none;flex-direction:column;gap:5px;cursor:pointer;padding:8px;margin-left:auto;background:none;border:none}
  .nav-burger span{display:block;width:22px;height:2px;background:var(--text);border-radius:2px;transition:all .25s}
  .mob-nav{display:none;position:fixed;top:64px;left:0;right:0;background:#fff;border-bottom:1px solid var(--border);z-index:190;padding:16px var(--px) 20px;flex-direction:column;gap:4px}
  .mob-nav a{font-size:15px;font-weight:500;color:var(--text2);padding:10px 12px;border-radius:8px;display:block}
  .mob-nav a:hover{background:var(--bg2);color:var(--text)}
  .mob-nav .mob-sep{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;padding:12px 12px 4px}
  .mob-nav .mob-cta{background:var(--green);color:#fff;text-align:center;border-radius:100px;font-weight:600;margin-top:8px}
  .mob-nav.open{display:flex}
  @media(max-width:640px){.nav-links,.nav-actions{display:none}.nav-burger{display:flex}}
</style>
</head>
<body>
<nav>
  <div class="nav-inner">
    <a href="/" class="nav-logo">cliniflux</a>
    <ul class="nav-links">
      <li><a href="/#producto">Producto</a></li>
      <li><a href="/#flujo">Cómo funciona</a></li>
      <li class="nav-dropdown">
        <a href="#">Especialidades <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg></a>
        <div class="nav-dd-menu">
          <a href="/whatsapp-clinica-dental">🦷 Clínicas Dentales</a>
          <a href="/whatsapp-fisioterapia">💪 Fisioterapia</a>
          <a href="/whatsapp-clinica-estetica">✨ Clínica Estética</a>
          <a href="/whatsapp-psicologia">🧠 Psicología</a>
          <a href="/whatsapp-nutricion">🥗 Nutrición</a>
        </div>
      </li>
      <li><a href="/#precios">Precios</a></li>
      <li><a href="/about">Nosotros</a></li>
      <li><a href="/blog" style="color:var(--green);font-weight:600">Blog</a></li>
    </ul>
    <div class="nav-actions">
      <a href="/login" class="nav-login">Acceder</a>
      <a href="/contacto" class="nav-cta">Solicitar acceso →</a>
    </div>
    <button class="nav-burger" id="blogBurger" aria-label="Menú">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<div class="mob-nav" id="blogMobNav">
  <a href="/#producto">Producto</a>
  <a href="/#flujo">Cómo funciona</a>
  <a href="/#precios">Precios</a>
  <a href="/about">Nosotros</a>
  <a href="/blog" style="color:var(--green);font-weight:600">Blog</a>
  <div class="mob-sep">Especialidades</div>
  <a href="/whatsapp-clinica-dental">🦷 Clínicas Dentales</a>
  <a href="/whatsapp-fisioterapia">💪 Fisioterapia</a>
  <a href="/whatsapp-clinica-estetica">✨ Clínica Estética</a>
  <a href="/whatsapp-psicologia">🧠 Psicología</a>
  <a href="/whatsapp-nutricion">🥗 Nutrición</a>
  <a href="/login" style="margin-top:4px">Acceder</a>
  <a href="/contacto" class="mob-cta">Solicitar acceso →</a>
</div>
<script>
  document.getElementById('blogBurger').addEventListener('click',function(){
    document.getElementById('blogMobNav').classList.toggle('open');
  });
</script>
<div class="hero">
  <h1>Blog — Cliniflux</h1>
  <p>Guías y recursos sobre automatización WhatsApp para clínicas en España.</p>
</div>
<div class="grid">${cards}</div>
<footer>
  <p>© 2026 Cliniflux · <a href="/legal/privacidad">Privacidad</a> · <a href="/legal/terminos">Términos</a></p>
</footer>
</body>
</html>`;
  res.type('text/html').send(html);
});
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

// ── Páginas de especialidad ─────────────────────────────────────────────────
const SPECIALTY_PAGES = ['whatsapp-clinica-dental','whatsapp-fisioterapia','whatsapp-clinica-estetica','whatsapp-psicologia','whatsapp-nutricion'];
SPECIALTY_PAGES.forEach(slug => {
  app.get(`/${slug}`, (req, res) => res.sendFile(`${slug}.html`, { root: 'public' }));
});

// ── Blog dinámico ───────────────────────────────────────────────────────────
app.get('/blog/:slug', (req, res) => {
  const { BLOG_POSTS, renderBlogPost } = require('./blog-posts');
  const post = BLOG_POSTS.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).sendFile('landing.html', { root: 'public' });
  const related = BLOG_POSTS.filter(p => p.slug !== post.slug && p.category === post.category).slice(0, 3);
  res.type('text/html').send(renderBlogPost(post, related));
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
    const loginUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '') + '/login';
    // Email al cliente
    await sendEmail({
      to: clinic.email,
      subject: `Tu asistente Cliniflux estará activo en menos de 24h`,
      html: emailWelcomeOnboarding(clinic.name || 'Tu clínica', loginUrl)
    });
    // Email interno para activar en Meta Cloud API
    const cfg = { phone, address, hours, services, extra, assistant_name: assistant_name||'Natalia' };
    const notify = process.env.EMAIL_NOTIFY || process.env.EMAIL_FROM || 'contacto@cliniflux.es';
    await sendEmail({
      to: notify,
      subject: `🔧 Nuevo cliente listo para activar — ${clinic.name}`,
      html: emailOnboardingSetup({ clinic, cfg, whatsapp_number })
    }).catch(e => console.error('notify email:', e.message));
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

// ── WhatsApp Business API (Meta) ────────────────────────────────────────────

async function sendWhatsAppMessage(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) { console.error('[WA] Faltan WHATSAPP_PHONE_ID o WHATSAPP_TOKEN'); return; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      signal: ctrl.signal,
    });
  } catch(e) {
    console.error('[WA] send error:', e.message);
  } finally {
    clearTimeout(timer);
  }
}

// Verificación del webhook (Meta hace GET al configurarlo)
app.get('/webhook/whatsapp', (req, res) => {
  const mode  = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200); // Meta requiere 200 inmediato

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const from = message.from; // número del paciente (e.g. "34612345678")
    const to   = change?.metadata?.display_phone_number?.replace(/\D/g,'');
    const msg  = message.text?.body?.trim().slice(0, 500);
    if (!from || !msg) return;

    const clinic   = to ? await getClinicByWhatsapp(to).catch(() => null) : null;
    const prompt   = clinic ? buildPromptForClinic(clinic) : buildDemoPrompt();
    const clinicId = clinic?.id || 1;
    const sessionId = `wa_${clinicId}_` + from.slice(-10);

    if (clinic?.id) {
      const usage = await incrementConversation(clinic.id);
      checkAndNotifyUsage(usage, clinic.id).catch(e => console.error('usage notify:', e.message));
      if (usage.blocked) {
        await sendWhatsAppMessage(from, 'Lo sentimos, la clínica ha alcanzado el límite de conversaciones este mes. Llámenos directamente para ayudarle.');
        return;
      }
    }

    // Detectar urgencia antes de cualquier espera
    const urgent = isUrgent(msg);
    const inManual = manualSessions.has(sessionId);
    const io = req.app.get('io');

    // Persistir mensaje entrante + emitir al dashboard en paralelo
    const savedAt = new Date().toISOString();
    await saveMessage({ clinic_id: clinicId, session_id: sessionId, direction: 'inbound', content: msg, from_number: from }).catch(() => {});
    io?.to(`clinic_${clinicId}`).emit('message:new', {
      session_id: sessionId, from_number: from, content: msg, direction: 'inbound',
      created_at: savedAt, responded_by: 'human', urgent, manual: inManual
    });

    // Si está en modo manual, no responder con IA
    if (inManual) return;

    // Leer historial desde messages table (elimina round-trip a chat_sessions)
    const history = await getHistoryFromMessages(clinicId, sessionId, 30);
    const contextMsgs = buildContextMessages(history, 1200); // ~1200 token budget

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [{ role:'system', content: prompt }, ...contextMsgs, { role:'user', content: msg }],
      max_tokens: 300, temperature: 0.4
    });
    let reply = completion.choices[0].message.content;
    const match = reply.match(/CITA_CONFIRMADA\|(.+)/);
    if (match) {
      reply = reply.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
      const parts = Object.fromEntries(match[1].split('|').map(p => p.split('=')));
      await saveAppointment({ clinic_id: clinicId, patient_name: parts.nombre||'Paciente', patient_phone: from, service: parts.tratamiento||null, scheduled_at: `${parts.fecha||''} ${parts.hora||''}`.trim() }).catch(e => console.error('Appt:', e.message));
    }

    // Persistir + enviar + emitir en paralelo
    const repliedAt = new Date().toISOString();
    await Promise.all([
      saveMessage({ clinic_id: clinicId, session_id: sessionId, direction: 'outbound', content: reply, from_number: from, responded_by: 'ai' }).catch(() => {}),
      sendWhatsAppMessage(from, reply),
    ]);
    io?.to(`clinic_${clinicId}`).emit('message:sent', {
      session_id: sessionId, from_number: from, content: reply, direction: 'outbound',
      created_at: repliedAt, responded_by: 'ai', urgent
    });
  } catch(err) {
    console.error('[WA]', err.message);
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
    // Contador de conversaciones (solo clínicas reales)
    if (clinicId !== 1) {
      const usage = await incrementConversation(clinicId);
      checkAndNotifyUsage(usage, clinicId).catch(e => console.error('usage notify:', e.message));
      if (usage.blocked) return res.status(429).json({ error: 'Límite de conversaciones alcanzado este mes. Actualiza tu plan para continuar.' });
    }
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
    to: process.env.EMAIL_NOTIFY || process.env.SMTP_USER || 'contacto@cliniflux.es',
    replyTo: email,
    subject: `[Contacto Web] ${tipo} — ${nombre} (${clinica||'-'})`,
    html: emailContactNotification({ nombre, clinica, email, telefono, tipo, mensaje })
  });
  res.json({ ok: true });
});

app.get('/api/usage', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT plan, conv_count, conv_reset_at FROM clinics WHERE id=$1', [req.session.clinicId]);
  const r = rows[0] || {};
  const limit = PLAN_LIMITS[r.plan] ?? null;
  res.json({ count: r.conv_count || 0, limit, plan: r.plan, reset_at: r.conv_reset_at });
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
    const waNum = whatsapp_number ? whatsapp_number.replace(/\D/g,'').slice(-9) : null;
    await pool.query(
      `UPDATE clinics SET config=$1, name=COALESCE($2,name),
       whatsapp_number=COALESCE(NULLIF($3,''),whatsapp_number),
       whatsapp_normalized=COALESCE($4,whatsapp_normalized)
       WHERE id=$5`,
      [JSON.stringify(cfg), name || null, whatsapp_number || '', waNum, req.session.clinic.id]
    );
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
      configuration: 'bpc_1TKU6jCzcmmCvDMjROnl5QGI',
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

// ── API conversaciones (dashboard en tiempo real) ───────────────────────────

app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    const convs = await getRecentConversations(req.session.clinic.id, 30);
    res.json(convs);
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/conversations/:sessionId/messages', requireAuth, async (req, res) => {
  try {
    const msgs = await getMessages(req.session.clinic.id, req.params.sessionId, 50);
    res.json(msgs);
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// Toggle manual mode for a session — pauses IA responses
app.post('/api/conversations/:sessionId/mode', requireAuth, (req, res) => {
  const { sessionId } = req.params;
  const { manual } = req.body;
  if (manual) manualSessions.add(sessionId);
  else manualSessions.delete(sessionId);
  // Broadcast mode change to dashboard
  req.app.get('io')?.to(`clinic_${req.session.clinic.id}`).emit('mode:changed', { session_id: sessionId, manual: !!manual });
  res.json({ ok: true, manual: !!manual });
});

// Current mode for a session
app.get('/api/conversations/:sessionId/mode', requireAuth, (req, res) => {
  res.json({ manual: manualSessions.has(req.params.sessionId), urgent: false });
});

// ── Arrancar + WebSocket ─────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// Servidor HTTP explícito para socket.io
const httpServer = http.createServer(app);

// socket.io — misma sesión Express (sessionMiddleware definido arriba)
const io = new SocketServer(httpServer, {
  cors: { origin: process.env.APP_URL || '*', credentials: true },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

io.on('connection', (socket) => {
  const clinic = socket.request.session?.clinic;
  if (!clinic?.id) { socket.disconnect(true); return; }
  socket.join(`clinic_${clinic.id}`);
  socket.emit('connected', { clinicId: clinic.id });
  console.log(`[WS] Clínica ${clinic.id} (${clinic.name}) conectada`);
});

app.set('io', io);

initDb()
  .then(() => httpServer.listen(PORT, () => console.log(`Cliniflux en http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
