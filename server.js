require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const { initDb, getSession, saveSession, saveLead } = require('./db');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(express.static('public'));

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

// ── Rutas páginas ───────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile('landing.html', { root: 'public' }));
app.get('/demo', (req, res) => res.sendFile('demo.html', { root: 'public' }));
app.get('/about', (req, res) => res.sendFile('about.html', { root: 'public' }));
app.get('/contacto', (req, res) => res.sendFile('contacto.html', { root: 'public' }));
app.get('/legal/privacidad', (req, res) => res.sendFile('legal/privacidad.html', { root: 'public' }));
app.get('/legal/terminos', (req, res) => res.sendFile('legal/terminos.html', { root: 'public' }));
app.get('/legal/cookies', (req, res) => res.sendFile('legal/cookies.html', { root: 'public' }));

// Feature pages
const FEATURES = ['respuesta-automatica','agenda-inteligente','reactivacion-pacientes','panel-control','implementacion','rgpd'];
FEATURES.forEach(slug => {
  app.get(`/features/${slug}`, (req, res) => res.sendFile(`features/${slug}.html`, { root: 'public' }));
});

// ── POST /chat ──────────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { session_id, msg } = req.body;

  if (!session_id || !msg || msg.length > 500) {
    return res.status(400).json({ error: 'Parámetros inválidos' });
  }

  // Sanitizar session_id
  const safeId = session_id.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);

  try {
    const history = await getSession(safeId);

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: msg }
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages,
      max_tokens: 350,
      temperature: 0.4
    });

    let reply = completion.choices[0].message.content;

    // Detectar cita confirmada y limpiar el marcador
    const match = reply.match(/CITA_CONFIRMADA\|(.+)/);
    if (match) {
      reply = reply.replace(/\nCITA_CONFIRMADA\|.+/, '').trim();
      // Aquí puedes añadir Google Calendar / email en el futuro
      console.log('Cita confirmada:', match[1]);
    }

    // Guardar historial (máx 20 mensajes)
    history.push({ role: 'user', content: msg });
    history.push({ role: 'assistant', content: reply });
    const trimmed = history.slice(-20);
    await saveSession(safeId, trimmed);

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
      const t = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await t.sendMail({
        from: '"Cliniflux Web" <' + process.env.SMTP_USER + '>',
        to: 'contacto@cliniflux.com',
        replyTo: email,
        subject: '[Contacto Web] ' + tipo + ' - ' + nombre + ' (' + (clinica||'-') + ')',
        html: '<h2>Nuevo mensaje desde cliniflux.com</h2><p><b>Nombre:</b> ' + nombre + '</p><p><b>Clinica:</b> ' + (clinica||'-') + '</p><p><b>Email:</b> ' + email + '</p><p><b>Telefono:</b> ' + (telefono||'-') + '</p><p><b>Tipo:</b> ' + tipo + '</p><p><b>Mensaje:</b> ' + (mensaje||'-') + '</p>'
      });
    } catch(e) { console.error('Email error:', e.message); }
  }
  res.json({ ok: true });
});

// ── POST /api/demo-request ──────────────────────────────────────────────────

app.post('/api/demo-request', async (req, res) => {
  try {
    await saveLead(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error('Lead error:', err.message);
    res.status(500).json({ error: 'Error guardando solicitud' });
  }
});

// ── Arrancar ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => app.listen(PORT, () => console.log(`Cliniflux en http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
