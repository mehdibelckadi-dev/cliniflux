require('dotenv').config();

// ── Startup guard: variables críticas ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const missing = ['SESSION_SECRET','ADMIN_SECRET'].filter(k => !process.env[k]);
  if (missing.length) { console.error(`[FATAL] Variables no configuradas: ${missing.join(', ')}. Abortando.`); process.exit(1); }
}
const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const OpenAI = require('openai');
const crypto = require('crypto');
const Stripe = require('stripe');
const { pool, initDb, getAnalytics, getSession, saveSession, saveLead, getClinicByEmail, getClinicByWhatsapp, getClinicBySetupToken, createClinic, updateClinicConfig, buildPromptForClinic, getLeads, getAppointments, saveAppointment, verifyPassword, hashPassword, importLeads, getImportedLeads, updateLeadEstado, incrementConversation, PLAN_LIMITS, saveMessage, getMessages, getRecentConversations, getHistoryFromMessages, setConvState, getManualSessions, getConvNotes, savePushSubscription, getPushSubscriptions, removePushSubscription, closeInactiveConversations, getPatientData, getAtRiskPatients, scheduleNps, getPendingNps, markNpsSent, saveNpsScore, createBroadcast, getBroadcasts, updateBroadcast, getUpcomingAppointments, markReminderSent, getAtRiskForAutoReact, markLeadsContactado, getAppointmentsByRange, createAppointmentFull, updateAppointmentFull, deleteAppointment, createStaff, getStaff, getStaffByEmail, updateStaffRole, deactivateStaff, auditLog, getAuditLogs, recordConsent, hasConsent, getConsents, revokeConsent, getAppointmentsForFollowup, getAppointmentsForReview, markFollowupSent, markReviewSent, getAvailableSlotsForBot, getEnrichedPatientProfile, savePatientNote, getPatientNote, getBlockedSlots, createBlockedSlot, deleteBlockedSlot, updateStaffColor, getPatientMemory, updatePatientInsights } = require('./db');
const PDFDocument = require('pdfkit');
const webpush = require('web-push');

// VAPID — claves en env (Railway). Fallback: generadas en dev (no persistentes entre reinicios)
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BJCREiK2q5ZNhc_zYlOmeOUhFKUbw8cCl93dKqsb8NHlMaJEYy2SWAObRGluIXP6MkiaCDh5ZEGgx52fiS26XrY';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'ixgd2eOIj-S6Z9HzMfVlBNHgh92ZsL7EsWoLhRLucLI';
webpush.setVapidDetails('mailto:contacto@cliniflux.es', VAPID_PUBLIC, VAPID_PRIVATE);

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

function emailWhatsAppActivated(clinicName, loginUrl) {
  return EMAIL_BASE(`
<p style="margin:0 0 20px"><span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 14px;border-radius:100px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">🟢 WhatsApp activo</span></p>
<h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-0.6px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">¡Natalia ya está respondiendo en WhatsApp!</h1>
<p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Tu asistente virtual de <strong style="color:#0f172a">${clinicName}</strong> está activa y lista para atender a tus pacientes 24/7. A partir de ahora responderá automáticamente en WhatsApp.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 24px">
  <tr><td align="center">
    <a href="${loginUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:40px" target="_blank">
      <span style="color:#ffffff;text-decoration:none">Ver mi panel →</span>
    </a>
  </td></tr>
</table>
<p style="margin:0;font-size:13px;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">¿Dudas? Escríbenos a <strong>contacto@cliniflux.es</strong> — respondemos en menos de 2h.</p>
`, `Tu WhatsApp ya está activo — Natalia empieza a atender pacientes ahora mismo.`);
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

// Forzar HTTPS en producción (Railway termina TLS en el proxy)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ── Rate limiting simple (sin dependencias) ────────────────────────────────
const rateLimits = new Map();
const waRateLimits = new Map(); // por número de teléfono entrante
function waRateLimit(from, max = 5, windowMs = 10000) {
  const now = Date.now();
  const e = waRateLimits.get(from) || { count: 0, start: now };
  if (now - e.start > windowMs) { e.count = 1; e.start = now; waRateLimits.set(from, e); return false; }
  e.count++;
  waRateLimits.set(from, e);
  return e.count > max;
}
setInterval(() => waRateLimits.clear(), 3600000);
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

// ── WhatsApp webhook (raw body ANTES de express.json) ────────────────────────
app.get('/webhook/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook/whatsapp', express.raw({ type: 'application/json' }), async (req, res) => {
  // Validar firma HMAC-SHA256 de Meta
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const sigHeader = req.headers['x-hub-signature-256'] || '';
    const expected  = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.body).digest('hex');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
        console.warn('[WA] Firma inválida — petición rechazada');
        return res.sendStatus(403);
      }
    } catch {
      console.warn('[WA] Error comparando firma — petición rechazada');
      return res.sendStatus(403);
    }
  } else {
    console.warn('[WA] WHATSAPP_APP_SECRET no configurado — firma no validada');
  }

  res.sendStatus(200); // Meta requiere 200 inmediato

  let body;
  try { body = JSON.parse(req.body); } catch { return; }

  let sessionId;
  try {
    const entry   = body?.entry?.[0];
    const change  = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message || !['text','audio','image'].includes(message.type)) return;

    const from = message.from;
    const to   = change?.metadata?.display_phone_number?.replace(/\D/g,'');
    if (!from) return;
    if (waRateLimit(from)) { console.warn(`[RateLimit] ${from} excedió 5 msgs/10s`); return; }

    let msg          = message.text?.body?.trim().slice(0, 500) || '';
    let visionContent = null;

    if (!msg && message.type === 'audio' && message.audio?.id) {
      try {
        const { buffer, mimeType } = await downloadWaMedia(message.audio.id);
        const transcript = await transcribeAudio(buffer, mimeType);
        msg = transcript ? `🎤 ${transcript}` : '';
      } catch(e) { console.error('[WA] audio:', e.message); }
    }

    if (!msg && message.type === 'image' && message.image?.id) {
      try {
        const caption = (message.image?.caption || '').trim();
        const { buffer, mimeType } = await downloadWaMedia(message.image.id);
        if (buffer.length <= 4 * 1024 * 1024) {
          const b64 = buffer.toString('base64');
          msg = `📷${caption ? ' ' + caption : ' Imagen'}`;
          visionContent = [
            { type: 'text', text: caption || 'El paciente ha enviado una imagen. Analízala y responde en el contexto de la clínica.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'low' } }
          ];
        }
      } catch(e) { console.error('[WA] image:', e.message); }
    }

    if (!msg) return;

    const clinic   = to ? await getClinicByWhatsapp(to).catch(() => null) : null;
    const clinicId = clinic?.id || 1;
    sessionId = `wa_${clinicId}_` + from.slice(-10);
    const prompt   = clinic ? await buildPromptWithSlots(clinic, from, sessionId) : buildDemoPrompt();

    if (clinic?.id) {
      let usage = { count: 0, limit: null, pct: 0, blocked: false };
      try {
        usage = await Promise.race([
          incrementConversation(clinic.id),
          new Promise((_, rej) => setTimeout(() => rej(new Error('incrementConversation timeout')), 4000))
        ]);
        checkAndNotifyUsage(usage, clinic.id).catch(e => console.error('usage notify:', e.message));
      } catch(e) {
        console.warn('[WA] incrementConversation failed:', e.message);
      }
      if (usage.blocked) {
        await sendWhatsAppMessage(from, 'Lo sentimos, la clínica ha alcanzado el límite de conversaciones este mes. Llámenos directamente para ayudarle.');
        return;
      }
      recordConsent(clinic.id, from, 'inbound').catch(() => {});
    }

    // NPS score detection
    const scoreMatch = msg.match(/^(\d{1,2})$/);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1]);
      if (score >= 1 && score <= 10) {
        const { rows: npsRows } = await pool.query(
          'SELECT id FROM nps_pending WHERE session_id=$1 AND sent_at IS NOT NULL AND score IS NULL',
          [sessionId]
        ).catch(() => ({ rows: [] }));
        if (npsRows.length) {
          await saveNpsScore(sessionId, score).catch(() => {});
          const cfg = clinic?.config || {};
          let thankMsg = score >= 7 ? '¡Muchas gracias por su valoración! 😊 Nos alegra saber que estuvo satisfecho.' : '¡Gracias por su opinión! Trabajaremos para mejorar su experiencia 💪';
          if (score >= 8 && cfg.google_review_url) {
            thankMsg += `\n\nSi tiene un momento, le agradecemos mucho una reseña: ${cfg.google_review_url} ⭐`;
          }
          await sendWhatsAppMessage(from, thankMsg).catch(() => {});
          return;
        }
      }
    }

    if (processingSessions.has(sessionId)) {
      console.warn(`[Concurrent] ${sessionId} ya en proceso, mensaje descartado`);
      return;
    }
    processingSessions.add(sessionId);

    const urgent   = isUrgent(msg, clinic);
    const inManual = manualSessions.has(sessionId);
    const io       = req.app.get('io');

    const savedAt = new Date().toISOString();
    const room = `clinic_${clinicId}`;
    // Emit immediately — don't wait for DB writes to avoid blocking on slow queries
    io?.to(room).emit('message:new', {
      session_id: sessionId, from_number: from, content: msg, direction: 'inbound',
      created_at: savedAt, responded_by: 'human', urgent, manual: inManual
    });
    // DB writes are fire-and-forget in the critical path
    saveMessage({ clinic_id: clinicId, session_id: sessionId, direction: 'inbound', content: msg, from_number: from }).catch(() => {});
    setConvState(sessionId, clinicId, { status: 'open', last_msg_at: new Date() }).catch(() => {});

    const pushTitle = urgent ? '🔴 Mensaje urgente' : '💬 Nuevo mensaje WhatsApp';
    const fromD = from.replace(/\D/g,'');
    const fromFmt = fromD.length >= 11 ? `+${fromD.slice(0,2)} ${fromD.slice(2,5)} ${fromD.slice(5,8)} ${fromD.slice(8)}` : from;
    sendPushToClinic(clinicId, pushTitle, `${fromFmt}: ${msg.slice(0, 60)}`).catch(() => {});

    const history     = await getHistoryFromMessages(clinicId, sessionId, 40);
    const contextMsgs = buildContextMessages(history, 1800);

    if (inManual) {
      openai.chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-4o',
        messages: [{ role:'system', content: prompt + '\n[Modo co-pilot: redacta la respuesta ideal pero el agente humano la revisará antes de enviar]' }, ...contextMsgs, { role:'user', content: msg }],
        max_tokens: 250, temperature: 0.3
      }).then(r => {
        const suggestion = r.choices[0].message.content.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
        io?.to(`clinic_${clinicId}`).emit('copilot:suggestion', { session_id: sessionId, suggestion });
      }).catch(() => {});
      return;
    }

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o',
      messages: [{ role:'system', content: prompt }, ...contextMsgs, { role:'user', content: visionContent || msg }],
      max_tokens: 320, temperature: 0.3
    });
    let reply = completion.choices[0].message.content;
    const match = reply.match(/CITA_CONFIRMADA\|(.+)/);
    if (match) {
      reply = reply.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
      const parts = Object.fromEntries(match[1].split('|').map(p => {
        const idx = p.indexOf('=');
        return idx < 0 ? [p, ''] : [p.slice(0, idx), p.slice(idx + 1)];
      }));
      const scheduledTs = parseApptTimestamp(parts.fecha, parts.hora);
      const patientName  = parts.nombre  || null;
      const patientEmail = parts.email   || null;
      createAppointmentFull({
        clinic_id: clinicId, patient_name: patientName || 'Paciente',
        patient_phone: from, service: parts.tratamiento || null,
        scheduled_ts: scheduledTs, scheduled_at: `${parts.fecha||''} ${parts.hora||''}`.trim(),
        source: 'bot', status: 'confirmed',
        professional: parts.profesional || null,
        patient_email: patientEmail,
      }).then(appt => {
        auditLog(clinicId, null, 'bot_booking', { appt_id: appt?.id, phone: from, service: parts.tratamiento }).catch(() => {});
        if (appt) io?.to(`clinic_${clinicId}`).emit('appt:created', appt);
      }).catch(e => console.error('[Bot] appt create:', e.message));
      // Save patient data to conversation profile
      if (patientName || patientEmail) {
        setConvState(sessionId, clinicId, { patient_name: patientName, patient_email: patientEmail }).catch(() => {});
      }
      scheduleNps(clinicId, sessionId, from).catch(() => {});
    }

    // Sentiment detection
    const sentMatch = reply.match(/\nSENTIMIENTO\|(.+)/);
    if (sentMatch) {
      reply = reply.replace(/\nSENTIMIENTO\|.+/, '').trim();
      if (sentMatch[1].trim() === 'negativo') {
        io?.to(`clinic_${clinicId}`).emit('conv:sentiment', { session_id: sessionId, from_number: from, level: 'negativo' });
      }
    }

    // CRM data extraction
    const dataMatch = reply.match(/\nDATOS\|(.+)/);
    if (dataMatch) {
      reply = reply.replace(/\nDATOS\|.+/, '').trim();
      const insights = Object.fromEntries(
        dataMatch[1].split('|').map(p => { const i = p.indexOf('='); return i < 0 ? null : [p.slice(0,i), p.slice(i+1)]; }).filter(Boolean)
      );
      if (Object.keys(insights).length) {
        updatePatientInsights(sessionId, insights).catch(() => {});
        io?.to(`clinic_${clinicId}`).emit('conv:insight', { session_id: sessionId, from_number: from, insights });
      }
    }

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
    console.error('[WA] error:', err?.message || err);
  } finally {
    processingSessions.delete(sessionId);
  }
});

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

