#!/bin/bash

# Test Management System Installation Script
# This script sets up the entire system with all dependencies

set -e

echo "🚀 Starting Test Management System Installation..."

# Check if Python 3.13+ is installed
PYTHON_CMD=""
for cmd in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v $cmd &> /dev/null; then
        PYTHON_VERSION=$($cmd --version | awk '{print $2}')
        PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
        PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
        if [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -ge 13 ]; then
            PYTHON_CMD=$cmd
            break
        fi
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "❌ Python 3.13+ is required but not found. Please install Python 3.13 or higher first."
    echo "   Current system python3 version: $(python3 --version 2>&1)"
    exit 1
fi

echo "✅ Using $PYTHON_CMD ($($PYTHON_CMD --version))"

# Check if Node.js 18+ is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed. Please install npm first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Create virtual environment for backend
echo "📦 Setting up Python virtual environment..."
cd backend
$PYTHON_CMD -m venv venv
source venv/bin/activate

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Create environment file if it doesn't exist
if [ ! -f .env ]; then
    echo "🔐 Creating environment file with SECRET_KEY..."
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    cat > .env << EOF
# Database Configuration
# Defaults to SQLite. To use MariaDB/MySQL or PostgreSQL, run the installer with
# DATABASE_URL preset, e.g.:
#   DATABASE_URL="mysql+pymysql://root:password@localhost:3306/test_management" ./install.sh
# The target database is auto-created on first start if it doesn't exist.
DATABASE_URL=${DATABASE_URL:-sqlite:///./test_management.db}

# Security
SECRET_KEY=$SECRET_KEY
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
REFRESH_TOKEN_EXPIRE_DAYS=7

# CORS Settings
ALLOWED_ORIGINS=http://localhost:3000
EOF
    echo "✅ Environment file created"
fi

cd ..

# Initialize the database schema (no users are seeded — the first admin is
# created through the web-based setup wizard on first launch).
echo "🗄️ Initializing database schema..."
cd backend
source venv/bin/activate

# Create/upgrade the schema. init_db() auto-provisions the database for server
# backends (MariaDB/PostgreSQL) and creates any missing tables.
python -c "
from app.database import init_db
init_db()
print('✅ Database schema is ready')
print('ℹ️  No accounts exist yet — open the app and complete the web setup wizard to create your admin.')
"

cd ..

# Setup frontend
echo "📦 Setting up frontend dependencies..."
cd frontend
npm install

# Build frontend for production
echo "🏗️ Building frontend..."
npm run build

cd ..

echo "✅ Installation completed successfully!"
echo ""
echo "🎉 Test Management System is ready to use!"
echo ""
echo "📋 Next Steps:"
echo "1. Start the backend server:"
echo "   cd backend && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000"
echo ""
echo "2. Start the frontend server (for development):"
echo "   cd frontend && npm run dev"
echo ""
echo "3. Open the application and complete the one-time setup wizard:"
echo "   Frontend: http://localhost:3000  (you'll be sent to /setup to create your admin)"
echo "   Backend API: http://localhost:8000"
echo "   API Documentation: http://localhost:8000/api-docs"
echo ""
echo "🔐 No default credentials are shipped. The first account you create in the"
echo "   setup wizard becomes the administrator, and public signup is then closed."
