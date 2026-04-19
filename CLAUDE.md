# Cliniflux — Documentación del Proyecto

## Stack técnico
- **Runtime:** Node.js
- **Framework:** Express.js (server.js)
- **Deploy:** Railway (Nixpacks — detecta Node automáticamente)
- **Base de datos:** PostgreSQL (Railway, via `pg`)
- **Pagos:** Stripe
- **Email:** Nodemailer
- **IA:** OpenAI API
- **Sesiones:** express-session + connect-pg-simple

## Estructura de rutas

### Páginas estáticas (servidas desde /public/)
- `/` → `public/landing.html` (homepage principal)
- `/about` → `public/about.html`
- `/contacto` → `public/contacto.html`
- `/demo` → `public/demo.html`
- `/login` → `public/login.html`
- `/dashboard` → `public/dashboard.html` (requiere auth)

### Páginas de especialidad
- `/whatsapp-clinica-dental` → `public/whatsapp-clinica-dental.html`
- `/whatsapp-fisioterapia` → `public/whatsapp-fisioterapia.html`
- `/whatsapp-clinica-estetica` → `public/whatsapp-clinica-estetica.html`
- `/whatsapp-psicologia` → `public/whatsapp-psicologia.html`
- `/whatsapp-nutricion` → `public/whatsapp-nutricion.html`

### Blog (renderizado server-side)
- `/blog` → renderizado dinámico desde `blog-posts/index.js`
- `/blog/:slug` → renderizado dinámico desde `blog-posts/index.js`
- Artículos definidos en `blog-posts/index.js` — array `BLOG_POSTS`
- Función `renderBlogPost(post, related)` genera el HTML completo

### SEO
- `/sitemap.xml` → generado dinámicamente en server.js (25 URLs)
- `/robots.txt` → `public/robots.txt`

### Páginas legales
- `/legal/privacidad`, `/legal/terminos`, `/legal/cookies`

### Páginas nuevas (FASE 3)
- `/roadmap` → `public/roadmap.html`
- `/rgpd-clinicas` → `public/rgpd-clinicas.html`

## Dónde van los meta tags
Cada página HTML tiene su propio `<head>` con:
- `<title>` — máx 60 chars
- `<meta name="description">` — 120-160 chars
- `<link rel="canonical">`
- Open Graph (`og:title`, `og:description`, `og:url`, `og:image`, `og:type`)
- Twitter Cards (`twitter:card`, `twitter:title`, etc.)
- JSON-LD schemas en `<script type="application/ld+json">`

NO hay layout compartido — cada HTML es independiente.

## Schema JSON-LD implementados
- `SoftwareApplication` — landing.html
- `FAQPage` — landing.html
- `Organization` — landing.html
- `BreadcrumbList` — todas las páginas
- `Article` — cada post de blog (generado en renderBlogPost)
- `Blog` — /blog listing
- `ContactPage` — contacto.html
- `AboutPage` — about.html

## Build y deploy
- Railway ejecuta `npm start` → `node server.js`
- No hay paso de build (no bundler, no transpilación)
- Los archivos en `/public/` se sirven directamente
- El sitemap se genera en cada request (dinámico)
- Variables de entorno en Railway: DATABASE_URL, STRIPE_*, OPENAI_API_KEY, SESSION_SECRET
- Git remote: `https://github.com/mehdibelckadi-dev/cliniflux.git`
- Deploy via PAT (classic token, scope: repo) — configura con: `git remote set-url origin https://TOKEN@github.com/mehdibelckadi-dev/cliniflux.git`
- GA4 Measurement ID: `G-75KSF9KX7Q`

## Blog
- `blog-posts/index.js` exporta `BLOG_POSTS` (array) y `renderBlogPost(post, related)`
- 6 artículos publicados, todos ≥1500 palabras
- Artículo pilar: `automatizacion-whatsapp-clinicas-guia-completa`

## Acciones manuales pendientes del fundador
- [ ] Google Search Console: verificar dominio y enviar sitemap (acción manual)
- [x] Google Analytics 4: G-75KSF9KX7Q (ya implementado en todas las páginas)
- [ ] Foto + nombre + LinkedIn para /about — **BLOQUEADO, pendiente del fundador**
- [ ] Vídeo testimonial con cliente real (60-90s) — **BLOQUEADO, pendiente de grabar**
- [ ] Testimonios reales (nombre + clínica) — **BLOQUEADO, sin clientes reales aún**
- [ ] Número real de citas/clínicas — **BLOQUEADO: "+40 clínicas" es gancho temporal, sustituir cuando haya datos reales**
- [ ] Publicar ficha en Product Hunt — ejecutable cuando haya tracción inicial
- [ ] Crear fichas en G2 y Capterra
- [ ] Contactar Gaceta Dental, Diario Médico, asociaciones profesionales