const SESSION_IDLE_MS = 8 * 60 * 60 * 1000; // 8h

function requireAuth(req, res, next) {
  if (!req.session?.clinic) return res.redirect('/login');
  const last = req.session.lastActivity || Date.now();
  if (Date.now() - last > SESSION_IDLE_MS) return req.session.destroy(() => res.redirect('/login'));
  const exp = req.session.clinic.demo_expires_at;
  if (exp && new Date(exp) < new Date()) return res.redirect('/demo-expirada');
  req.session.lastActivity = Date.now();
  next();
}

function requirePlan(...plans) {
  return async (req, res, next) => {
    // Refresh plan from DB so upgrades take effect without re-login
    try {
      const { rows } = await pool.query('SELECT plan FROM clinics WHERE id=$1', [req.session.clinic.id]);
      if (rows[0]) req.session.clinic.plan = rows[0].plan;
    } catch {}
    if (plans.includes(req.session?.clinic?.plan)) return next();
    res.status(403).json({ error: 'Esta función requiere el plan Pro o Clínica.', upgrade: true });
  };
}

// Role: owner > admin > staff. Owner = the clinic account itself.
const ROLE_RANK = { owner: 3, admin: 2, staff: 1 };
function requireRole(minRole) {
  return (req, res, next) => {
    const role = req.session?.staffRole || (req.session?.clinic ? 'owner' : null);
    if (!role || (ROLE_RANK[role] || 0) < (ROLE_RANK[minRole] || 0)) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
}

// Helper: actor object from current session
function sessionActor(req) {
  if (req.session.staffId) return { id: req.session.staffId, type: 'staff', name: req.session.staffName };
  return { id: req.session.clinic?.id, type: 'owner', name: req.session.clinic?.name };
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
function isUrgent(text, clinic) {
  if (URGENT_PATTERN.test(text || '')) return true;
  const custom = (clinic?.config?.urgent_keywords || '').split(',').map(k => k.trim()).filter(Boolean);
  return custom.some(k => (text || '').toLowerCase().includes(k.toLowerCase()));
}

// In-memory manual mode per session (cleared on restart — fine for now)
const manualSessions = new Set();
const processingSessions = new Set(); // guard contra mensajes concurrentes

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
CITAS — 4 pasos obligatorios en orden:
1) Pide nombre y apellidos ANTES de hablar de días u horas.
2) Ofrece SOLO huecos de DISPONIBILIDAD REAL. Si el paciente pide uno que no está: "Ese horario no está libre, pero tengo [opciones reales]." Si no hay disponibilidad online: "Le llama el equipo hoy para cuadrar fecha" — NO emitas CITA_CONFIRMADA.
3) Pide email para el recordatorio (opcional si no quiere darlo).
4) Resume y pide confirmación explícita: "Confirmo [servicio] el [día] a las [hora] para [nombre], ¿verdad?" — SOLO tras el sí del paciente emite: CITA_CONFIRMADA|tratamiento=...|fecha=...|hora=...|nombre=...|email=...|profesional=...
NUNCA emitas CITA_CONFIRMADA sin confirmación explícita. NUNCA inventes horas fuera de DISPONIBILIDAD REAL. Cancelar con 24h+.
Desconocido: "Llámenos al +34 932 123 456, le atendemos encantados." No confirmes ser IA salvo pregunta directa.`;
}

// Convierte "Lun 23/01" + "10:00" → Date ISO para scheduled_ts
function parseApptTimestamp(fechaStr = '', horaStr = '') {
  if (!fechaStr || !horaStr) return null;
  try {
    // Accepts "Lun 23/01", "23/01", "23/01/2025", or ISO date
    const dateClean = fechaStr.replace(/^[A-Za-záéíóúÁÉÍÓÚ]+\s+/, '').trim();
    let d;
    if (/^\d{4}-\d{2}-\d{2}/.test(dateClean)) {
      d = new Date(`${dateClean}T${horaStr}:00`);
    } else {
      const parts = dateClean.split('/');
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const year = parts[2] ? parseInt(parts[2]) : new Date().getFullYear();
      const [hh, mm] = horaStr.split(':').map(Number);
      d = new Date(year, month, day, hh, mm || 0);
    }
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

async function buildPromptWithSlots(clinic, phone = null, sessionId = null) {
  try {
    const [slots, staffRows, memory] = await Promise.all([
      getAvailableSlotsForBot(clinic.id, 5).catch(() => ({})),
      getStaff(clinic.id).catch(() => []),
      (phone && sessionId) ? getPatientMemory(clinic.id, sessionId, phone).catch(() => null) : Promise.resolve(null)
    ]);
    const base  = buildPromptForClinic(clinic, staffRows);
    const mem   = memory || '';
    const lines = Object.entries(slots).map(([day, times]) => `  ${day}: ${times.join(', ')}`).join('\n');
    const slots_section = lines
      ? `\n\nDISPONIBILIDAD REAL (próximos 5 días — USA SOLO ESTOS HUECOS, no inventes otros):\n${lines}`
      : `\n\nDISPONIBILIDAD REAL: No hay huecos disponibles los próximos días. NO ofrezcas fechas ni horas. Indica que el equipo contactará al paciente para confirmar.`;
    return base + mem + slots_section;
  } catch { return buildPromptForClinic(clinic); }
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
app.get('/demo-expirada', (req, res) => res.sendFile('demo-expirada.html', { root: 'public' }));
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
  const { rows } = await pool.query(`SELECT id,name,email,plan,whatsapp_number,created_at,config->>'demo_expires_at' AS demo_expires_at FROM clinics ORDER BY created_at DESC`);
  res.json(rows);
});

app.get('/admin/resend-setup', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query('SELECT id,name,email,plan,setup_token FROM clinics WHERE id=$1', [req.query.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrada' });
    const c = rows[0];
    let token = c.setup_token;
    if (!token) { token = crypto.randomBytes(16).toString('hex'); await pool.query('UPDATE clinics SET setup_token=$1 WHERE id=$2', [token, c.id]); }
    const appBase = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
    await sendEmail({ to: c.email, subject: `Configura tu asistente Cliniflux`, html: emailSetupLink(c.name, c.plan||'starter', `${appBase}/onboarding?token=${token}`) });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Onboarding ──────────────────────────────────────────────────────────────

// Tú creas el token: GET /admin/new-clinic?secret=ADMIN_SECRET&email=x&name=y&plan=pro
app.get('/admin/new-clinic', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) {
    return res.status(403).send('Forbidden');
  }
  const { email, name, plan, demo_days } = req.query;
  if (!email || !name) return res.status(400).send('email y name requeridos');
  try {
    const token = crypto.randomBytes(16).toString('hex');
    const tempPass = crypto.randomBytes(8).toString('hex');
    const config = {};
    if (demo_days && parseInt(demo_days) > 0) {
      const exp = new Date(); exp.setDate(exp.getDate() + parseInt(demo_days));
      config.demo_expires_at = exp.toISOString();
      config.is_demo = 'true';
    }
    await createClinic({ email, password_hash: hashPassword(tempPass), name, plan: plan||'starter', setup_token: token, config: Object.keys(config).length ? config : undefined });
    res.json({ ok: true, setup_url: `/onboarding?token=${token}`, temp_password: tempPass, demo_expires_at: config.demo_expires_at || null });
  } catch(e) {
    res.status(500).send(e.message);
  }
});

// GET /ops/set-plan?secret=X&email=X&plan=pro
app.get('/ops/set-plan', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) return res.status(403).send('Forbidden');
  const { email, plan } = req.query;
  if (!email || !plan) return res.status(400).send('email y plan requeridos');
  try {
    const { rowCount } = await pool.query('UPDATE clinics SET plan=$1 WHERE email=$2', [plan, email]);
    res.json({ ok: true, updated: rowCount });
  } catch(e) { res.status(500).send(e.message); }
});

// GET /ops/clear-demo-appts?secret=X&email=demo@cliniflux.com&month=2026-04
app.get('/ops/clear-demo-appts', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) return res.status(403).send('Forbidden');
  const email = req.query.email || 'demo@cliniflux.com';
  const month = req.query.month || '2026-04';
  try {
    const { rows } = await pool.query('SELECT id FROM clinics WHERE email=$1', [email]);
    if (!rows.length) return res.status(404).send('Clínica no encontrada');
    const { rowCount } = await pool.query(
      `DELETE FROM appointments WHERE clinic_id=$1 AND scheduled_ts >= $2 AND scheduled_ts < ($2::date + INTERVAL '1 month')`,
      [rows[0].id, month + '-01']
    );
    res.json({ ok: true, deleted: rowCount });
  } catch(e) { res.status(500).send(e.message); }
});

// GET /ops/restore-demo?secret=X&email=demo@cliniflux.com
app.get('/ops/restore-demo', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) return res.status(403).send('Forbidden');
  const email = req.query.email || 'demo@cliniflux.com';
  try {
    const { rows } = await pool.query('SELECT id FROM clinics WHERE email=$1', [email]);
    if (!rows.length) return res.status(404).send('Clínica no encontrada');
    const cid = rows[0].id;

    const appts = [
      // Lunes 27 abril
      { ts:'2026-04-27T09:00:00', patient:'Ana García',    phone:'612100001', service:'Limpieza dental',       professional:'Sara Llopis',      room:'Box 1', price:65,  dur:60,  status:'confirmed' },
      { ts:'2026-04-27T10:30:00', patient:'Roberto Silva', phone:'612100002', service:'Revisión general',      professional:'Dr. Pau Ferrer',   room:'Box 2', price:35,  dur:30,  status:'confirmed' },
      { ts:'2026-04-27T12:00:00', patient:'Marta Puig',    phone:'612100003', service:'Empaste resina',        professional:'Dr. Pau Ferrer',   room:'Box 2', price:90,  dur:60,  status:'pending'   },
      // Martes 28 abril
      { ts:'2026-04-28T09:30:00', patient:'Josep Roca',    phone:'612100004', service:'Consulta ortodoncia',   professional:'Dra. Carmen Vidal',room:'Box 3', price:0,   dur:30,  status:'confirmed' },
      { ts:'2026-04-28T11:00:00', patient:'Laura Díaz',    phone:'612100005', service:'Blanqueamiento LED',    professional:null,               room:'Box 1', price:280, dur:90,  status:'confirmed' },
      { ts:'2026-04-28T16:00:00', patient:'Carlos Méndez', phone:'612100006', service:'Extracción simple',     professional:'Dr. Pau Ferrer',   room:'Box 3', price:80,  dur:45,  status:'confirmed' },
      // Miércoles 29 abril
      { ts:'2026-04-29T11:30:00', patient:'Isabel Valls',  phone:'612100007', service:'Endodoncia',            professional:'Dr. Pau Ferrer',   room:'Box 2', price:350, dur:90,  status:'confirmed' },
      // Ayer (25 abril — sábado) — completed
      { ts:'2026-04-25T09:00:00', patient:'Ana García',    phone:'612100001', service:'Limpieza dental',       professional:'Sara Llopis',      room:'Box 1', price:65,  dur:60,  status:'completed' },
      { ts:'2026-04-25T10:00:00', patient:'Roberto Silva', phone:'612100002', service:'Revisión general',      professional:'Dr. Pau Ferrer',   room:'Box 2', price:35,  dur:30,  status:'completed' },
      { ts:'2026-04-25T11:00:00', patient:'Pedro Ruiz',    phone:'612100008', service:'Implante dental',       professional:'Dr. Pau Ferrer',   room:'Box 2', price:1200,dur:120, status:'completed' },
      // Hace 3 días (23 abril — jueves) — no show
      { ts:'2026-04-23T10:00:00', patient:'Sofía Martín',  phone:'612100009', service:'Limpieza dental',       professional:'Sara Llopis',      room:'Box 1', price:65,  dur:60,  status:'no_show',  notes:'Paciente no se presentó' },
    ];

    let inserted = 0;
    for (const a of appts) {
      const d = new Date(a.ts); const day = d.getDate(); const h = d.getHours(); const m = d.getMinutes();
      await pool.query(
        `INSERT INTO appointments (clinic_id,patient_name,patient_phone,service,scheduled_ts,scheduled_at,duration_min,status,professional,price,room,source,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12)`,
        [cid, a.patient, a.phone, a.service, a.ts,
         `${day.toString().padStart(2,'0')}/${d.getMonth()===3?'04':'0'+d.getMonth()}/2026 ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`,
         a.dur, a.status, a.professional||null, a.price||null, a.room, a.notes||null]
      );
      inserted++;
    }

    // Bloqueo recurrente miércoles 10:00-11:00
    await pool.query(
      `INSERT INTO blocked_slots (clinic_id,title,start_ts,end_ts,room,professional,recurring)
       VALUES ($1,'Reunión de equipo','2026-04-29T10:00:00','2026-04-29T11:00:00',null,null,'weekly')
       ON CONFLICT DO NOTHING`,
      [cid]
    );

    res.json({ ok: true, inserted, blocked_slots: 1 });
  } catch(e) { res.status(500).send(e.message); }
});



app.get('/onboarding', async (req, res) => {
  const clinic = await getClinicBySetupToken(req.query.token).catch(() => null);
  if (!clinic) return res.redirect('/login');
  res.sendFile('onboarding.html', { root: 'public' });
});

app.post('/api/onboarding', async (req, res) => {
  const { token, phone, address, hours, services, extra, assistant_name, whatsapp_number, new_password, google_review_url } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  try {
    const clinic = await getClinicBySetupToken(token);
    if (!clinic) return res.status(404).json({ error: 'Token inválido o ya usado' });
    const config = { phone, address, hours, services, extra, assistant_name: assistant_name||'Natalia', email: clinic.email };
    if (google_review_url) config.google_review_url = google_review_url;
    await updateClinicConfig(clinic.id, config);
    const updates = ['setup_token=NULL'];
    const vals = [];
    if (whatsapp_number) { vals.push(whatsapp_number.replace(/\D/g,'')); updates.push(`whatsapp_number=$${vals.length}`); vals.push(whatsapp_number.replace(/\D/g,'').slice(-9)); updates.push(`whatsapp_normalized=$${vals.length}`); }
    if (new_password) { vals.push(hashPassword(new_password)); updates.push(`password_hash=$${vals.length}`); }
    vals.push(clinic.id);
    await pool.query(`UPDATE clinics SET ${updates.join(',')} WHERE id=$${vals.length}`, vals);
    // Auto-login
    await new Promise((ok, fail) => req.session.regenerate(e => e ? fail(e) : ok()));
    const waNum = await pool.query('SELECT whatsapp_number FROM clinics WHERE id=$1', [clinic.id]).then(r => r.rows[0]?.whatsapp_number || null).catch(() => null);
    req.session.clinic = { id: clinic.id, name: clinic.name, email: clinic.email, plan: clinic.plan, whatsapp_number: waNum, demo_expires_at: config.demo_expires_at || clinic.config?.demo_expires_at || null };
    // Emails en paralelo
    const appBase = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
    const cfg = { phone, address, hours, services, extra, assistant_name: assistant_name||'Natalia' };
    const notify = process.env.EMAIL_NOTIFY || process.env.EMAIL_FROM || 'contacto@cliniflux.es';
    await Promise.allSettled([
      sendEmail({ to: clinic.email, subject: `Configuración recibida — activaremos tu WhatsApp hoy`, html: emailWelcomeOnboarding(clinic.name || 'Tu clínica', appBase + '/login') }),
      sendEmail({ to: notify, subject: `🔧 Nuevo cliente — ${clinic.name}`, html: emailOnboardingSetup({ clinic, cfg, whatsapp_number }) }),
    ]);
    res.json({ ok: true, redirect: '/dashboard' });
  } catch(e) {
    console.error('Onboarding:', e.message);
    res.status(500).json({ error: 'Error guardando configuración' });
  }
});

// Registro libre (plan starter, sin Stripe)

// Admin: activar WhatsApp de una clínica en un clic
app.post('/api/admin/activate/:id', async (req, res) => {
  if (req.query.secret !== (process.env.ADMIN_SECRET || 'cliniflux-admin')) return res.status(403).json({ error: 'Forbidden' });
  const { whatsapp_number } = req.body;
  if (!whatsapp_number) return res.status(400).json({ error: 'whatsapp_number requerido' });
  try {
    const waFull = whatsapp_number.replace(/\D/g,'');
    const waShort = waFull.slice(-9);
    const { rows } = await pool.query(
      'UPDATE clinics SET whatsapp_number=$1, whatsapp_normalized=$2 WHERE id=$3 RETURNING name,email',
      [waFull, waShort, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Clínica no encontrada' });
    const { name, email } = rows[0];
    const loginUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'') + '/login';
    sendEmail({ to: email, subject: `¡Tu WhatsApp ya está activo en Cliniflux!`, html: emailWhatsAppActivated(name, loginUrl) }).catch(() => {});
    res.json({ ok: true, name });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
      req.session.clinic = { id: clinic.id, name: clinic.name, email: clinic.email, plan: clinic.plan, whatsapp_number: clinic.whatsapp_number || null, demo_expires_at: clinic.config?.demo_expires_at || null };
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

app.get('/api/analytics', requireAuth, async (req, res) => {
  try { res.json(await getAnalytics(req.session.clinic.id)); }
  catch(e) { res.status(500).json({ error: 'Error' }); }
});

// ── WhatsApp Business API (Meta) ────────────────────────────────────────────

async function downloadWaMedia(mediaId) {
  const token = process.env.WHATSAPP_TOKEN;
  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { url, mime_type } = await metaRes.json();
  const mediaRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  return { buffer, mimeType: mime_type || 'application/octet-stream' };
}

async function transcribeAudio(buffer, mimeType) {
  const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'ogg';
  const file = new File([buffer], `audio.${ext}`, { type: mimeType });
  const res  = await openai.audio.transcriptions.create({ model: 'whisper-1', file, language: 'es' });
  return res.text?.trim() || '';
}

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
    if (rows[0]) { const staff = await getStaff(rows[0].id).catch(()=>[]); prompt = buildPromptForClinic(rows[0], staff); clinicId = rows[0].id; }
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
      model: process.env.AI_MODEL || 'gpt-4o',
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
  const { name, logo_url, phone, email_clinic, address, hours, services, extra, assistant_name, whatsapp_number, google_review_url, urgent_keywords, quick_chips, auto_reactivacion, reactivacion_msg, auto_reminders, reminder_hours, auto_followup, followup_hours, auto_review } = req.body;
  try {
    const { rows } = await pool.query('SELECT config FROM clinics WHERE id=$1', [req.session.clinic.id]);
    const cfg = { ...(rows[0]?.config || {}), phone, email: email_clinic, address, hours, services, extra, assistant_name };
    if (logo_url !== undefined) cfg.logo_url = logo_url || null;
    if (google_review_url !== undefined) cfg.google_review_url = google_review_url || null;
    if (urgent_keywords !== undefined) cfg.urgent_keywords = urgent_keywords || null;
    if (Array.isArray(quick_chips)) cfg.quick_chips = quick_chips.filter(Boolean);
    if (auto_reactivacion !== undefined) cfg.auto_reactivacion = !!auto_reactivacion;
    if (reactivacion_msg !== undefined) cfg.reactivacion_msg = reactivacion_msg || null;
    if (auto_reminders !== undefined) cfg.auto_reminders = String(!!auto_reminders);
    if (reminder_hours !== undefined) cfg.reminder_hours = String(parseInt(reminder_hours) || 24);
    if (auto_followup !== undefined) cfg.auto_followup = String(!!auto_followup);
    if (followup_hours !== undefined) cfg.followup_hours = String(parseInt(followup_hours) || 48);
    if (auto_review !== undefined) cfg.auto_review = String(!!auto_review);
    const waNum = whatsapp_number ? whatsapp_number.replace(/\D/g,'').slice(-9) : null;
    await pool.query(
      `UPDATE clinics SET config=$1, name=COALESCE($2,name),
       whatsapp_number=COALESCE(NULLIF($3,''),whatsapp_number),
       whatsapp_normalized=COALESCE($4,whatsapp_normalized)
       WHERE id=$5`,
      [JSON.stringify(cfg), name || null, whatsapp_number || '', waNum, req.session.clinic.id]
    );
    req.session.clinic.name = name || req.session.clinic.name;
    if (whatsapp_number) req.session.clinic.whatsapp_number = whatsapp_number.replace(/\D/g,'').slice(-9) || req.session.clinic.whatsapp_number;
    auditLog(req.session.clinic.id, sessionActor(req), 'settings.updated', 'clinic', req.session.clinic.id, {}).catch(() => {});
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings/rooms', requireAuth, async (req, res) => {
  const { rooms } = req.body;
  if (!Array.isArray(rooms)) return res.status(400).json({ error: 'rooms debe ser array' });
  try {
    const { rows } = await pool.query('SELECT config FROM clinics WHERE id=$1', [req.session.clinic.id]);
    const cfg = { ...(rows[0]?.config || {}), rooms: rooms.filter(r => typeof r === 'string' && r.trim()).map(r => r.trim()) };
    await pool.query('UPDATE clinics SET config=$1 WHERE id=$2', [JSON.stringify(cfg), req.session.clinic.id]);
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

// ── Paso 5: Escalado a manual — email con resumen GPT ───────────────────────

async function escalateConversation(sessionId, clinicId) {
  // Obtener últimos mensajes + datos de clínica en paralelo
  const [msgs, clinicRows] = await Promise.all([
    getMessages(clinicId, sessionId, 10),
    pool.query('SELECT name, email, config FROM clinics WHERE id=$1', [clinicId])
  ]);
  if (!msgs.length) return;
  const clinic = clinicRows.rows[0];
  if (!clinic) return;

  const fromNumber = msgs[0]?.from_number || sessionId;
  const transcript = msgs.map(m => `${m.direction === 'inbound' ? 'Paciente' : 'Natalia'}: ${m.content}`).join('\n');

  // GPT summary — 80 tokens max, muy barato
  let summary = '';
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Resume en 2 frases qué quiere el paciente y por qué se ha escalado a atención manual. Directo, sin adornos.' },
        { role: 'user', content: transcript }
      ],
      max_tokens: 80, temperature: 0.2
    });
    summary = r.choices[0].message.content;
  } catch(e) { summary = '(resumen no disponible)'; }

  const notify = process.env.EMAIL_NOTIFY || clinic.email;
  const subject = `🔔 Conversación escalada a manual — ${fromNumber.slice(-9)} — ${clinic.name}`;
  const html = EMAIL_BASE(`
