#!/bin/bash
cd "$(dirname "$0")"

# Create venv if not exists
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate venv
source .venv/bin/activate

# Install requirements if uvicorn is not yet installed
if ! python3 -c "import uvicorn, fastapi" &> /dev/null; then
    echo "Installing required packages (fastapi, uvicorn, httpx, pydantic)..."
    pip install -r requirements.txt
fi

echo "Starting MCP Registry Backend on http://localhost:8000..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
