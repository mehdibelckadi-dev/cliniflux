# Cliniflux — Bot Recepcionista

Bot de citas para clínica estética. Backend en Python + FastAPI.

---

## PASO 1 — Subir a GitHub

1. Ve a github.com → New repository → nombre: `cliniflux` → Create
2. Sube todos estos archivos al repositorio

---

## PASO 2 — Desplegar en Railway

1. Ve a railway.app → New Project → Deploy from GitHub repo
2. Selecciona tu repositorio `cliniflux`
3. Railway detecta el Procfile y despliega automáticamente

---

## PASO 3 — Configurar Variables de Entorno en Railway

En Railway → tu proyecto → Variables, añade estas 3 variables:

### OPENAI_API_KEY
- Ve a https://platform.openai.com/api-keys
- Create new secret key
- Copia el valor (empieza por sk-...)

### GOOGLE_CALENDAR_ID
- Es el email del calendario donde quieres las citas
- Ejemplo: `mbfazazi@gmail.com`

### GOOGLE_CREDENTIALS_JSON
Esta es la más importante. Sigue estos pasos:

1. Ve a https://console.cloud.google.com
2. Crea un proyecto nuevo (o usa uno existente)
3. Activa la API: APIs & Services → Enable APIs → busca "Google Calendar API" → Enable
4. Crea credenciales: APIs & Services → Credentials → Create Credentials → Service Account
   - Nombre: `cliniflux-bot`
   - Role: `Editor`
   - Create and Continue → Done
5. Haz clic en la cuenta de servicio creada → Keys → Add Key → JSON
6. Se descarga un archivo `.json` — ábrelo con el bloc de notas
7. Copia TODO el contenido y pégalo como valor de `GOOGLE_CREDENTIALS_JSON`

8. **MUY IMPORTANTE**: Comparte tu calendario con la cuenta de servicio:
   - Abre Google Calendar → Configuración del calendario → Compartir
   - Añade el email de la cuenta de servicio (algo como `cliniflux-bot@proyecto.iam.gserviceaccount.com`)
   - Dale permisos de "Realizar cambios en eventos"

---

## PASO 4 — Obtener la URL del backend

En Railway → tu proyecto → Settings → Domains → Generate Domain
Te dará una URL como: `https://cliniflux-production-xxxx.up.railway.app`

---

## PASO 5 — Actualizar el formulario web

En tu HTML, cambia la línea del webhook:

```javascript
// ANTES (Make)
const webhook = "https://hook.eu1.make.com/..."

// DESPUÉS (Railway)
const webhook = "https://cliniflux-production-xxxx.up.railway.app/chat"
```

---

## PASO 6 — Añadir volumen en Railway (para que la memoria persista)

1. En Railway → tu proyecto → Add Service → Volume
2. Mount path: `/data`
3. Listo — las conversaciones se guardan aunque el servidor se reinicie

---

## Verificar que funciona

Abre en el navegador: `https://tu-url.up.railway.app/`
Debe responder: `{"status": "Cliniflux online"}`
