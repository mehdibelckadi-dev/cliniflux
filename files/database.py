import json
import os

# Sessions are stored as JSON files in a /data directory
# On Railway, use a volume or environment variable for persistence
# For simplicity we use a dict in memory + file backup

DATA_DIR = os.environ.get("DATA_DIR", "/data")

def _session_path(session_id: str) -> str:
    safe_id = "".join(c for c in session_id if c.isalnum() or c in "-_")
    return os.path.join(DATA_DIR, f"{safe_id}.json")

def get_session(session_id: str) -> dict:
    path = _session_path(session_id)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"history": []}
    except Exception as e:
        print(f"Error reading session {session_id}: {e}")
        return {"history": []}

def save_session(session_id: str, data: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = _session_path(session_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving session {session_id}: {e}")