<p style="margin:0 0 16px"><span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:700;letter-spacing:0.6px;padding:5px 14px;border-radius:100px;text-transform:uppercase;font-family:sans-serif">Atención manual requerida</span></p>
<h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;font-family:sans-serif">Paciente necesita atención humana</h1>
<p style="margin:0 0 20px;font-size:14px;color:#64748b;font-family:sans-serif">Número: <strong>${fromNumber}</strong> · Clínica: ${clinic.name}</p>
<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:20px">
  <p style="margin:0;font-size:13px;font-weight:700;color:#166534;font-family:sans-serif;margin-bottom:4px">Resumen IA</p>
  <p style="margin:0;font-size:14px;color:#14532d;font-family:sans-serif;line-height:1.6">${summary}</p>
</div>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px">
  <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;font-family:sans-serif">Últimos mensajes</p>
  <pre style="margin:0;font-size:12px;color:#334155;font-family:monospace;white-space:pre-wrap;line-height:1.7">${transcript}</pre>
</div>
<a href="https://cliniflux.es/dashboard" style="display:inline-block;background:#2563eb;color:#fff;font-family:sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:40px">Abrir dashboard →</a>
`, `${clinic.name} — paciente ${fromNumber.slice(-9)} espera atención`);

  await sendEmail({ to: notify, subject, html });
}

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

// Toggle manual mode — persiste en DB + pausa IA
app.post('/api/conversations/:sessionId/mode', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { manual } = req.body;
  const clinicId = req.session.clinic.id;
  if (manual) manualSessions.add(sessionId); else manualSessions.delete(sessionId);
  await setConvState(sessionId, clinicId, { manual_mode: !!manual }).catch(() => {});
  req.app.get('io')?.to(`clinic_${clinicId}`).emit('mode:changed', { session_id: sessionId, manual: !!manual });

  // Paso 5: email de escalado al activar manual
  if (manual) {
    escalateConversation(sessionId, clinicId).catch(e => console.error('escalate:', e.message));
  }

  res.json({ ok: true, manual: !!manual });
});

app.get('/api/conversations/:sessionId/mode', requireAuth, (req, res) => {
  res.json({ manual: manualSessions.has(req.params.sessionId) });
});

// Enviar respuesta manual desde dashboard
app.post('/api/conversations/:sessionId/reply', requireAuth, rateLimit(60, 60000), async (req, res) => {
  const { sessionId } = req.params;
  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.length > 1000) return res.status(400).json({ error: 'Texto inválido' });
  const clinicId = req.session.clinic.id;

  // Obtener from_number del último mensaje de esa sesión
  const msgs = await getMessages(clinicId, sessionId, 1).catch(() => []);
  const to = msgs[0]?.from_number;
  if (!to) return res.status(404).json({ error: 'Número no encontrado' });

  await Promise.all([
    sendWhatsAppMessage(to, text),
    saveMessage({ clinic_id: clinicId, session_id: sessionId, direction: 'outbound', content: text, from_number: to, responded_by: 'human' }).catch(() => {}),
  ]);

  const io = req.app.get('io');
  const sentAt = new Date().toISOString();
  io?.to(`clinic_${clinicId}`).emit('message:sent', {
    session_id: sessionId, from_number: to, content: text,
    direction: 'outbound', created_at: sentAt, responded_by: 'human'
  });
  res.json({ ok: true });
});

// ── Paso 7: Web Push ──────────────────────────────────────────────────────────

async function sendPushToClinic(clinicId, title, body, url = '/dashboard') {
  const subs = await getPushSubscriptions(clinicId).catch(() => []);
  const payload = JSON.stringify({ title, body, url });
  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    } catch(e) {
      if (e.statusCode === 410 || e.statusCode === 404) await removePushSubscription(sub.endpoint).catch(() => {});
    }
  }));
}

app.get('/api/push/vapid-public', (_req, res) => res.json({ key: VAPID_PUBLIC }));

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Suscripción inválida' });
  await savePushSubscription(req.session.clinic.id, { endpoint, keys }).catch(() => {});
  res.json({ ok: true });
});

app.delete('/api/push/subscribe', requireAuth, async (req, res) => {
  await removePushSubscription(req.body.endpoint).catch(() => {});
  res.json({ ok: true });
});

// ── Paso 8: Notas internas por conversación ───────────────────────────────────

app.get('/api/conversations/:sessionId/notes', requireAuth, async (req, res) => {
  const notes = await getConvNotes(req.params.sessionId, req.session.clinic.id).catch(() => '');
  res.json({ notes });
});

app.post('/api/conversations/:sessionId/notes', requireAuth, async (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== 'string' || notes.length > 2000) return res.status(400).json({ error: 'Notas inválidas' });
  await setConvState(req.params.sessionId, req.session.clinic.id, { notes }).catch(() => {});
  res.json({ ok: true });
});

// Cierre manual desde dashboard
app.post('/api/conversations/:sessionId/close', requireAuth, async (req, res) => {
  await setConvState(req.params.sessionId, req.session.clinic.id, { status: 'closed' }).catch(() => {});
  req.app.get('io')?.to(`clinic_${req.session.clinic.id}`).emit('conv:closed', { session_id: req.params.sessionId });
  res.json({ ok: true });
});

// Reapertura de conversación (desde perfil de cliente)
app.post('/api/conversations/:sessionId/reopen', requireAuth, async (req, res) => {
  await setConvState(req.params.sessionId, req.session.clinic.id, { status: 'open' }).catch(() => {});
  res.json({ ok: true });
});

// ── F4: Broadcast ─────────────────────────────────────────────────────────────

async function runBroadcast(broadcast, clinicId, io) {
  try {
    const leads = broadcast.segment === 'risk'
      ? await getAtRiskPatients(clinicId)
      : await getImportedLeads(clinicId);
    const phones = [...new Set(leads.map(l => l.telefono).filter(Boolean))];
    await updateBroadcast(broadcast.id, { status: 'sending', total: phones.length });
    io?.to(`clinic_${clinicId}`).emit('broadcast:start', { id: broadcast.id, total: phones.length });
    let sent = 0, failed = 0;
    for (const phone of phones) {
      try { await sendWhatsAppMessage(phone, broadcast.message); sent++; } catch(e) { failed++; }
      await updateBroadcast(broadcast.id, { sent, failed });
      io?.to(`clinic_${clinicId}`).emit('broadcast:progress', { id: broadcast.id, sent, failed, total: phones.length });
      await new Promise(r => setTimeout(r, 1200));
    }
    await updateBroadcast(broadcast.id, { status: 'done' });
    io?.to(`clinic_${clinicId}`).emit('broadcast:done', { id: broadcast.id, sent, failed });
  } catch(e) {
    await updateBroadcast(broadcast.id, { status: 'failed' }).catch(() => {});
    console.error('[Broadcast]', e.message);
  }
}

app.post('/api/broadcast', requireAuth, requirePlan('pro','clinica'), rateLimit(5, 60000), async (req, res) => {
  const { name, message, segment } = req.body;
  if (!message || message.length < 5 || message.length > 1000) return res.status(400).json({ error: 'Mensaje inválido (5-1000 chars)' });
  const broadcast = await createBroadcast(req.session.clinic.id, { name, message, segment: segment || 'all' });
  auditLog(req.session.clinic.id, sessionActor(req), 'broadcast.started', 'broadcast', broadcast.id, { name, segment }).catch(() => {});
  res.json({ ok: true, id: broadcast.id });
  runBroadcast(broadcast, req.session.clinic.id, req.app.get('io'));
});

app.get('/api/broadcasts', requireAuth, async (req, res) => {
  const list = await getBroadcasts(req.session.clinic.id).catch(() => []);
  res.json(list);
});

// ── NPS results ───────────────────────────────────────────────────────────────

app.get('/api/nps', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE score IS NOT NULL)  AS scored,
      ROUND(AVG(score) FILTER (WHERE score IS NOT NULL),1) AS avg_score,
      COUNT(*) FILTER (WHERE score >= 9)          AS promoters,
      COUNT(*) FILTER (WHERE score <= 6)          AS detractors,
      COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS total_sent
    FROM nps_pending WHERE clinic_id=$1
  `, [req.session.clinic.id]);
  const r = rows[0];
  const scored = parseInt(r.scored) || 0;
  const promoters = parseInt(r.promoters) || 0;
  const detractors = parseInt(r.detractors) || 0;
  res.json({
    avg_score   : r.avg_score ? parseFloat(r.avg_score) : null,
    nps         : scored ? Math.round((promoters - detractors) / scored * 100) : null,
    scored,
    total_sent  : parseInt(r.total_sent) || 0,
  });
});

