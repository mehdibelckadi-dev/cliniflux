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

CALENDAR_ID = os.environ.get("GOOGLE_CALENDAR_ID", "")
MADRID = ZoneInfo("Europe/Madrid")

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
            return "No hay eventos en los proximos 14 dias. Todos los horarios estan libres."
        lines = []
        for e in events:
            summary = e.get("summary", "Ocupado")
            start = e["start"].get("dateTime", e["start"].get("date", ""))
            end = e["end"].get("dateTime", e["end"].get("date", ""))
            lines.append(f"- {summary}: {start} hasta {end}")
        return "\n".join(lines)
    except Exception as ex:
        return "Sin eventos registrados. Todos los horarios disponibles."

def create_calendar_event(tratamiento, fecha, hora, nombre):
    try:
        service = get_calendar_service()
        import dateparser
        start_dt = dateparser.parse(
            f"{fecha} {hora}",
            settings={
                "TIMEZONE": "Europe/Madrid",
                "RETURN_AS_TIMEZONE_AWARE": True,
                "PREFER_DATES_FROM": "future",
                "DATE_ORDER": "DMY"
            }
        )
        if not start_dt:
            return False, "No se pudo interpretar la fecha/hora"
        end_dt = start_dt + timedelta(hours=1)
        event = {
            "summary": f"{tratamiento} - {nombre}",
            "description": f"Cita reservada por Natalia (recepcionista virtual)\nTratamiento: {tratamiento}\nCliente: {nombre}",
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "Europe/Madrid"},
            "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "Europe/Madrid"},
        }
        created = service.events().insert(calendarId=CALENDAR_ID, body=event).execute()
        return True, created.get("htmlLink", "")
    except Exception as ex:
        return False, str(ex)

NATALIA_SYSTEM = """Eres Natalia, recepcionista de la Clinica Estetica Madrid.

Atiendes pacientes por chat. Hablas siempre en espanol, de forma natural y cercana, como por WhatsApp. Nunca digas que eres una IA o un sistema automatico.

DATOS DE LA CLINICA
Nombre: Clinica Estetica Madrid
Direccion: Calle Correa 47, Madrid
Horario: Lunes a Viernes 10:00-19:00 | Sabado 10:00-14:00 | Domingo cerrado

TRATAMIENTOS DISPONIBLES
Botox, Acido hialuronico, Rellenos faciales, Limpieza facial, Laser, Depilacion laser, PRP, Mesoterapia, Tratamientos corporales, Peeling quimico, Rejuvenecimiento facial, Consulta medica

PERSONALIDAD
Tono profesional y cercano. Amable y segura. Respuestas cortas como por WhatsApp. Sin frases roboticas.

FECHA Y HORA ACTUAL
Hoy es {today}.
Usa esta fecha para interpretar expresiones como "manana", "el lunes", "esta semana", etc.
Calcula siempre la fecha real correcta. En la confirmacion usa siempre la fecha completa (ej: "19 de marzo de 2026"), nunca terminos relativos como "manana".

GESTION DE CITAS
Para reservar necesitas 4 datos: tratamiento, fecha, hora, nombre.
Pide de uno en uno solo el que falte.
NUNCA pidas un dato que el cliente ya haya dado en esta conversacion.

CALENDARIO - EVENTOS OCUPADOS PROXIMOS 14 DIAS
{calendar_events}

Si la lista dice que no hay eventos, todos los horarios estan libres, confirma el que pida el cliente.
Si la hora pedida NO aparece en la lista, esta libre, confirmala.
Si la hora pedida SI aparece en la lista, esta ocupada, ofrece una alternativa cercana.
Nunca digas que no tienes acceso al calendario.

CONFIRMACION DE CITA
Cuando tengas los 4 datos confirma asi:
"Perfecto [nombre], te confirmo la cita el [fecha completa real] a las [hora] para [tratamiento]. Te esperamos en Clinica Estetica Madrid!"

Justo despues escribe en una linea separada exactamente esto:
CITA_CONFIRMADA|tratamiento=[tratamiento]|fecha=[fecha completa real]|hora=[hora]|nombre=[nombre]

NO HACER NUNCA
- Repetir preguntas o pedir datos ya dados
- Usar "manana" u otras fechas relativas en la confirmacion
- Confirmar con fecha incorrecta o inventada
- Decir que eres IA o sistema
- Enviar links o URLs
- Inventar horarios
- Reiniciar la conversacion"""

def build_system_prompt(calendar_events):
    now = datetime.now(MADRID)
    dias = {0:"Lunes",1:"Martes",2:"Miercoles",3:"Jueves",4:"Viernes",5:"Sabado",6:"Domingo"}
    meses = {1:"enero",2:"febrero",3:"marzo",4:"abril",5:"mayo",6:"junio",
             7:"julio",8:"agosto",9:"septiembre",10:"octubre",11:"noviembre",12:"diciembre"}
    today = f"{dias[now.weekday()]} {now.day} de {meses[now.month]} de {now.year}"
    return NATALIA_SYSTEM.format(today=today, calendar_events=calendar_events)

def parse_confirmation(text):
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
    lines = [l for l in text.split("\n") if not l.startswith("CITA_CONFIRMADA|")]
    return "\n".join(lines).strip()

@app.post("/chat")
async def chat(request: Request):
    body = await request.json()
    session_id = body.get("session_id", "default")
    msg = body.get("msg", "").strip()

    if not msg:
        return PlainTextResponse("Por favor escribe tu mensaje.")

    session = get_session(session_id)
    history = session.get("history", [])
    calendar_events = get_calendar_events()

    messages = [{"role": "system", "content": build_system_prompt(calendar_events)}]
    messages.extend(history)
    messages.append({"role": "user", "content": msg})

    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        max_tokens=300,
        temperature=0.3
    )
    reply = response.choices[0].message.content

    cita = parse_confirmation(reply)
    if cita:
        ok, link = create_calendar_event(
            cita.get("tratamiento", ""),
            cita.get("fecha", ""),
            cita.get("hora", ""),
            cita.get("nombre", "")
        )
        if ok:
            print(f"Cita creada: {link}")
        else:
            print(f"Error calendario: {link}")

    reply_clean = clean_response(reply)

    history.append({"role": "user", "content": msg})
    history.append({"role": "assistant", "content": reply_clean})
    if len(history) > 20:
        history = history[-20:]

    session["history"] = history
    save_session(session_id, session)

    return PlainTextResponse(reply_clean)

@app.get("/")
def health():
    return {"status": "Cliniflux online"}
