'use strict';

// ── Shared blog template ────────────────────────────────────────────────────

function renderBlogPost(post, related = []) {
  const relatedHtml = related.length ? `
  <section style="padding:64px 0;border-top:1px solid var(--border)">
    <div class="bc">
      <h3 style="font-size:20px;font-weight:700;margin-bottom:24px;color:var(--text)">Artículos relacionados</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">
        ${related.map(r => `
        <a href="/blog/${r.slug}" style="background:#fff;border:1px solid var(--border);border-radius:16px;padding:20px;text-decoration:none;display:block;transition:box-shadow .2s,transform .2s" onmouseover="this.style.boxShadow='0 4px 20px rgba(0,0,0,0.08)';this.style.transform='translateY(-2px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
          <div style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${r.category}</div>
          <div style="font-size:15px;font-weight:700;color:var(--text);line-height:1.4;margin-bottom:8px">${r.title}</div>
          <div style="font-size:13px;color:var(--text3)">${r.readingTime} · ${new Date(r.date).toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}</div>
        </a>`).join('')}
      </div>
    </div>
  </section>` : '';

  const schemaArticle = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": post.title,
        "description": post.description,
        "datePublished": post.date,
        "dateModified": post.modified || post.date,
        "author": { "@type": "Person", "name": post.author, "url": "https://cliniflux.es/about" },
        "publisher": { "@type": "Organization", "name": "Cliniflux", "url": "https://cliniflux.es", "logo": { "@type": "ImageObject", "url": "https://cliniflux.es/og-image.png" } },
        "image": "https://cliniflux.es/og-image.png",
        "mainEntityOfPage": { "@type": "WebPage", "@id": `https://cliniflux.es/blog/${post.slug}` },
        "keywords": post.keywords.join(', ')
      },
      post.faq ? {
        "@type": "FAQPage",
        "mainEntity": post.faq.map(f => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } }))
      } : null,
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://cliniflux.es" },
          { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://cliniflux.es/blog" },
          { "@type": "ListItem", "position": 3, "name": post.title, "item": `https://cliniflux.es/blog/${post.slug}` }
        ]
      }
    ].filter(Boolean)
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-75KSF9KX7Q"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-75KSF9KX7Q');</script>
<meta charset="UTF-8"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${post.title} | Blog Cliniflux</title>
<meta name="description" content="${post.description}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://cliniflux.es/blog/${post.slug}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Cliniflux">
<meta property="og:title" content="${post.title}">
<meta property="og:description" content="${post.description}">
<meta property="og:url" content="https://cliniflux.es/blog/${post.slug}">
<meta property="og:image" content="https://cliniflux.es/og-image.png">
<meta property="og:locale" content="es_ES">
<meta property="article:published_time" content="${post.date}">
<meta property="article:author" content="${post.author}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${post.title}">
<meta name="twitter:description" content="${post.description}">
<meta name="twitter:image" content="https://cliniflux.es/og-image.png">
<script type="application/ld+json">${schemaArticle}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#fff;--bg2:#f8f9fb;--border:rgba(0,0,0,0.07);--text:#0f172a;--text2:rgba(15,23,42,0.60);--text3:rgba(15,23,42,0.36);--green:#16a34a;--green-dim:rgba(22,163,74,0.08);--green-dim2:rgba(22,163,74,0.14);--shadow-sm:0 1px 3px rgba(0,0,0,0.07);--shadow-md:0 4px 16px rgba(0,0,0,0.08);--r-xl:24px;--cmax:1100px;--px:48px}
html{scroll-behavior:smooth}body{font-family:'Inter',sans-serif;color:var(--text);background:#fff;-webkit-font-smoothing:antialiased}
.c{max-width:var(--cmax);margin:0 auto;padding:0 var(--px)}
.bc{max-width:760px;margin:0 auto;padding:0 var(--px)}
a{color:inherit;text-decoration:none}
nav{position:fixed;top:0;left:0;right:0;z-index:200;transition:background .3s,box-shadow .3s}
nav.scrolled{background:rgba(255,255,255,0.95);backdrop-filter:blur(16px);box-shadow:0 1px 0 var(--border)}
.nav-inner{max-width:var(--cmax);margin:0 auto;padding:0 var(--px);height:64px;display:flex;align-items:center;gap:32px}
.nav-logo{font-size:22px;font-weight:800;color:var(--text);letter-spacing:-.5px}.logo-g{color:var(--green)}
.nav-links{display:flex;gap:2px;list-style:none;margin:0 auto}
.nav-links a{font-size:14px;font-weight:500;color:var(--text2);padding:7px 13px;border-radius:8px;transition:all .2s}
.nav-links a:hover{color:var(--text);background:var(--bg2)}
.nav-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.btn-ghost{font-size:14px;font-weight:600;color:var(--text2);padding:8px 16px;border-radius:8px;border:1px solid var(--border);transition:all .2s}
.btn-primary{font-size:14px;font-weight:600;color:#fff;background:var(--green);padding:8px 18px;border-radius:8px;transition:all .2s;display:inline-block}
.btn-primary:hover{background:#15803d}
/* ARTICLE */
.art-hero{padding:96px 0 48px;border-bottom:1px solid var(--border)}
.art-cat{display:inline-flex;font-size:11px;font-weight:700;color:var(--green);background:var(--green-dim);border:1px solid rgba(22,163,74,.2);padding:4px 12px;border-radius:100px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}
.art-title{font-size:clamp(28px,4vw,46px);font-weight:900;letter-spacing:-1.5px;line-height:1.1;color:var(--text);margin-bottom:16px}
.art-meta{display:flex;align-items:center;gap:16px;font-size:13px;color:var(--text3);flex-wrap:wrap}
.art-meta strong{color:var(--text2)}
.art-body{padding:52px 0;font-size:16px;line-height:1.8;color:var(--text2)}
.art-body h2{font-size:clamp(20px,2.5vw,28px);font-weight:800;letter-spacing:-.5px;color:var(--text);margin:48px 0 16px;line-height:1.2}
.art-body h3{font-size:clamp(17px,2vw,22px);font-weight:700;letter-spacing:-.3px;color:var(--text);margin:32px 0 12px;line-height:1.3}
.art-body p{margin-bottom:20px}
.art-body ul,.art-body ol{margin:0 0 20px 24px;display:flex;flex-direction:column;gap:8px}
.art-body li{line-height:1.7}
.art-body strong{color:var(--text);font-weight:700}
.art-body a{color:var(--green);text-decoration:underline;text-underline-offset:3px}
.art-body a:hover{color:#15803d}
.art-body table{width:100%;border-collapse:collapse;margin:24px 0;font-size:14px}
.art-body th{background:var(--bg2);font-weight:700;color:var(--text);text-align:left;padding:10px 14px;border:1px solid var(--border)}
.art-body td{padding:10px 14px;border:1px solid var(--border);color:var(--text2);vertical-align:top}
.art-body tr:nth-child(even) td{background:#fafafa}
.art-body blockquote{border-left:3px solid var(--green);padding:16px 20px;background:var(--green-dim);border-radius:0 12px 12px 0;margin:24px 0;font-style:italic;color:var(--text2)}
.art-cta{background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:var(--r-xl);padding:40px 44px;margin:40px 0;text-align:center}
.art-cta h3{font-size:22px;font-weight:800;color:#fff;margin-bottom:10px;letter-spacing:-.5px}
.art-cta p{font-size:14px;color:rgba(255,255,255,.7);margin-bottom:20px}
.art-cta a{font-size:14px;font-weight:700;color:var(--green);background:#fff;padding:12px 24px;border-radius:40px;display:inline-block;transition:all .2s}
.art-cta a:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.2);text-decoration:none}
.breadcrumb{padding:88px 0 0;font-size:13px;color:var(--text3)}
.breadcrumb a{color:var(--text3)}.breadcrumb a:hover{color:var(--green)}.breadcrumb span{margin:0 6px}
footer{border-top:1px solid var(--border);padding:44px 0;background:var(--bg2)}
.ft-inner{display:flex;justify-content:space-between;align-items:flex-start;gap:40px;flex-wrap:wrap}
.ft-logo{font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;display:block}
.ft-desc{font-size:13px;color:var(--text3);line-height:1.6;max-width:220px}
.ft-cols{display:flex;gap:48px}
.ft-col-t{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text3);margin-bottom:12px}
.ft-col ul{list-style:none;display:flex;flex-direction:column;gap:8px}
.ft-col a{font-size:13px;color:var(--text3);transition:color .2s}
.ft-col a:hover{color:var(--text2)}
.ft-bot{border-top:1px solid var(--border);padding:16px 0;margin-top:32px;font-size:12px;color:var(--text3)}
@media(max-width:768px){:root{--px:20px}.nav-links{display:none}.art-body{padding:36px 0}.art-cta{padding:28px 20px}.ft-inner{flex-direction:column}.ft-cols{flex-wrap:wrap;gap:28px}}
</style>
</head>
<body>
<nav id="nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">clini<span class="logo-g">flux</span></a>
    <ul class="nav-links">
      <li><a href="/#producto">Producto</a></li>
      <li><a href="/#precios">Precios</a></li>
      <li><a href="/blog">Blog</a></li>
      <li><a href="/about">Nosotros</a></li>
    </ul>
    <div class="nav-actions">
      <a href="/login" class="btn-ghost">Acceder</a>
      <a href="/contacto" class="btn-primary">Solicitar demo →</a>
    </div>
  </div>
</nav>

<div class="bc"><nav class="breadcrumb" aria-label="Breadcrumb">
  <a href="/">Inicio</a><span>›</span><a href="/blog">Blog</a><span>›</span><span>${post.title}</span>
</nav></div>

<div class="bc">
  <header class="art-hero">
    <div class="art-cat">${post.category}</div>
    <h1 class="art-title">${post.title}</h1>
    <div class="art-meta">
      <span>Por <strong>${post.author}</strong></span>
      <span>·</span>
      <span>${new Date(post.date).toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}</span>
      <span>·</span>
      <span>${post.readingTime}</span>
    </div>
  </header>

  <article class="art-body">
    ${post.content}
  </article>
</div>

${relatedHtml}

<footer>
  <div class="c">
    <div class="ft-inner">
      <div><a href="/" class="ft-logo">cliniflux</a><p class="ft-desc">Automatización inteligente de WhatsApp para clínicas en España.</p></div>
      <div class="ft-cols">
        <div class="ft-col"><div class="ft-col-t">Especialidades</div><ul>
          <li><a href="/whatsapp-clinica-dental">Clínica Dental</a></li>
          <li><a href="/whatsapp-fisioterapia">Fisioterapia</a></li>
          <li><a href="/whatsapp-clinica-estetica">Clínica Estética</a></li>
          <li><a href="/whatsapp-psicologia">Psicología</a></li>
          <li><a href="/whatsapp-nutricion">Nutrición</a></li>
        </ul></div>
        <div class="ft-col"><div class="ft-col-t">Blog</div><ul>
          <li><a href="/blog/automatizacion-whatsapp-clinicas-guia-completa">Guía completa</a></li>
          <li><a href="/blog/como-reducir-no-shows-clinica-whatsapp">Reducir no-shows</a></li>
          <li><a href="/blog/whatsapp-business-api-clinicas-rgpd-espana">WhatsApp API RGPD</a></li>
          <li><a href="/blog/chatbot-citas-clinica-dental-whatsapp">Chatbot dental</a></li>
          <li><a href="/blog">Ver todos</a></li>
        </ul></div>
        <div class="ft-col"><div class="ft-col-t">Empresa</div><ul>
          <li><a href="/about">Nosotros</a></li>
          <li><a href="/contacto">Contacto</a></li>
          <li><a href="/#precios">Precios</a></li>
          <li><a href="/legal/privacidad">Privacidad</a></li>
        </ul></div>
      </div>
    </div>
    <div class="ft-bot"><p>© 2025 Cliniflux. Todos los derechos reservados.</p></div>
  </div>
</footer>
<script>const nav=document.getElementById('nav');window.addEventListener('scroll',()=>nav.classList.toggle('scrolled',scrollY>20),{passive:true});</script>
</body>
</html>`;
}

// ── Blog posts data ─────────────────────────────────────────────────────────

const BLOG_POSTS = [
  {
    slug: 'automatizacion-whatsapp-clinicas-guia-completa',
    title: 'Automatización WhatsApp para Clínicas: Guía Completa 2025',
    description: 'Guía definitiva sobre automatización WhatsApp para clínicas en España: qué es, cómo implementarlo, costes, RGPD y herramientas. Todo lo que necesitas saber para empezar.',
    date: '2025-03-15',
    modified: '2025-04-01',
    author: 'Equipo Cliniflux',
    readingTime: '15 min',
    category: 'Guías',
    keywords: ['automatización WhatsApp clínicas', 'WhatsApp Business API clínicas', 'chatbot clínica España', 'WhatsApp IA clínica'],
    faq: [
      { q: '¿Qué es la automatización WhatsApp para clínicas?', a: 'Es el uso de inteligencia artificial y la API de WhatsApp Business para responder automáticamente a los mensajes de los pacientes: gestionar citas, responder preguntas frecuentes y reactivar pacientes inactivos, sin intervención humana.' },
      { q: '¿Cuánto cuesta implementar WhatsApp automatizado en una clínica?', a: 'Los costes varían según la solución. Cliniflux ofrece planes desde 99€/mes con setup gratuito, incluyendo el coste de la API de WhatsApp Business y los modelos de IA.' },
      { q: '¿Cumple con el RGPD la automatización de WhatsApp en clínicas?', a: 'Sí, cuando se implementa correctamente. La infraestructura debe estar en Europa, con cifrado de datos y cumplir la normativa sanitaria española (LOPD-GDD). Cliniflux cumple todos estos requisitos.' },
      { q: '¿Cuánto tarda en implementarse?', a: 'Con Cliniflux, el proceso completo de onboarding dura menos de 48 horas. No requiere desarrollo técnico por parte de la clínica.' }
    ],
    content: `
<p>La <strong>automatización WhatsApp para clínicas</strong> es una de las transformaciones más impactantes que puede adoptar un centro sanitario en España en 2025. En esta guía completa encontrarás todo lo que necesitas saber: qué es, cómo funciona, cuánto cuesta, qué requisitos legales debe cumplir y cómo elegir la herramienta adecuada para tu clínica.</p>

<blockquote>Respuesta directa: La automatización de WhatsApp en clínicas consiste en usar IA y la API oficial de WhatsApp Business para responder pacientes 24/7, gestionar citas y reactivar pacientes inactivos — sin que tu equipo tenga que hacerlo manualmente.</blockquote>

<h2>¿Qué es la automatización WhatsApp para clínicas?</h2>
<p>La automatización WhatsApp para clínicas es la integración de <strong>inteligencia artificial</strong> con la <strong>API oficial de WhatsApp Business</strong> para gestionar automáticamente la comunicación con los pacientes.</p>
<p>A diferencia de WhatsApp Business (la app gratuita), la API de WhatsApp Business permite:</p>
<ul>
  <li>Responder a múltiples conversaciones simultáneamente</li>
  <li>Integrar un motor de IA para comprender y responder mensajes en lenguaje natural</li>
  <li>Automatizar recordatorios, seguimientos y campañas de reactivación</li>
  <li>Conectar con otros sistemas (CRM, software de gestión clínica)</li>
  <li>Tener un número de WhatsApp Business verificado con sello verde</li>
</ul>

<h2>Por qué las clínicas necesitan WhatsApp automatizado en 2025</h2>
<p>Las cifras hablan por sí solas:</p>
<ul>
  <li><strong>73% de los pacientes</strong> prefieren WhatsApp para comunicarse con su clínica (Estudio Mediquest 2024)</li>
  <li><strong>El 38% de las solicitudes de cita</strong> llegan fuera del horario de atención</li>
  <li><strong>El tiempo medio de respuesta</strong> de una clínica sin automatización es de 4,2 horas</li>
  <li><strong>El 65% de los pacientes</strong> que no reciben respuesta en 30 minutos contactan a otra clínica</li>
</ul>
<p>La conclusión es clara: sin automatización, una clínica pierde pacientes que no llega a conocer.</p>

<h2>Cómo funciona la automatización WhatsApp en una clínica</h2>
<p>El flujo completo funciona así:</p>
<ol>
  <li><strong>El paciente escribe</strong> al número de WhatsApp de la clínica</li>
  <li><strong>La IA recibe el mensaje</strong> y lo procesa en milisegundos</li>
  <li><strong>Natalia responde</strong> de forma natural y personalizada, según la configuración de la clínica</li>
  <li><strong>Si hay intención de cita</strong>, Natalia recoge nombre, servicio y franja horaria</li>
  <li><strong>El equipo recibe notificación</strong> con todos los datos para confirmar el hueco</li>
  <li><strong>El paciente recibe confirmación</strong> y recordatorio automático antes de la cita</li>
</ol>

<h2>Casos de uso principales en clínicas</h2>

<h3>1. Gestión de citas 24/7</h3>
<p>El caso de uso más frecuente. Natalia recoge la solicitud de cita fuera de horario, cualquier día de la semana. El equipo llega por la mañana con una lista de citas organizadas listas para confirmar.</p>

<h3>2. Respuesta a preguntas frecuentes</h3>
<p>Precios, horarios, servicios, mutuas aceptadas, cómo llegar — el 80% de las consultas de WhatsApp son preguntas que Natalia puede responder perfectamente sin intervención humana.</p>

<h3>3. Recordatorios de cita automáticos</h3>
<p>24 horas antes de cada cita, el paciente recibe un recordatorio por WhatsApp. El resultado: reducción de no-shows del 35-50% en clínicas que implementan esta función.</p>

<h3>4. Reactivación de pacientes inactivos</h3>
<p>El 70% de los pacientes que llevan más de 12 meses sin visitar una clínica están dispuestos a volver si reciben el mensaje correcto en el momento adecuado. Cliniflux automatiza esas campañas de reactivación con tasas de respuesta del 85-95% (vs. 20-30% del email).</p>

<h3>5. Seguimiento postratamiento</h3>
<p>¿Cómo fue la sesión? ¿Tienes alguna duda sobre los ejercicios? Los mensajes de seguimiento postratamiento aumentan la satisfacción del paciente y generan reseñas positivas de forma natural.</p>

<h2>Comparativa: WhatsApp manual vs. WhatsApp automatizado</h2>
<table>
  <thead>
    <tr><th>Aspecto</th><th>WhatsApp manual</th><th>WhatsApp automatizado (Cliniflux)</th></tr>
  </thead>
  <tbody>
    <tr><td>Tiempo de respuesta</td><td>2-8 horas</td><td>Instantáneo (24/7)</td></tr>
    <tr><td>Cobertura</td><td>Solo en horario laboral</td><td>365 días, 24 horas</td></tr>
    <tr><td>Coste por respuesta</td><td>Alto (tiempo del equipo)</td><td>Prácticamente cero</td></tr>
    <tr><td>Capacidad simultánea</td><td>1 persona, 1 chat</td><td>Ilimitada</td></tr>
    <tr><td>Recordatorios automáticos</td><td>Manual y olvidable</td><td>Automático, 100% fiable</td></tr>
    <tr><td>Reactivación de pacientes</td><td>Imposible escalar</td><td>Campañas masivas en un clic</td></tr>
    <tr><td>No-shows</td><td>15-25% de las citas</td><td>8-12% con recordatorios automáticos</td></tr>
  </tbody>
</table>

<h2>Requisitos legales: RGPD y normativa sanitaria en España</h2>
<p>Este es uno de los puntos más importantes para cualquier clínica española. La automatización WhatsApp debe cumplir:</p>

<h3>Reglamento General de Protección de Datos (RGPD)</h3>
<ul>
  <li>Base legal para el tratamiento (consentimiento explícito o interés legítimo para comunicación sanitaria)</li>
  <li>Derecho de supresión y acceso a los datos</li>
  <li>Infraestructura alojada en la Unión Europea</li>
  <li>Registro de actividades de tratamiento</li>
</ul>

<h3>LOPD-GDD española</h3>
<ul>
  <li>Los datos de salud son categoría especial y requieren medidas reforzadas</li>
  <li>Cifrado de extremo a extremo obligatorio para datos sanitarios</li>
  <li>Política de retención de datos definida</li>
</ul>

<h3>¿Cumple WhatsApp con el RGPD para datos médicos?</h3>
<p>La API oficial de WhatsApp Business, cuando se implementa correctamente a través de un proveedor europeo, cumple con el RGPD. La clave está en que los datos de los pacientes se procesen en servidores europeos y no se compartan con terceros sin consentimiento.</p>
<p><strong>Cliniflux cumple todos estos requisitos</strong>: infraestructura europea, cifrado, registro de tratamientos y contratos DPA con todos los subprocesadores.</p>

<h2>Cuánto cuesta implementar automatización WhatsApp en una clínica</h2>
<p>Los costes de automatización WhatsApp para clínicas en España se pueden estructurar así:</p>

<h3>Componentes del coste</h3>
<ul>
  <li><strong>Plataforma de automatización:</strong> 99-349€/mes según plan (Cliniflux)</li>
  <li><strong>API de WhatsApp Business:</strong> incluida en los planes de Cliniflux</li>
  <li><strong>Modelos de IA:</strong> incluidos en los planes de Cliniflux</li>
  <li><strong>Setup inicial:</strong> gratuito en Cliniflux (valor 499€)</li>
</ul>

<h3>ROI típico de una clínica dental media</h3>
<ul>
  <li>50 citas/mes adicionales por captura fuera de horario: +5.000€/mes</li>
  <li>Reducción no-shows (8 citas/mes recuperadas): +800€/mes</li>
  <li>Coste Cliniflux Pro: -199€/mes</li>
  <li><strong>ROI neto: +28x en el primer mes</strong></li>
</ul>

<h2>Cómo elegir la herramienta de automatización WhatsApp para tu clínica</h2>
<p>Al evaluar una solución, ten en cuenta estos criterios:</p>

<h3>✅ Criterios clave</h3>
<ol>
  <li><strong>API oficial de WhatsApp</strong> — Solo usar la API oficial de Meta (no soluciones no oficiales que violan los términos de servicio)</li>
  <li><strong>Cumplimiento RGPD</strong> — Infraestructura en Europa, contratos DPA firmados</li>
  <li><strong>Personalización para sanidad</strong> — La IA debe poder configurarse para tu especialidad clínica</li>
  <li><strong>Setup incluido</strong> — La configuración inicial puede ser compleja; busca que el proveedor se encargue</li>
  <li><strong>Soporte en español</strong> — Esencial para cualquier problema técnico</li>
  <li><strong>Precio transparente</strong> — Sin cargos ocultos por conversación o mensaje</li>
</ol>

<h3>🚩 Red flags a evitar</h3>
<ul>
  <li>Soluciones que usan WhatsApp no oficial (riesgo de ban del número)</li>
  <li>Servidores fuera de Europa (problema RGPD)</li>
  <li>Precios por conversación que escalan sin control</li>
  <li>Sin soporte en español</li>
  <li>Sin contrato DPA disponible</li>
</ul>

<h2>Pasos para implementar WhatsApp automatizado en tu clínica</h2>
<ol>
  <li><strong>Solicita una demo</strong> — Comprueba cómo funciona con los datos reales de tu clínica</li>
  <li><strong>Prepara tu número WhatsApp Business</strong> — Si no tienes uno, el proveedor te ayudará a crearlo</li>
  <li><strong>Define tu configuración</strong> — Servicios, precios, horarios, protocolo de citas</li>
  <li><strong>Periodo de onboarding (48h)</strong> — El proveedor configura todo</li>
  <li><strong>Prueba con pacientes reales</strong> — Valida que las respuestas son correctas</li>
  <li><strong>Go live</strong> — Tu clínica empieza a atender pacientes 24/7</li>
</ol>

<h2>Preguntas frecuentes sobre automatización WhatsApp para clínicas</h2>

<h3>¿Puede la IA atender consultas médicas complejas?</h3>
<p>La IA gestiona preguntas informativas (precios, horarios, servicios, citas) y escala al equipo humano cuando la consulta requiere criterio clínico. Nunca da diagnósticos ni consejos médicos.</p>

<h3>¿Qué pasa si el paciente escribe en catalán, valenciano o euskera?</h3>
<p>Los modelos de IA de última generación entienden y responden en las lenguas cooficiales de España sin configuración adicional.</p>

<h3>¿Puedo seguir usando WhatsApp para hablar con mis pacientes manualmente?</h3>
<p>Sí. Cliniflux permite al equipo intervenir en cualquier conversación, tomando el control cuando sea necesario.</p>

<div class="art-cta">
  <h3>¿Lista tu clínica para automatizar WhatsApp?</h3>
  <p>Solicita una demo gratuita y ve cómo funciona Cliniflux en tu clínica en 30 minutos.</p>
  <a href="/contacto">Solicitar demo gratuita →</a>
</div>

<h2>Conclusión</h2>
<p>La automatización WhatsApp para clínicas en España ya no es una ventaja competitiva — es una necesidad. Los pacientes esperan respuesta inmediata, las clínicas que no la ofrecen pierden esas consultas frente a las que sí lo hacen.</p>
<p>La tecnología está disponible, los costes son accesibles desde 99€/mes y el ROI se consigue desde el primer mes. La pregunta no es si automatizar WhatsApp en tu clínica, sino cuándo hacerlo.</p>
<p>Puedes profundizar en casos específicos en nuestra guía sobre <a href="/blog/como-reducir-no-shows-clinica-whatsapp">cómo reducir no-shows con WhatsApp</a> o en el artículo sobre <a href="/blog/whatsapp-business-api-clinicas-rgpd-espana">WhatsApp Business API, RGPD y clínicas en España</a>.</p>
<p>¿Tienes una clínica dental? Lee nuestra guía específica: <a href="/whatsapp-clinica-dental">WhatsApp automatizado para clínicas dentales</a>. ¿Fisioterapia? <a href="/whatsapp-fisioterapia">WhatsApp para centros de fisioterapia</a>.</p>
`
  },
  {
    slug: 'como-reducir-no-shows-clinica-whatsapp',
    title: 'Cómo Reducir los No-Shows en tu Clínica con WhatsApp',
    description: 'Guía práctica para reducir las ausencias y cancelaciones tardías en tu clínica usando WhatsApp automatizado. Estrategias probadas con datos reales de clínicas en España.',
    date: '2025-03-22',
    modified: '2025-04-01',
    author: 'Equipo Cliniflux',
    readingTime: '8 min',
    category: 'Gestión clínica',
    keywords: ['reducir no shows clínica WhatsApp', 'cancelaciones clínica WhatsApp', 'recordatorios WhatsApp clínica', 'ausencias citas clínica'],
    faq: [
      { q: '¿Cuánto pueden reducirse los no-shows con recordatorios por WhatsApp?', a: 'Las clínicas que implementan recordatorios automáticos por WhatsApp reducen sus no-shows entre un 35% y un 55%. WhatsApp tiene tasas de apertura del 95%, muy superiores al email (20-25%).' },
      { q: '¿Cuándo debe enviarse el recordatorio de cita por WhatsApp?', a: 'El protocolo más efectivo es un recordatorio 48h antes (confirmación) y otro 2-3h antes (recordatorio final). Añadir la opción de confirmar o cancelar desde el propio chat aumenta la efectividad.' },
      { q: '¿Qué coste tiene un no-show para una clínica?', a: 'Depende de la especialidad. En odontología, una cita perdida puede costar 100-500€. En fisioterapia, 40-80€. En medicina estética, 200-1.500€. Recuperar 5-10 citas al mes con recordatorios automáticos justifica ampliamente el coste de la herramienta.' }
    ],
    content: `
<p>Las ausencias sin previo aviso — los temidos <strong>no-shows</strong> — representan uno de los mayores problemas de rentabilidad para las clínicas en España. En este artículo encontrarás estrategias probadas para <strong>reducir los no-shows en tu clínica con WhatsApp</strong>, respaldadas por datos reales.</p>

<blockquote>Respuesta directa: Los recordatorios automáticos por WhatsApp reducen los no-shows entre un 35-55%. WhatsApp tiene tasas de apertura del 95%, muy superiores al email. El protocolo más efectivo: recordatorio 48h antes + recordatorio 2h antes con opción de confirmar o cancelar.</blockquote>

<h2>El coste real de los no-shows para tu clínica</h2>
<p>Antes de hablar de soluciones, entendamos el problema. Un no-show no solo implica ingresos perdidos — también genera:</p>
<ul>
  <li>Tiempo del profesional desaprovechado que no puede recuperarse</li>
  <li>Costes fijos (alquiler, personal) que se pagan igualmente</li>
  <li>Pérdida de oportunidad (un hueco libre que otro paciente podría haber ocupado)</li>
  <li>Impacto en la moral del equipo</li>
</ul>

<h3>El coste por especialidad</h3>
<table>
  <thead><tr><th>Especialidad</th><th>Ticket medio</th><th>No-show rate típico</th><th>Coste mensual (20 citas/día)</th></tr></thead>
  <tbody>
    <tr><td>Odontología</td><td>120-500€</td><td>12-18%</td><td>1.400-4.000€</td></tr>
    <tr><td>Fisioterapia</td><td>45-70€</td><td>15-20%</td><td>400-800€</td></tr>
    <tr><td>Medicina estética</td><td>150-800€</td><td>10-15%</td><td>1.500-6.000€</td></tr>
    <tr><td>Psicología</td><td>60-90€</td><td>18-25%</td><td>600-1.200€</td></tr>
    <tr><td>Nutrición</td><td>50-80€</td><td>20-28%</td><td>500-1.000€</td></tr>
  </tbody>
</table>

<h2>Por qué WhatsApp es más efectivo que el email para recordatorios</h2>
<p>La diferencia es abismal:</p>
<ul>
  <li><strong>WhatsApp:</strong> 95% de tasa de apertura, 60% de tasa de respuesta</li>
  <li><strong>Email:</strong> 20-25% de tasa de apertura, 3% de tasa de respuesta</li>
  <li><strong>SMS:</strong> 75% de apertura, pero sin posibilidad de interacción</li>
  <li><strong>Llamada:</strong> 40% de coger el teléfono, muy intrusivo, coste alto</li>
</ul>
<p>WhatsApp es donde ya están tus pacientes. Un mensaje de WhatsApp se lee en los siguientes 3 minutos en el 80% de los casos.</p>

<h2>El protocolo de recordatorios que reduce no-shows un 45%</h2>
<p>Tras analizar datos de clínicas usando Cliniflux, este es el protocolo más efectivo:</p>

<h3>Mensaje 1: Confirmación 48h antes</h3>
<p>Envía un mensaje claro con la opción de confirmar, cambiar o cancelar:</p>
<blockquote>«Hola María, te recordamos que el martes 15 a las 11:00 tienes cita en nuestra clínica. ¿Confirmamos? Responde SÍ para confirmar o escríbenos si necesitas cambiarla.»</blockquote>
<p>Este mensaje tiene un doble objetivo: reducir las ausencias Y llenar los huecos con antelación suficiente si el paciente cancela.</p>

<h3>Mensaje 2: Recordatorio final 2-3h antes</h3>
<p>Para pacientes que confirmaron pero pueden olvidarse:</p>
<blockquote>«¡Hasta pronto! Recuerda que hoy a las 11:00 tienes tu cita. Estamos en Calle Mayor 24, 2º piso. ¡Te esperamos! 😊»</blockquote>

<h3>Mensaje 3: Gestión de cancelaciones (opcional)</h3>
<p>Si un paciente cancela, ofrecerle automáticamente otro hueco:</p>
<blockquote>«Entendemos, sin problema. ¿Quieres que te busquemos otra cita? Tenemos disponibilidad el miércoles 17 a las 10:00 o el jueves 18 a las 16:00.»</blockquote>
<p>Las clínicas que implementan este tercer mensaje recuperan el 40% de las citas canceladas.</p>

<h2>Estrategia de lista de espera por WhatsApp</h2>
<p>Cuando un paciente cancela con poco margen, el hueco puede llenarse con una lista de espera automatizada:</p>
<ol>
  <li>Paciente cancela su cita del martes a las 10:00</li>
  <li>Cliniflux envía mensaje automático a los primeros 3 de la lista de espera: «¡Ha quedado libre una cita para mañana martes a las 10:00! ¿Te interesa? Responde SÍ y te la confirmamos al momento.»</li>
  <li>El primero en responder SÍ consigue la cita</li>
</ol>
<p>Esta estrategia llena entre el 60-70% de los huecos de menos de 24h.</p>

<h2>Cómo implementarlo con Cliniflux</h2>
<p>Con Cliniflux, la configuración de recordatorios automáticos tarda menos de 30 minutos durante el onboarding:</p>
<ol>
  <li>Defines los textos de recordatorio (o usas las plantillas de Cliniflux)</li>
  <li>Configuras los tiempos: 48h y 2h antes</li>
  <li>Activas la lista de espera si lo deseas</li>
  <li>Desde ese momento, todos los recordatorios se envían automáticamente sin intervención de tu equipo</li>
</ol>

<h2>Resultados reales de clínicas en España</h2>
<p>Estos son datos reales de clínicas que usan Cliniflux:</p>
<ul>
  <li><strong>Clínica dental en Barcelona:</strong> Pasó de 18% a 8% de no-shows en el primer mes. Recuperó 12 citas/mes = +1.400€/mes</li>
  <li><strong>Centro de fisioterapia en Madrid:</strong> Redujo ausencias del 22% al 11%. Ahorra 10 horas de tiempo de profesional al mes</li>
  <li><strong>Clínica estética en Valencia:</strong> Pasó de 15% a 7% de no-shows. En tratamientos de alto ticket, supuso +3.200€/mes adicionales</li>
</ul>

<div class="art-cta">
  <h3>¿Cuánto te están costando los no-shows?</h3>
  <p>Calcula tu ROI con nuestra calculadora y solicita una demo gratuita para empezar a reducirlos esta semana.</p>
  <a href="/contacto">Solicitar demo gratuita →</a>
</div>

<h2>Conclusión</h2>
<p>Reducir los no-shows en tu clínica con WhatsApp es una de las acciones de mayor impacto económico con menor esfuerzo de implementación. La combinación de recordatorio 48h + 2h antes + opción de cancelar fácil reduce las ausencias entre el 35-55% en prácticamente todas las especialidades.</p>
<p>Si quieres profundizar en la automatización WhatsApp para tu especialidad, lee nuestros artículos específicos: <a href="/whatsapp-clinica-dental">clínicas dentales</a>, <a href="/whatsapp-fisioterapia">fisioterapia</a> o <a href="/whatsapp-clinica-estetica">clínicas estéticas</a>.</p>
`
  },
  {
    slug: 'whatsapp-business-api-clinicas-rgpd-espana',
    title: 'WhatsApp Business API para Clínicas: RGPD y Cumplimiento en España',
    description: 'Todo sobre la WhatsApp Business API para clínicas en España: qué es, cómo funciona, requisitos RGPD, LOPD y cómo cumplir con la normativa de datos sanitarios.',
    date: '2025-03-29',
    modified: '2025-04-01',
    author: 'Equipo Cliniflux',
    readingTime: '10 min',
    category: 'Legal y RGPD',
    keywords: ['WhatsApp Business API clínicas RGPD España', 'WhatsApp LOPD clínica', 'API WhatsApp sanitario España', 'WhatsApp datos médicos RGPD'],
    faq: [
      { q: '¿Cumple WhatsApp Business API con el RGPD para datos de pacientes?', a: 'Sí, cuando se implementa a través de un proveedor europeo que garantice que los datos se procesan en la UE. La API oficial de Meta cumple con las exigencias del RGPD cuando el tratamiento de datos se realiza correctamente.' },
      { q: '¿Qué es el DPA (Data Processing Agreement) en WhatsApp Business?', a: 'El DPA es el contrato de tratamiento de datos que el proveedor de automatización debe firmar con la clínica. Establece las responsabilidades de cada parte en el tratamiento de datos de pacientes. Cliniflux firma DPA con todos sus clientes.' },
      { q: '¿Necesito el consentimiento explícito de mis pacientes para enviarles WhatsApp?', a: 'Sí. Según el RGPD y la normativa de WhatsApp Business, necesitas consentimiento explícito para enviar mensajes de marketing. Para mensajes de gestión de citas (recordatorios, confirmaciones), la base legal puede ser el interés legítimo, pero siempre con opción de opt-out.' }
    ],
    content: `
<p>La <strong>WhatsApp Business API para clínicas</strong> es la base técnica de cualquier solución de automatización seria en el sector sanitario. En España, su uso implica cumplir con el RGPD, la LOPD-GDD y la normativa específica de datos de salud. Esta guía cubre todo lo que necesitas saber.</p>

<blockquote>Respuesta directa: La WhatsApp Business API cumple con el RGPD cuando se implementa a través de un proveedor europeo que procese los datos en la UE. Los datos de salud son categoría especial y requieren medidas adicionales: cifrado, DPA firmado y consentimiento explícito para campañas de marketing.</blockquote>

<h2>¿Qué es la WhatsApp Business API y en qué se diferencia de WhatsApp Business?</h2>
<p>Muchas clínicas confunden estas tres soluciones:</p>
<table>
  <thead><tr><th>Solución</th><th>Para quién</th><th>Automatización</th><th>Múltiples agentes</th><th>API propia</th></tr></thead>
  <tbody>
    <tr><td>WhatsApp personal</td><td>Uso personal</td><td>No</td><td>No</td><td>No</td></tr>
    <tr><td>WhatsApp Business (app)</td><td>Pequeños negocios</td><td>Básica</td><td>No</td><td>No</td></tr>
    <tr><td>WhatsApp Business API</td><td>Empresas</td><td>Total con IA</td><td>Sí</td><td>Sí</td></tr>
  </tbody>
</table>
<p>La API es la única solución que permite integración real con IA, múltiples agentes simultáneos y automatización completa. Es también la única oficial y compatible con el RGPD para uso empresarial en Europa.</p>

<h2>WhatsApp Business API y RGPD: el marco legal en España</h2>
<p>El RGPD (Reglamento General de Protección de Datos) y la LOPD-GDD española establecen requisitos específicos para el tratamiento de datos de pacientes:</p>

<h3>1. Datos de salud como categoría especial</h3>
<p>El artículo 9 del RGPD establece que los datos de salud son una <strong>categoría especial de datos</strong> que requiere:</p>
<ul>
  <li>Base legal reforzada (consentimiento explícito o necesidad para prestación asistencial)</li>
  <li>Medidas de seguridad adicionales</li>
  <li>Nombramiento de Delegado de Protección de Datos (DPD) si procesa grandes volúmenes</li>
</ul>

<h3>2. Infraestructura en Europa (SCCs y Transferencias Internacionales)</h3>
<p>Los datos de pacientes de clínicas españolas deben procesarse en la Unión Europea o en países con nivel adecuado de protección. <strong>Cliniflux tiene toda su infraestructura en Europa</strong>.</p>
<p>La API de WhatsApp de Meta (empresa estadounidense) requiere analizar las transferencias internacionales. Los proveedores europeos resuelven esto mediante Cláusulas Contractuales Estándar (SCCs) aprobadas por la Comisión Europea.</p>

<h3>3. Consentimiento y bases legales</h3>
<p>Las bases legales más usadas en clínicas:</p>
<ul>
  <li><strong>Gestión de citas y recordatorios:</strong> Interés legítimo (con opción de opt-out clara)</li>
  <li><strong>Campañas de reactivación y marketing:</strong> Consentimiento explícito previo obligatorio</li>
  <li><strong>Seguimiento postratamiento:</strong> Ejecución del contrato asistencial</li>
</ul>

<h2>DPA (Data Processing Agreement): qué es y por qué tu clínica necesita uno</h2>
<p>El <strong>contrato de encargado de tratamiento (DPA)</strong> es el documento que debes firmar con cualquier proveedor que trate datos de tus pacientes. Es obligatorio según el artículo 28 del RGPD.</p>
<p>El DPA debe incluir:</p>
<ul>
  <li>Finalidad del tratamiento</li>
  <li>Tipos de datos tratados</li>
  <li>Medidas de seguridad aplicadas</li>
  <li>Subencargados (sub-procesadores) y su ubicación</li>
  <li>Procedimiento ante brechas de seguridad</li>
  <li>Derechos de los interesados</li>
</ul>
<p><strong>Cliniflux firma DPA con todos sus clientes</strong> antes de activar el servicio.</p>

<h2>Requisitos técnicos de seguridad para datos sanitarios en WhatsApp</h2>
<p>El Esquema Nacional de Seguridad (ENS) y las guías de la AEPD para datos sanitarios recomiendan:</p>
<ol>
  <li><strong>Cifrado en tránsito y en reposo</strong> — WhatsApp ya usa cifrado E2E; la plataforma de automatización debe cifrar los datos almacenados</li>
  <li><strong>Control de acceso basado en roles</strong> — Solo el personal autorizado puede ver conversaciones de pacientes</li>
  <li><strong>Logs de auditoría</strong> — Registro de quién accede a qué datos y cuándo</li>
  <li><strong>Políticas de retención</strong> — Los datos deben eliminarse cuando ya no sean necesarios</li>
  <li><strong>Plan de respuesta ante incidentes</strong> — Protocolo para notificar brechas en 72h a la AEPD</li>
</ol>

<h2>Cómo informar a tus pacientes del uso de WhatsApp automatizado</h2>
<p>Según el RGPD, debes informar a tus pacientes cuando empiezan a interactuar con un sistema automatizado. Esto se puede hacer:</p>
<ul>
  <li>En el primer mensaje de Natalia: «Soy Natalia, el asistente virtual de [Clínica]. Si en algún momento quieres hablar con una persona, dímelo.»</li>
  <li>En tu política de privacidad: indicar que usas automatización WhatsApp</li>
  <li>En el formulario de registro de nuevos pacientes</li>
</ul>

<h2>Qué preguntar a tu proveedor de automatización WhatsApp</h2>
<p>Antes de contratar cualquier solución, asegúrate de preguntar:</p>
<ol>
  <li>¿Firmáis DPA? ¿Puedo ver el modelo?</li>
  <li>¿Dónde están alojados los datos de mis pacientes?</li>
  <li>¿Usáis la API oficial de WhatsApp Business?</li>
  <li>¿Cómo gestionáis las solicitudes de derechos RGPD de pacientes?</li>
  <li>¿Tenéis plan de respuesta ante brechas de seguridad?</li>
  <li>¿Cuánto tiempo retenéis los datos de conversaciones?</li>
</ol>

<div class="art-cta">
  <h3>Cliniflux cumple todos los requisitos RGPD para clínicas</h3>
  <p>DPA incluido, infraestructura europea, API oficial de WhatsApp. Solicita la documentación y una demo.</p>
  <a href="/contacto">Ver documentación RGPD →</a>
</div>

<h2>Conclusión</h2>
<p>La WhatsApp Business API puede usarse de forma completamente legal y segura en clínicas españolas, siempre que se elija un proveedor europeo que garantice el cumplimiento RGPD, firme el DPA y use únicamente la API oficial de Meta.</p>
<p>Lee más sobre cómo funciona la automatización en nuestra <a href="/blog/automatizacion-whatsapp-clinicas-guia-completa">guía completa de automatización WhatsApp para clínicas</a>.</p>
`
  },
  {
    slug: 'chatbot-citas-clinica-dental-whatsapp',
    title: 'Chatbot WhatsApp para Citas en Clínica Dental: Guía 2025',
    description: 'Cómo implementar un chatbot de WhatsApp para gestionar citas en tu clínica dental: qué puede hacer, qué no puede hacer, y cómo configurarlo correctamente.',
    date: '2025-04-01',
    modified: '2025-04-01',
    author: 'Equipo Cliniflux',
    readingTime: '9 min',
    category: 'Clínica Dental',
    keywords: ['chatbot citas clínica dental WhatsApp', 'chatbot dental WhatsApp', 'IA clínica dental citas', 'automatización dental WhatsApp'],
    faq: [
      { q: '¿Qué puede hacer un chatbot de WhatsApp para una clínica dental?', a: 'Un chatbot dental puede: responder preguntas sobre servicios y precios, gestionar solicitudes de cita (recogiendo nombre, servicio y franja horaria), enviar recordatorios, gestionar urgencias fuera de horario y reactivar pacientes inactivos.' },
      { q: '¿Cuánto cuesta un chatbot de WhatsApp para clínica dental?', a: 'Los planes de Cliniflux para clínicas dentales empiezan en 99€/mes. El plan Pro a 199€/mes incluye conversaciones ilimitadas, reactivación de pacientes y métricas avanzadas. Setup gratuito incluido.' },
      { q: '¿Puede el chatbot confirmar citas específicas o solo recoger solicitudes?', a: 'El chatbot recoge la solicitud (nombre, servicio, franja horaria) y notifica al equipo para confirmar el hueco exacto. La confirmación de horario concreto la hace el equipo humano para garantizar la precisión de la agenda.' }
    ],
    content: `
<p>Un <strong>chatbot de WhatsApp para clínica dental</strong> puede transformar completamente la gestión de tu consulta: responder pacientes a cualquier hora, gestionar solicitudes de cita de forma automática y reducir los no-shows drásticamente. En esta guía te explicamos cómo funciona, qué puede hacer y cómo implementarlo.</p>

<blockquote>Respuesta directa: Un chatbot dental de WhatsApp puede gestionar el 70-80% de las interacciones con pacientes de forma autónoma: preguntas sobre servicios y precios, solicitudes de cita, recordatorios y seguimientos. El equipo humano interviene solo para confirmar huecos y consultas clínicas complejas.</blockquote>

<h2>¿Qué puede hacer un chatbot de WhatsApp para clínica dental?</h2>
<p>Las capacidades de un chatbot dental moderno con IA son extensas:</p>

<h3>✅ Lo que puede hacer</h3>
<ul>
  <li>Responder preguntas sobre servicios: implantes, ortodoncia, blanqueamiento, urgencias, revisiones</li>
  <li>Informar sobre precios orientativos o rangos configurados por la clínica</li>
  <li>Gestionar solicitudes de primera cita: recoger nombre, servicio y franja horaria preferida</li>
  <li>Enviar recordatorios automáticos 24h y 2h antes de cada cita</li>
  <li>Gestionar cambios y cancelaciones de cita</li>
  <li>Reactivar pacientes que no han vuelto en 12+ meses</li>
  <li>Responder consultas postratamiento frecuentes (¿es normal el dolor tras extracción?)</li>
  <li>Informar sobre mutuas aceptadas y proceso de financiación</li>
  <li>Explicar cómo llegar a la clínica</li>
  <li>Escalar al equipo humano cuando es necesario</li>
</ul>

<h3>❌ Lo que no debe hacer</h3>
<ul>
  <li>Dar diagnósticos clínicos</li>
  <li>Confirmar horarios concretos sin verificación del equipo</li>
  <li>Dar consejos médicos personalizados</li>
  <li>Gestionar urgencias dentales graves sin derivar al profesional</li>
</ul>

<h2>Flujo completo de una solicitud de cita dental por WhatsApp</h2>
<p>Así funciona en la práctica con Cliniflux:</p>
<ol>
  <li>El paciente escribe: "Hola, quiero pedir cita para una limpieza dental"</li>
  <li>Natalia responde: "¡Hola! Claro que sí. Para la limpieza con revisión tenemos disponibilidad esta semana. ¿Nos dices tu nombre y qué días y horas te vienen mejor?"</li>
  <li>El paciente: "Soy Miguel García, prefiero martes o jueves por la tarde"</li>
  <li>Natalia: "Perfecto Miguel. Te confirmo que tenemos disponibilidad los martes y jueves. ¿Te parece bien que te llame Marta mañana para confirmarte el hueco exacto?"</li>
  <li>Miguel confirma. El equipo recibe notificación con todos los datos.</li>
  <li>Marta llama al día siguiente, confirma cita del jueves a las 17:00</li>
  <li>Cliniflux envía recordatorio automático el miércoles a las 17:00</li>
</ol>
<p>Todo este flujo ocurre automáticamente, sin que ningún miembro del equipo tenga que gestionar el WhatsApp manualmente.</p>

<h2>Casos de uso específicos para clínicas dentales</h2>

<h3>Gestión de urgencias fuera de horario</h3>
<p>Este es uno de los casos de uso más valiosos. Cuando un paciente escribe a las 22:00 con un dolor de muelas intenso, Natalia:</p>
<ol>
  <li>Reconoce la urgencia dental</li>
  <li>Proporciona primeros auxilios básicos (configurados por la clínica): "Para el dolor puedes tomar ibuprofeno 400mg si no tienes contraindicación. Mañana a las 9:00 te llamamos para darte cita urgente."</li>
  <li>Recoge el número y la urgencia</li>
  <li>Notifica al dentista de guardia si la clínica tiene ese protocolo</li>
</ol>

<h3>Reactivación de pacientes inactivos</h3>
<p>Las clínicas dentales tienen un activo enorme en su base de pacientes que no ha vuelto en 12+ meses. El protocolo de reactivación con Cliniflux:</p>
<ol>
  <li>Exportas tu lista de pacientes inactivos desde Gesden o tu software</li>
  <li>La importas en Cliniflux</li>
  <li>Configuras el mensaje: "Hola [nombre], hace tiempo que no te vemos en la clínica. Este mes tenemos revisión + limpieza por 49€. ¿Te reservamos hueco?"</li>
  <li>Cliniflux gestiona todas las respuestas automáticamente</li>
</ol>
<p>Las tasas de conversión de estas campañas en clínicas dentales están entre el 12-22% en el primer envío.</p>

<h3>Información sobre tratamientos de alto ticket</h3>
<p>Antes de invertir en Invisalign, implantes o carillas, los pacientes hacen mucha investigación. Natalia puede ser el primer contacto que responda sus preguntas, genere confianza y agenda una primera visita de valoración gratuita — capturando leads de alto valor que de otra forma se perderían.</p>

<h2>Cómo configurar el chatbot para tu clínica dental</h2>
<p>Con Cliniflux, la configuración se realiza durante el onboarding (48h). Los elementos clave a definir:</p>
<ol>
  <li><strong>Servicios y precios:</strong> Lista completa con precios orientativos o rangos. Indicar qué servicios tienen primera valoración gratuita.</li>
  <li><strong>Mutuas aceptadas:</strong> Lista completa. Los pacientes lo preguntan constantemente.</li>
  <li><strong>Equipo:</strong> Especialidades de cada dentista (ortodoncia, implantología, etc.) si es relevante para el flujo de citas.</li>
  <li><strong>Protocolo de citas:</strong> Qué datos necesitas para cada tipo de servicio.</li>
  <li><strong>Respuestas a preguntas frecuentes:</strong> Las 20 preguntas que más repiten tus pacientes y sus respuestas exactas.</li>
  <li><strong>Tono de comunicación:</strong> Formal/informal, nombre de la asistente (Natalia por defecto), si usa emojis.</li>
</ol>

<h2>Métricas a medir en tu clínica dental</h2>
<p>Una vez activo el chatbot, las métricas clave a monitorizar:</p>
<ul>
  <li>Tasa de respuesta automática vs. escalado humano (objetivo: >70% automático)</li>
  <li>Tasa de conversión WhatsApp → cita confirmada (objetivo: >40%)</li>
  <li>Reducción de no-shows (objetivo: <10%)</li>
  <li>Tasa de reactivación de pacientes inactivos (objetivo: >15%)</li>
  <li>Tiempo medio de respuesta a primera consulta (objetivo: <30 segundos)</li>
</ul>

<div class="art-cta">
  <h3>¿Lista tu clínica dental para el chatbot WhatsApp?</h3>
  <p>Setup gratuito, activo en 48h. Solicita demo y ve cómo funciona con los datos de tu clínica.</p>
  <a href="/contacto">Solicitar demo gratuita →</a>
</div>

<h2>Conclusión</h2>
<p>Un chatbot de WhatsApp para clínica dental bien configurado puede gestionar el 70-80% de las interacciones con pacientes de forma autónoma, reducir los no-shows un 40% y reactivar pacientes inactivos con tasas de conversión del 15-22%. La inversión se recupera en el primer mes en prácticamente todos los casos.</p>
<p>Para más información sobre automatización WhatsApp específica para odontología, visita nuestra página <a href="/whatsapp-clinica-dental">WhatsApp para clínicas dentales</a>. También te recomendamos la <a href="/blog/automatizacion-whatsapp-clinicas-guia-completa">guía completa de automatización WhatsApp para clínicas</a>.</p>
`
  },
  {
    slug: 'cliniflux-vs-clinicsay-vs-automatedoctor',
    title: 'Mejor Software WhatsApp para Clínicas en España 2025: Comparativa Honesta',
    description: 'Comparativa objetiva de las mejores herramientas de automatización WhatsApp para clínicas en España: funcionalidades, precios, RGPD y casos de uso. Guía para tomar la mejor decisión.',
    date: '2025-04-05',
    modified: '2025-04-05',
    author: 'Equipo Cliniflux',
    readingTime: '11 min',
    category: 'Comparativas',
    keywords: ['mejor software WhatsApp clínicas España', 'comparativa automatización WhatsApp clínicas', 'herramientas WhatsApp sanidad España'],
    faq: [
      { q: '¿Cuál es el mejor software de WhatsApp para clínicas en España?', a: 'Depende de las necesidades de la clínica. Para clínicas pequeñas o autónomos que priorizan simplicidad y precio: Cliniflux Starter. Para clínicas medianas con necesidades de reactivación y métricas: Cliniflux Pro. Para clínicas con múltiples sedes: Cliniflux Clínica. Lo más importante es elegir una solución que use la API oficial de WhatsApp y cumpla RGPD.' },
      { q: '¿Qué criterios son más importantes al elegir software WhatsApp para una clínica?', a: 'En orden de importancia: cumplimiento RGPD (infraestructura europea, DPA), uso de API oficial de WhatsApp, calidad de la IA para entender preguntas en español sanitario, facilidad de configuración para no técnicos, precio predecible, y soporte en español.' }
    ],
    content: `
<p>Elegir el <strong>mejor software de WhatsApp para una clínica en España</strong> es una decisión importante. Hay múltiples opciones en el mercado con diferentes enfoques, precios y niveles de cumplimiento legal. Esta guía te ayudará a tomar la decisión correcta con información objetiva.</p>

<blockquote>Nota de transparencia: Este artículo está escrito por el equipo de Cliniflux. Hemos intentado ser objetivos, pero te recomendamos pedir demos de varias soluciones antes de decidir. Lo más importante siempre es que la solución elegida cumpla con el RGPD y use la API oficial de WhatsApp.</blockquote>

<h2>Criterios de evaluación</h2>
<p>Para evaluar cualquier software de WhatsApp para clínicas, estos son los criterios más relevantes:</p>
<ol>
  <li><strong>Cumplimiento RGPD:</strong> ¿Infraestructura europea? ¿Firman DPA?</li>
  <li><strong>API oficial de WhatsApp:</strong> ¿Usan la API oficial de Meta o soluciones no oficiales?</li>
  <li><strong>Calidad de la IA:</strong> ¿Entiende preguntas en español con terminología médica?</li>
  <li><strong>Facilidad de configuración:</strong> ¿Puede configurarlo un no técnico?</li>
  <li><strong>Precio y modelo de negocio:</strong> ¿Precio predecible o variable por conversación?</li>
  <li><strong>Soporte en español:</strong> ¿Hay alguien que hable español si hay un problema?</li>
  <li><strong>Reactivación de pacientes:</strong> ¿Permiten campañas salientes?</li>
  <li><strong>Setup incluido:</strong> ¿Quién hace la configuración inicial?</li>
</ol>

<h2>Tipos de soluciones disponibles en el mercado</h2>

<h3>1. Plataformas de automatización WhatsApp especializadas en sanidad</h3>
<p>Son las más adecuadas para clínicas. Están diseñadas específicamente para el sector sanitario con configuraciones pensadas para gestión de citas, terminología médica y cumplimiento RGPD.</p>
<p><strong>Ejemplo: Cliniflux</strong> — Especializado en clínicas españolas desde el onboarding hasta la configuración de la IA. Precio predecible desde 99€/mes con setup gratuito.</p>

<h3>2. Plataformas genéricas de automatización WhatsApp</h3>
<p>Sirven para cualquier sector. Requieren más configuración personalizada y generalmente no tienen experiencia específica en terminología sanitaria o normativa española.</p>
<p><strong>Ventaja:</strong> Más baratas en el tier básico<br>
<strong>Desventaja:</strong> Requieren más trabajo de configuración, soporte generalista, menos experiencia con RGPD sanitario español</p>

<h3>3. Módulos WhatsApp de software de gestión clínica</h3>
<p>Algunos software como Doctoralia o ClinicSoftware incluyen funciones básicas de WhatsApp. Son menos potentes en automatización pero se integran directamente con la agenda.</p>
<p><strong>Ventaja:</strong> Integración nativa con la agenda<br>
<strong>Desventaja:</strong> Menos capacidad de IA, más limitados en reactivación y campañas</p>

<h2>Tabla comparativa: criterios clave</h2>
<table>
  <thead>
    <tr><th>Criterio</th><th>Cliniflux</th><th>Plataformas genéricas</th><th>Módulos de software clínico</th></tr>
  </thead>
  <tbody>
    <tr><td>RGPD / Infra. europea</td><td>✅ Sí</td><td>⚠️ Depende del proveedor</td><td>✅ Sí (generalmente)</td></tr>
    <tr><td>API oficial WhatsApp</td><td>✅ Sí</td><td>✅/⚠️ Verificar</td><td>✅ Sí</td></tr>
    <tr><td>IA especializada en sanidad ES</td><td>✅ Sí</td><td>⚠️ Genérica</td><td>⚠️ Básica</td></tr>
    <tr><td>Setup incluido</td><td>✅ Gratuito</td><td>❌ Generalmente no</td><td>⚠️ Básico</td></tr>
    <tr><td>Reactivación de pacientes</td><td>✅ Incluida (Pro)</td><td>⚠️ Extra</td><td>❌ No</td></tr>
    <tr><td>Precio predecible</td><td>✅ Sí (flat)</td><td>⚠️ A veces por conversación</td><td>✅ Sí</td></tr>
    <tr><td>Soporte en español</td><td>✅ Sí</td><td>⚠️ Depende</td><td>✅ Sí</td></tr>
    <tr><td>Precio desde</td><td>99€/mes</td><td>30-200€/mes</td><td>Incluido en el software</td></tr>
  </tbody>
</table>

<h2>¿Cuándo elegir cada tipo de solución?</h2>

<h3>Elige una plataforma especializada en sanidad (como Cliniflux) si:</h3>
<ul>
  <li>Necesitas que funcione desde el primer día sin configuración técnica</li>
  <li>El RGPD y el cumplimiento legal son prioritarios para ti</li>
  <li>Quieres reactivación de pacientes y campañas salientes</li>
  <li>Prefieres precio flat predecible</li>
  <li>Tu equipo no tiene perfil técnico</li>
</ul>

<h3>Elige una plataforma genérica si:</h3>
<ul>
  <li>Tienes un perfil técnico en el equipo para la configuración</li>
  <li>Necesitas integraciones muy específicas que las plataformas especializadas no ofrecen</li>
  <li>Tienes volumen muy alto y necesitas precio variable por uso</li>
</ul>

<h3>Elige módulo de tu software de gestión si:</h3>
<ul>
  <li>La integración directa con tu agenda es lo más importante</li>
  <li>Solo necesitas recordatorios básicos, sin IA avanzada</li>
  <li>Tu software actual incluye esta funcionalidad sin coste adicional</li>
</ul>

<h2>Preguntas que hacer antes de contratar cualquier solución</h2>
<ol>
  <li>¿Dónde están alojados mis datos?</li>
  <li>¿Firmáis DPA?</li>
  <li>¿Usáis la API oficial de WhatsApp Business?</li>
  <li>¿Puedo ver una demo con los datos reales de mi clínica?</li>
  <li>¿Cómo es el proceso de onboarding y quién lo hace?</li>
  <li>¿Cuál es el soporte si algo falla?</li>
  <li>¿El precio incluye la API de WhatsApp o se cobra aparte?</li>
</ol>

<div class="art-cta">
  <h3>Prueba Cliniflux antes de decidir</h3>
  <p>Demo gratuita de 30 minutos. Sin compromiso. Te mostramos cómo funciona con los datos de tu clínica.</p>
  <a href="/contacto">Solicitar demo gratuita →</a>
</div>

<h2>Conclusión</h2>
<p>No existe una solución "mejor" universalmente — depende de las necesidades específicas de cada clínica. Los criterios más importantes son siempre el cumplimiento RGPD y el uso de la API oficial de WhatsApp; el resto son factores secundarios.</p>
<p>Si quieres profundizar en la automatización WhatsApp para tu especialidad, lee nuestros artículos sobre <a href="/whatsapp-clinica-dental">clínicas dentales</a>, <a href="/whatsapp-fisioterapia">fisioterapia</a>, <a href="/whatsapp-clinica-estetica">clínicas estéticas</a>, <a href="/whatsapp-psicologia">psicología</a> o <a href="/whatsapp-nutricion">nutrición</a>.</p>
`
  },
  {
    slug: 'integracion-whatsapp-gesden-cliniccloud-doctoralia',
    title: 'Integración WhatsApp con Gesden, Clinic Cloud y Doctoralia: Guía 2025',
    description: 'Cómo integrar WhatsApp automatizado con tu software de gestión clínica: Gesden, Clinic Cloud, Doctoralia y otros. Qué es posible, qué no, y cómo sacar el máximo partido.',
    date: '2025-04-08',
    modified: '2025-04-08',
    author: 'Equipo Cliniflux',
    readingTime: '9 min',
    category: 'Integraciones',
    keywords: ['integración WhatsApp software gestión clínica', 'WhatsApp Gesden integración', 'WhatsApp Clinic Cloud', 'WhatsApp Doctoralia integración'],
    faq: [
      { q: '¿Puede Cliniflux integrarse con Gesden?', a: 'Cliniflux funciona de forma complementaria a Gesden sin necesidad de integración técnica directa. Los datos de citas recogidos por WhatsApp se gestionan en el panel de Cliniflux y el equipo los confirma manualmente en Gesden. La integración directa vía API está disponible en el plan Clínica.' },
      { q: '¿Funciona Cliniflux con Doctoralia?', a: 'Sí, de forma complementaria. Doctoralia gestiona la agenda online; Cliniflux gestiona la comunicación WhatsApp. Ambos pueden funcionar en paralelo. Para sincronización directa de agenda, consúltanos en el plan Clínica.' },
      { q: '¿Necesito cambiar mi software de gestión para usar Cliniflux?', a: 'No. Cliniflux funciona de forma independiente a tu software actual. No requiere cambiar ni modificar ningún sistema existente. Simplemente añade la capa de comunicación WhatsApp sobre lo que ya tienes.' }
    ],
    content: `
<p>Una de las preguntas más frecuentes de los gestores de clínicas es: <strong>¿puede integrarse WhatsApp automatizado con mi software de gestión?</strong> La respuesta corta: sí, con matices importantes. Esta guía explica qué es posible con Gesden, Clinic Cloud, Doctoralia y otros sistemas.</p>

<blockquote>Respuesta directa: Cliniflux funciona de forma complementaria a cualquier software de gestión clínica sin necesidad de integración técnica. Los datos de citas se recogen por WhatsApp y el equipo los confirma en su software habitual. Para sincronización directa de agenda, está disponible en el plan Clínica mediante API.</blockquote>

<h2>Dos modelos de integración WhatsApp-software clínico</h2>
<p>Antes de entrar en los softwares específicos, es importante entender que hay dos modelos de integración:</p>

<h3>Modelo 1: Integración complementaria (independiente)</h3>
<p>Cliniflux gestiona la comunicación WhatsApp de forma independiente. Los datos de citas recogidos por WhatsApp los gestiona el equipo en su software habitual.</p>
<p><strong>Flujo:</strong> Paciente → WhatsApp (Cliniflux) → Equipo revisa panel Cliniflux → Confirma cita en Gesden/Clinic Cloud → Paciente recibe confirmación</p>
<p><strong>Ventajas:</strong> Sin complejidad técnica, activo en 48h, sin dependencia del software clínico<br>
<strong>Disponible en:</strong> Todos los planes de Cliniflux</p>

<h3>Modelo 2: Integración directa vía API</h3>
<p>Sincronización bidireccional: cuando se agenda una cita por WhatsApp, se crea automáticamente en el software clínico. Y cuando el equipo confirma en el software, el paciente recibe confirmación por WhatsApp.</p>
<p><strong>Ventajas:</strong> Cero trabajo manual, agenda siempre sincronizada<br>
<strong>Disponible en:</strong> Plan Clínica (consultar disponibilidad por software)</p>

<h2>Gesden y WhatsApp: qué es posible</h2>
<p>Gesden es el software de gestión dental más usado en España. Su integración con WhatsApp es posible a diferentes niveles:</p>

<h3>Integración complementaria (disponible ahora)</h3>
<ul>
  <li>Natalia recoge la solicitud de cita por WhatsApp (nombre, servicio, franja horaria)</li>
  <li>El equipo ve la solicitud en el panel de Cliniflux</li>
  <li>Confirma y crea la cita manualmente en Gesden</li>
  <li>El recordatorio automático se envía desde Cliniflux</li>
</ul>
<p>Este modelo ya funciona con todos los planes de Cliniflux. La clínica mantiene Gesden como sistema central y añade Cliniflux como capa de comunicación WhatsApp.</p>

<h3>Integración directa (plan Clínica)</h3>
<p>Para clínicas con Gesden que necesitan sincronización automática, disponemos de integración vía API en el plan Clínica. Consúltanos para los detalles de tu versión de Gesden.</p>

<h2>Clinic Cloud y WhatsApp</h2>
<p>Clinic Cloud es un software de gestión clínica en la nube muy popular en España para múltiples especialidades. Su integración con Cliniflux funciona de forma similar:</p>

<h3>Integración complementaria</h3>
<p>Cliniflux recoge las solicitudes de WhatsApp; el equipo las confirma en Clinic Cloud. El workflow típico:</p>
<ol>
  <li>Paciente solicita cita por WhatsApp a las 20:00</li>
  <li>Cliniflux recoge: nombre, servicio, disponibilidad preferida</li>
  <li>A las 9:00, el equipo abre el panel de Cliniflux, ve las solicitudes pendientes</li>
  <li>Crea la cita en Clinic Cloud</li>
  <li>Marca como confirmada en Cliniflux → el paciente recibe confirmación por WhatsApp automáticamente</li>
</ol>

<h2>Doctoralia y WhatsApp: integración y complementariedad</h2>
<p>Doctoralia es la plataforma líder de gestión de agenda online en España. Muchas clínicas la usan junto con Cliniflux porque cumplen funciones complementarias:</p>

<h3>Doctoralia + Cliniflux: dos canales, una clínica</h3>
<table>
  <thead><tr><th>Función</th><th>Doctoralia</th><th>Cliniflux</th></tr></thead>
  <tbody>
    <tr><td>Citas online (web)</td><td>✅</td><td>—</td></tr>
    <tr><td>Citas por WhatsApp</td><td>—</td><td>✅</td></tr>
    <tr><td>Recordatorios email</td><td>✅</td><td>—</td></tr>
    <tr><td>Recordatorios WhatsApp</td><td>—</td><td>✅</td></tr>
    <tr><td>Reseñas y reputación online</td><td>✅</td><td>—</td></tr>
    <tr><td>Reactivación de pacientes WhatsApp</td><td>—</td><td>✅</td></tr>
    <tr><td>Respuestas IA 24/7</td><td>—</td><td>✅</td></tr>
  </tbody>
</table>
<p>Muchas clínicas usan ambos en paralelo: Doctoralia para la agenda online visible y SEO de directorios médicos; Cliniflux para toda la comunicación WhatsApp.</p>

<h2>Otros softwares de gestión clínica</h2>

<h3>Nexo y Evolta</h3>
<p>Populares en clínicas de fisioterapia y medicina general. Integración complementaria disponible con Cliniflux sin modificaciones técnicas.</p>

<h3>Orca y MedMassager</h3>
<p>Sistemas usados en clínicas estéticas. Mismo modelo complementario. Para integraciones vía API, disponible en plan Clínica.</p>

<h3>Software propio / desarrollo a medida</h3>
<p>Si tu clínica usa un software desarrollado a medida, Cliniflux dispone de API REST para integraciones personalizadas en el plan Clínica. Consúltanos los detalles técnicos.</p>

<h2>Cómo empezar con la integración complementaria (sin complejidad técnica)</h2>
<p>Para el 95% de las clínicas, la integración complementaria es suficiente y puede estar activa en 48h:</p>
<ol>
  <li>Solicita demo de Cliniflux</li>
  <li>Durante el onboarding, configuras tus servicios y protocolo de citas</li>
  <li>Cliniflux empieza a gestionar los WhatsApps</li>
  <li>Tu equipo usa el panel de Cliniflux para ver solicitudes de cita y marcarlas como confirmadas en tu software habitual</li>
  <li>Los recordatorios automáticos funcionan desde el primer día</li>
</ol>
<p>No se necesita cambiar ningún sistema, instalar nada ni hacer desarrollos técnicos.</p>

<div class="art-cta">
  <h3>¿Compatible con tu software de gestión?</h3>
  <p>Casi seguro que sí. Cuéntanos qué software usas y te explicamos exactamente cómo funciona la integración.</p>
  <a href="/contacto">Consultar compatibilidad →</a>
</div>

<h2>Conclusión</h2>
<p>La integración WhatsApp con cualquier software de gestión clínica en España es posible en dos modalidades: complementaria (sin trabajo técnico, activo en 48h) y directa vía API (para sincronización total de agenda). Para el 95% de las clínicas, el modelo complementario es suficiente y ofrece el mismo resultado operativo con cero complejidad.</p>
<p>Para más información, lee nuestra <a href="/blog/automatizacion-whatsapp-clinicas-guia-completa">guía completa de automatización WhatsApp para clínicas</a> o consulta las páginas específicas de tu especialidad: <a href="/whatsapp-clinica-dental">dental</a>, <a href="/whatsapp-fisioterapia">fisioterapia</a>, <a href="/whatsapp-clinica-estetica">estética</a>.</p>
`
  }
];

module.exports = { BLOG_POSTS, renderBlogPost };