// ── F3: CRM endpoints ─────────────────────────────────────────────────────────

app.get('/api/patients/:phone', requireAuth, async (req, res) => {
  const data = await getPatientData(req.session.clinic.id, decodeURIComponent(req.params.phone)).catch(() => ({ appointments: [], lead: null }));
  res.json(data);
});

app.delete('/api/patients/:phone', requireAuth, async (req, res) => {
  const clinicId = req.session.clinic.id;
  const raw = decodeURIComponent(req.params.phone).replace(/\D/g, '');
  const suffix10 = raw.slice(-10);
  const suffix9  = raw.slice(-9);
  try {
    // Delete messages (from_number ends with last 10 digits)
    await pool.query(`DELETE FROM messages WHERE clinic_id=$1 AND right(replace(from_number,'+',''),10)=$2`, [clinicId, suffix10]);
    // Delete conv_states (session_id = wa_{clinicId}_{last10})
    await pool.query(`DELETE FROM conv_states WHERE clinic_id=$1 AND session_id=$2`, [clinicId, `wa_${clinicId}_${suffix10}`]);
    // Delete appointments
    await pool.query(`DELETE FROM appointments WHERE clinic_id=$1 AND right(replace(patient_phone,'+',''),10)=$2`, [clinicId, suffix10]);
    // Delete patient notes
    await pool.query(`DELETE FROM patient_notes WHERE clinic_id=$1 AND right(phone,9)=$2`, [clinicId, suffix9]);
    // Delete imported leads
    await pool.query(`DELETE FROM imported_leads WHERE clinic_id=$1 AND right(replace(telefono,'+',''),9)=$2`, [clinicId, suffix9]);
    // Delete GDPR consents
    await pool.query(`DELETE FROM gdpr_consents WHERE clinic_id=$1 AND right(replace(phone,'+',''),9)=$2`, [clinicId, suffix9]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/patient-profile/:phone', requireAuth, async (req, res) => {
  try {
    const profile = await getEnrichedPatientProfile(req.session.clinic.id, decodeURIComponent(req.params.phone));
    res.json(profile);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/patient-note/:phone', requireAuth, async (req, res) => {
  try {
    const notes = await getPatientNote(req.session.clinic.id, decodeURIComponent(req.params.phone));
    res.json({ notes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/patient-note/:phone', requireAuth, async (req, res) => {
  try {
    const { notes } = req.body;
    if (typeof notes !== 'string') return res.status(400).json({ error: 'notes requerido' });
    await savePatientNote(req.session.clinic.id, decodeURIComponent(req.params.phone), notes.slice(0, 2000));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/crm/at-risk', requireAuth, requirePlan('pro', 'clinica'), async (req, res) => {
  const patients = await getAtRiskPatients(req.session.clinic.id).catch(() => []);
  res.json(patients);
});

// ── F5: Staff auth + CRUD + Audit ────────────────────────────────────────────

app.post('/auth/staff-login', rateLimit(10, 60000), async (req, res) => {
  const { clinic_id, email, password } = req.body;
  if (!clinic_id || !email || !password) return res.status(400).json({ error: 'Faltan campos' });
  try {
    const staff = await getStaffByEmail(clinic_id, email);
    if (!staff || !verifyPassword(password, staff.password_hash)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Error de sesión' });
      req.session.clinic = { id: clinic_id };
      req.session.staffId = staff.id;
      req.session.staffName = staff.name;
      req.session.staffRole = staff.role;
      res.json({ ok: true, name: staff.name, role: staff.role });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/staff', requireAuth, async (req, res) => {
  const staff = await getStaff(req.session.clinic.id).catch(() => []);
  res.json(staff);
});

app.post('/api/staff', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email y password requeridos' });
  if (!['admin','staff'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  try {
    const member = await createStaff(req.session.clinic.id, { name, email, password, role });
    await auditLog(req.session.clinic.id, sessionActor(req), 'staff.created', 'staff', member.id, { email, role });
    res.json(member);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email ya registrado en esta clínica' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/staff/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['admin','staff'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  await updateStaffRole(req.params.id, req.session.clinic.id, role);
  await auditLog(req.session.clinic.id, sessionActor(req), 'staff.role_changed', 'staff', req.params.id, { role });
  res.json({ ok: true });
});

app.put('/api/staff/:id/profile', requireAuth, async (req, res) => {
  const { color, specialty } = req.body;
  await updateStaffColor(req.params.id, req.session.clinic.id, color, specialty).catch(() => {});
  res.json({ ok: true });
});

app.delete('/api/staff/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await deactivateStaff(req.params.id, req.session.clinic.id);
  await auditLog(req.session.clinic.id, sessionActor(req), 'staff.deactivated', 'staff', req.params.id, {});
  res.json({ ok: true });
});

app.get('/api/audit', requireAuth, requireRole('admin'), async (req, res) => {
  const logs = await getAuditLogs(req.session.clinic.id, parseInt(req.query.limit) || 50).catch(() => []);
  res.json(logs);
});

// Audit PDF export
app.get('/api/audit/export', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const logs = await getAuditLogs(req.session.clinic.id, 200);
    const { rows: clinic } = await pool.query('SELECT name FROM clinics WHERE id=$1', [req.session.clinic.id]);
    const clinicName = clinic[0]?.name || 'Clínica';
    const ACTION_LABEL = { 'appt.created':'Cita creada','appt.updated':'Cita actualizada','appt.deleted':'Cita eliminada','broadcast.started':'Broadcast enviado','settings.updated':'Ajustes guardados','staff.created':'Miembro añadido','staff.deactivated':'Miembro quitado','staff.role_changed':'Rol cambiado' };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="auditoria-${Date.now()}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Registro de Auditoría', { align: 'center' });
    doc.fontSize(11).font('Helvetica').text(clinicName, { align: 'center' });
    doc.fontSize(9).fillColor('#666').text(`Generado: ${new Date().toLocaleString('es-ES')}`, { align: 'center' });
    doc.moveDown(1.5);

    // Table header
    doc.fillColor('#000').fontSize(9).font('Helvetica-Bold');
    doc.text('Fecha', 50, doc.y, { width: 100, continued: true });
    doc.text('Acción', 155, doc.y, { width: 160, continued: true });
    doc.text('Actor', 320, doc.y, { width: 120, continued: true });
    doc.text('Detalle', 445, doc.y, { width: 100 });
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#ccc').stroke();
    doc.moveDown(0.3);

    // Rows
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    logs.forEach((l, i) => {
      if (doc.y > 750) { doc.addPage(); }
      const y = doc.y;
      const bg = i % 2 === 0 ? '#f9f9f9' : '#ffffff';
      doc.rect(50, y - 2, 495, 14).fill(bg).fillColor('#333');
      const dt = new Date(l.created_at).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
      doc.text(dt, 50, y, { width: 100, continued: true });
      doc.text(ACTION_LABEL[l.action] || l.action, 155, y, { width: 160, continued: true });
      doc.text(l.actor_name || l.actor_type || '—', 320, y, { width: 120, continued: true });
      const meta = l.meta && Object.keys(l.meta).length ? Object.values(l.meta).filter(Boolean).slice(0,2).join(', ') : '—';
      doc.text(meta, 445, y, { width: 100 });
    });

    doc.end();
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── RGPD endpoints ────────────────────────────────────────────────────────────

app.get('/api/gdpr/consents', requireAuth, async (req, res) => {
  const consents = await getConsents(req.session.clinic.id).catch(() => []);
  res.json(consents);
});

app.post('/api/gdpr/consent', requireAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requerido' });
  await recordConsent(req.session.clinic.id, phone, 'manual', req.ip).catch(() => {});
  await auditLog(req.session.clinic.id, sessionActor(req), 'gdpr.consent_manual', 'gdpr', phone, { phone }).catch(() => {});
  res.json({ ok: true });
});

app.delete('/api/gdpr/consent/:phone', requireAuth, async (req, res) => {
  await revokeConsent(req.session.clinic.id, decodeURIComponent(req.params.phone)).catch(() => {});
  await auditLog(req.session.clinic.id, sessionActor(req), 'gdpr.consent_revoked', 'gdpr', req.params.phone, {}).catch(() => {});
  res.json({ ok: true });
});

// Session activity touch — resets inactivity timer
app.post('/api/session/touch', requireAuth, (req, res) => {
  req.session.lastActivity = Date.now();
  req.session.save(() => res.json({ ok: true }));
});

// ── Calendar endpoints ────────────────────────────────────────────────────────

app.get('/api/calendar', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start y end requeridos' });
  const appts = await getAppointmentsByRange(req.session.clinic.id, start, end).catch(() => []);
  res.json(appts);
});

app.get('/api/calendar/blocked', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start y end requeridos' });
  const slots = await getBlockedSlots(req.session.clinic.id, start, end).catch(() => []);
  res.json(slots);
});

app.post('/api/calendar/blocked', requireAuth, async (req, res) => {
  const { title, start_ts, end_ts, room, professional, recurring } = req.body;
  if (!start_ts || !end_ts) return res.status(400).json({ error: 'start_ts y end_ts requeridos' });
  try {
    const slot = await createBlockedSlot(req.session.clinic.id, { title, start_ts, end_ts, room, professional, recurring });
    res.json(slot);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/calendar/blocked/:id', requireAuth, async (req, res) => {
  const { title, start_ts, end_ts, room, professional, recurring } = req.body;
  if (!start_ts || !end_ts) return res.status(400).json({ error: 'start_ts y end_ts requeridos' });
  try {
    await pool.query(
      `UPDATE blocked_slots SET title=$1,start_ts=$2,end_ts=$3,room=$4,professional=$5,recurring=$6 WHERE id=$7 AND clinic_id=$8`,
      [title||'Bloqueado', start_ts, end_ts, room||null, professional||null, recurring||'none', req.params.id, req.session.clinic.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/calendar/blocked/:id', requireAuth, async (req, res) => {
  const ok = await deleteBlockedSlot(req.params.id, req.session.clinic.id).catch(() => false);
  if (!ok) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

app.post('/api/calendar', requireAuth, async (req, res) => {
  const { patient_name, patient_phone, service, scheduled_ts, duration_min, notes, patient_id, source, notify_whatsapp, professional, price, room } = req.body;
  if (!scheduled_ts) return res.status(400).json({ error: 'scheduled_ts requerido' });
  try {
    const appt = await createAppointmentFull({ clinic_id: req.session.clinic.id, patient_name, patient_phone, service, scheduled_ts, duration_min, notes, patient_id, source, professional, price, room });
    const io = req.app.get('io');
    io?.to(`clinic_${req.session.clinic.id}`).emit('appt:created', appt);
    auditLog(req.session.clinic.id, sessionActor(req), 'appt.created', 'appointment', appt.id, { patient_name, service, scheduled_ts }).catch(() => {});
    if (notify_whatsapp && patient_phone) {
      const clinic = await pool.query('SELECT name,config FROM clinics WHERE id=$1', [req.session.clinic.id]);
      const cfg = clinic.rows[0]?.config || {};
      const clinicName = clinic.rows[0]?.name || 'la clínica';
      const dt = new Date(scheduled_ts);
      const dateStr = dt.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
      const timeStr = dt.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
      const msg = cfg.appt_confirm_msg ||
        `Hola 👋 Tu cita en ${clinicName}${service ? ` para ${service}` : ''} está confirmada para el ${dateStr} a las ${timeStr}. ¡Te esperamos!`;
      sendWhatsAppMessage(patient_phone, msg).catch(() => {});
    }
    res.json(appt);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/calendar/:id', requireAuth, async (req, res) => {
  const { patient_name, patient_phone, service, scheduled_ts, duration_min, notes, status, notify_whatsapp, professional, price, room } = req.body;
  try {
    const appt = await updateAppointmentFull(req.params.id, req.session.clinic.id, { patient_name, patient_phone, service, scheduled_ts, duration_min, notes, status, professional, price, room });
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    const io = req.app.get('io');
    io?.to(`clinic_${req.session.clinic.id}`).emit('appt:updated', appt);
    auditLog(req.session.clinic.id, sessionActor(req), 'appt.updated', 'appointment', appt.id, { status, service }).catch(() => {});
    if (notify_whatsapp && appt.patient_phone) {
      const clinic = await pool.query('SELECT name,config FROM clinics WHERE id=$1', [req.session.clinic.id]);
      const clinicName = clinic.rows[0]?.name || 'la clínica';
      let msg;
      if (status === 'cancelled') {
        msg = `Hola, tu cita en ${clinicName} ha sido cancelada. Escríbenos para reservar otra.`;
      } else if (appt.scheduled_ts) {
        const dt = new Date(appt.scheduled_ts);
        const dateStr = dt.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
        const timeStr = dt.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
        msg = `Hola 👋 Tu cita en ${clinicName} ha sido actualizada: ${dateStr} a las ${timeStr}. ¿Alguna duda? Escríbenos.`;
      }
      if (msg) sendWhatsAppMessage(appt.patient_phone, msg).catch(() => {});
    }
    res.json(appt);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/calendar/:id', requireAuth, async (req, res) => {
  const { notify_whatsapp } = req.body || {};
  try {
    const [apptRows] = await Promise.all([
      pool.query('SELECT * FROM appointments WHERE id=$1 AND clinic_id=$2', [req.params.id, req.session.clinic.id])
    ]);
    const appt = apptRows.rows[0];
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    await deleteAppointment(req.params.id, req.session.clinic.id);
    const io = req.app.get('io');
    io?.to(`clinic_${req.session.clinic.id}`).emit('appt:deleted', { id: parseInt(req.params.id) });
    auditLog(req.session.clinic.id, sessionActor(req), 'appt.deleted', 'appointment', req.params.id, { patient_name: appt.patient_name }).catch(() => {});
    if (notify_whatsapp && appt.patient_phone) {
      const clinic = await pool.query('SELECT name FROM clinics WHERE id=$1', [req.session.clinic.id]);
      const clinicName = clinic.rows[0]?.name || 'la clínica';
      sendWhatsAppMessage(appt.patient_phone, `Hola, tu cita en ${clinicName} ha sido cancelada. Escríbenos para reservar otra fecha.`).catch(() => {});
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
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
  .then(async () => {
    const persisted = await getManualSessions();
    persisted.forEach(s => manualSessions.add(s));
    if (persisted.length) console.log(`[Boot] ${persisted.length} sesiones manuales restauradas`);

    // Cron: cierra conversaciones inactivas cada 5 min
    const INACTIVE_MINUTES = parseInt(process.env.CONV_TIMEOUT_MINUTES || '60');
    setInterval(async () => {
      try {
        const closed = await closeInactiveConversations(INACTIVE_MINUTES);
        if (!closed.length) return;
        console.log(`[Cron] ${closed.length} conversaciones cerradas por inactividad`);
        // Notificar a cada clínica afectada via socket
        const byClinic = closed.reduce((m, r) => { (m[r.clinic_id] = m[r.clinic_id] || []).push(r.session_id); return m; }, {});
        Object.entries(byClinic).forEach(([cid, sessions]) => {
          sessions.forEach(sid => io.to(`clinic_${cid}`).emit('conv:closed', { session_id: sid, reason: 'inactivity' }));
        });
      } catch(e) { console.error('[Cron] close error:', e.message); }
    }, 5 * 60 * 1000);

    // Cron: envía NPS pendientes cada 5 min
    setInterval(async () => {
      try {
        const pending = await getPendingNps();
        for (const n of pending) {
          const name = n.clinic_name || 'la clínica';
          await sendWhatsAppMessage(n.from_number,
            `Hola 👋 ¿Cómo fue tu experiencia en ${name}? Del 1 al 10, ¿cómo nos valorarías? 😊`
          ).catch(() => {});
          await markNpsSent(n.id).catch(() => {});
        }
        if (pending.length) console.log(`[Cron] ${pending.length} NPS enviados`);
      } catch(e) { console.error('[Cron] NPS:', e.message); }
    }, 5 * 60 * 1000);

    // Cron: recordatorio 24h pre-cita (cada 30 min)
    setInterval(async () => {
      try {
        const upcoming = await getUpcomingAppointments();
        for (const a of upcoming) {
          const cfg = a.config || {};
          const clinicName = a.clinic_name || 'la clínica';
          const msg = cfg.reminder_msg ||
            `Hola 👋 Te recordamos que mañana tienes cita en ${clinicName}${a.service ? ` para ${a.service}` : ''}${a.scheduled_at ? ` a las ${a.scheduled_at.split(' ').pop()}` : ''}. ¿Todo bien? Escríbenos si necesitas cambiarla.`;
          await sendWhatsAppMessage(a.patient_phone, msg).catch(() => {});
          await markReminderSent(a.id).catch(() => {});
        }
        if (upcoming.length) console.log(`[Cron] ${upcoming.length} recordatorios enviados`);
      } catch(e) { console.error('[Cron] reminder:', e.message); }
    }, 30 * 60 * 1000);

    // Cron: post-visita follow-up (cada 30 min, opt-in por clínica)
    setInterval(async () => {
      try {
        const appts = await getAppointmentsForFollowup();
        for (const a of appts) {
          const cfg = a.config || {};
          const clinicName = a.clinic_name || 'la clínica';
          const msg = cfg.followup_msg ||
            `Hola ${a.patient_name?.split(' ')[0] || ''}👋 Esperamos que tu visita en ${clinicName} haya ido bien. ¿Tienes alguna duda o consulta? Estamos aquí para ayudarte 😊`;
          await sendWhatsAppMessage(a.patient_phone, msg).catch(() => {});
          await markFollowupSent(a.id).catch(() => {});
        }
        if (appts.length) console.log(`[Cron] ${appts.length} follow-ups post-visita enviados`);
      } catch(e) { console.error('[Cron] followup:', e.message); }
    }, 30 * 60 * 1000);

    // Cron: solicitud de reseña Google (cada 30 min, opt-in explícito + google_review_url)
    setInterval(async () => {
      try {
        const appts = await getAppointmentsForReview();
        for (const a of appts) {
          const cfg = a.config || {};
          const firstName = a.patient_name?.split(' ')[0] || '';
          const msg = `¡Hola ${firstName}! 😊 Gracias por confiar en nosotros. Si tienes un momento, nos ayudaría muchísimo que dejaras una reseña:\n${cfg.google_review_url}\n¡Gracias de corazón! ⭐`;
          await sendWhatsAppMessage(a.patient_phone, msg).catch(() => {});
          await markReviewSent(a.id).catch(() => {});
        }
        if (appts.length) console.log(`[Cron] ${appts.length} solicitudes de reseña enviadas`);
      } catch(e) { console.error('[Cron] review:', e.message); }
    }, 30 * 60 * 1000);

    // Cron: auto-reactivación pacientes en riesgo (cada 6h, opt-in por clínica)
    setInterval(async () => {
      try {
        const { rows: clinics } = await pool.query(
          `SELECT id, name, config FROM clinics WHERE config->>'auto_reactivacion' = 'true'`
        );
        for (const clinic of clinics) {
          const cfg = clinic.config || {};
          const patients = await getAtRiskForAutoReact(clinic.id);
          if (!patients.length) continue;
          const defaultMsg = `Hola 👋 Hace tiempo que no te vemos en ${clinic.name}. Esta semana tenemos disponibilidad — ¿te apuntamos a una revisión?`;
          const msg = cfg.reactivacion_msg || defaultMsg;
          const ids = [];
          for (const p of patients) {
            await sendWhatsAppMessage(p.telefono, msg.replace('{nombre}', p.nombre?.split(' ')[0] || '')).catch(() => {});
            ids.push(p.id);
            await new Promise(r => setTimeout(r, 1200));
          }
          if (ids.length) await markLeadsContactado(ids).catch(() => {});
          console.log(`[Cron] Auto-reactivación: ${ids.length} mensajes para clínica ${clinic.id}`);
        }
      } catch(e) { console.error('[Cron] auto-reactivación:', e.message); }
    }, 6 * 60 * 60 * 1000);

    httpServer.listen(PORT, () => console.log(`Cliniflux en http://localhost:${PORT}`));
  })
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });

// Evitar crash por errores async no capturados
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
  // No cerramos el proceso — Railway reiniciaría de todas formas, pero es mejor seguir sirviendo
});
