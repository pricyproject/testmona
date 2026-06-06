#!/bin/bash
set -e

# Wait for the database server to accept connections (server backends only;
# SQLite needs no wait). Robustly parses the host/port out of DATABASE_URL.
python - <<'PY'
import os, socket, sys, time
from sqlalchemy.engine import make_url

url_str = os.environ.get("DATABASE_URL", "")
if url_str and not url_str.startswith("sqlite"):
    url = make_url(url_str)
    host = url.host or "localhost"
    port = url.port or (3306 if url.get_backend_name() == "mysql" else 5432)
    print(f"Waiting for database at {host}:{port} ...", flush=True)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=3):
                print("Database is ready!", flush=True)
                break
        except OSError:
            time.sleep(1)
    else:
        sys.exit("Timed out waiting for the database to become ready")
PY

# Run database migrations (auto-provisions the database for server backends).
echo "Running database migrations..."
python migrate.py --env prod upgrade

# Start the application
echo "Starting TestMona application..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
