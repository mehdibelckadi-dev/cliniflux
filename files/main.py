import os
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from database import get_session, save_session

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

CALENDAR_ID = os.environ["GOOGLE_CALENDAR_ID"]
MADRID = ZoneInfo("Europe/Madrid")

# ── Google Calendar setup
def get_calendar_service():
    creds_json = json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"])
    creds = Credentials.from_service_account_info(
        creds_json,
        scopes=["https://www.googleapis.com/auth/calendar"]
    )
    return build("calendar", "v3", credentials=creds)

def get_calendar_events():
    try:
        service = get_calendar_service()
        now = datetime.now(MADRID)
        time_min = now.isoformat()
        time_max = (now + timedelta(days=14)).isoformat()
        events_result = service.events().list(
            calendarId=CALENDAR_ID,
            timeMin=time_min,
            timeMax=time_max,
            maxResults=20,
            singleEvents=True,
            orderBy="startTime"
        ).execute()
        events = events_result.get("items", [])
        if not events:
            return "No hay eventos en los próximos 14 días. Todos los horarios están libres."
        lines = []
        for e in events:
            summary = e.get("summary", "Ocupado")
            start = e["start"].get("dateTime", e["start"].get("date", ""))
            end = e["end"].get("dateTime", e["end"].get("date", ""))
            lines.append(f"- {summary}: {start} hasta {end}")
        return "\n".join(lines)
    except Exception as ex:
        return f"Error al obtener calendario: {ex}"

def create_calendar_event(tratamiento, fecha, hora, nombre):
    try:
        service = get_calendar_service()
        # Parse fecha and hora — expected formats: "18 de marzo", "16:00"
        # We'll build an ISO datetime string
        now = datetime.now(MADRID)
        year = now.year

        # Build start datetime string for OpenAI to parse
        start_str = f"{fecha} {hora} {year} Europe/Madrid"
        # Use a simple approach: ask OpenAI to convert to ISO
        # Instead, use dateparser for robustness
        import dateparser
        start_dt = dateparser.parse(
            f"{fecha} {hora}",
            settings={"TIMEZONE": "Europe/Madrid", "RETURN_AS_TIMEZONE_AWARE": True, "PREFER_DAY_OF_MONTH": "first"}
        )
        if not start_dt:
            return False, "No se pudo interpretar la fecha/hora"

        end_dt = start_dt + timedelta(hours=1)

        event = {
            "summary": f"{tratamiento} — {nombre}",
            "description": f"Cita reservada por Sofía (bot recepcionista)\nTratamiento: {tratamiento}\nCliente: {nombre}",
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "Europe/Madrid"},
            "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "Europe/Madrid"},
        }
        created = service.events().insert(calendarId=CALENDAR_ID, body=event).execute()
        return True, created.get("htmlLink", "")
    except Exception as ex:
        return False, str(ex)

# ── Sofia prompt
SOFIA_SYSTEM = """Eres Sofía, recepcionista de la Clínica Estética Madrid.

Atiendes pacientes por chat. Hablas siempre en español, de forma natural y cercana, como por WhatsApp. Nunca digas que eres una IA.

DATOS DE LA CLÍNICA
Nombre: Clínica Estética Madrid
Dirección: Calle Correa 47, 28011 Madrid
Horario: Lunes-Viernes 10:00-19:00 | Sábado 10:00-14:00 | Domingo cerrado

TRATAMIENTOS
Botox, Ácido hialurónico, Rellenos faciales, Limpieza facial, Láser, Depilación láser, PRP, Mesoterapia, Tratamientos corporales, Peeling químico, Rejuvenecimiento facial, Consulta médica

PERSONALIDAD
Tono profesional y cercano. Respuestas cortas. Sin frases robóticas.

GESTIÓN DE CITAS
Para reservar una cita necesitas: tratamiento, fecha, hora, nombre.
Pide de uno en uno solo el dato que falte.
NUNCA vuelvas a pedir un dato que el cliente ya haya dado en esta conversación.

CALENDARIO — EVENTOS OCUPADOS
{calendar_events}

Si la hora pedida NO aparece en la lista → está libre, confirma.
Si la hora pedida SÍ aparece → está ocupada, ofrece alternativa.
Nunca digas que no tienes acceso al calendario.

CONFIRMACIÓN DE CITA
Cuando tengas tratamiento + fecha + hora + nombre, confirma así:
"Perfecto [nombre], te confirmo la cita el [fecha] a las [hora] para [tratamiento]. ¡Te esperamos!"

Después de confirmar, escribe en una línea nueva exactamente esto (invisible para el cliente, solo para el sistema):
CITA_CONFIRMADA|tratamiento=[tratamiento]|fecha=[fecha]|hora=[hora]|nombre=[nombre]

NO HACER NUNCA
- Repetir preguntas o pedir datos ya dados
- Decir que eres IA
- Enviar links o URLs
- Inventar horarios sin revisar el calendario
- Reiniciar la conversación"""

def build_system_prompt(calendar_events):
    return SOFIA_SYSTEM.format(calendar_events=calendar_events)

def parse_confirmation(text):
    """Extract appointment data if Sofia confirmed a booking."""
    for line in text.split("\n"):
        if line.startswith("CITA_CONFIRMADA|"):
            datos = {}
            parts = line.replace("CITA_CONFIRMADA|", "").split("|")
            for p in parts:
                if "=" in p:
                    k, v = p.split("=", 1)
                    datos[k.strip()] = v.strip()
            return datos
    return None

def clean_response(text):
    """Remove the hidden CITA_CONFIRMADA line from the response sent to the client."""
    lines = [l for l in text.split("\n") if not l.startswith("CITA_CONFIRMADA|")]
    return "\n".join(lines).strip()

# ── Main endpoint
@app.post("/chat")
async def chat(request: Request):
    body = await request.json()
    session_id = body.get("session_id", "default")
    msg = body.get("msg", "").strip()

    if not msg:
        return PlainTextResponse("Por favor escribe tu mensaje.")

    # Load session
    session = get_session(session_id)
    history = session.get("history", [])

    # Get calendar events
    calendar_events = get_calendar_events()

    # Build messages for OpenAI
    messages = [{"role": "system", "content": build_system_prompt(calendar_events)}]
    messages.extend(history)
    messages.append({"role": "user", "content": msg})

    # Call OpenAI
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        max_tokens=300,
        temperature=0.4
    )
    reply = response.choices[0].message.content

    # Check if Sofia confirmed a booking
    cita = parse_confirmation(reply)
    if cita:
        ok, link = create_calendar_event(
            cita.get("tratamiento", ""),
            cita.get("fecha", ""),
            cita.get("hora", ""),
            cita.get("nombre", "")
        )
        if not ok:
            print(f"Error creando evento: {link}")

    # Clean hidden line from reply
    reply_clean = clean_response(reply)

    # Update history
    history.append({"role": "user", "content": msg})
    history.append({"role": "assistant", "content": reply_clean})

    # Keep last 20 messages to avoid token overflow
    if len(history) > 20:
        history = history[-20:]

    # Save session
    session["history"] = history
    save_session(session_id, session)

    return PlainTextResponse(reply_clean)

@app.get("/")
def health():
    return {"status": "Cliniflux online"}
