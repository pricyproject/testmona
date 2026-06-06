#!/usr/bin/env python3
"""
Test Management System Setup Script
Automated setup and configuration
"""

import os
import sys
import subprocess
import secrets
from pathlib import Path

def run_command(command, cwd=None):
    """Run a command and return the result"""
    try:
        result = subprocess.run(
            command, 
            shell=True, 
            cwd=cwd, 
            capture_output=True, 
            text=True, 
            check=True
        )
        return True, result.stdout
    except subprocess.CalledProcessError as e:
        return False, e.stderr

def check_prerequisites():
    """Check if all prerequisites are installed"""
    print("🔍 Checking prerequisites...")
    
    # Check Python
    try:
        python_version = sys.version_info
        if python_version < (3, 9):
            print("❌ Python 3.9+ is required")
            return False
        print(f"✅ Python {python_version.major}.{python_version.minor}.{python_version.micro}")
    except:
        print("❌ Python not found")
        return False
    
    # Check Node.js
    success, output = run_command("node --version")
    if success:
        print(f"✅ Node.js {output.strip()}")
    else:
        print("❌ Node.js not found")
        return False
    
    # Check npm
    success, output = run_command("npm --version")
    if success:
        print(f"✅ npm {output.strip()}")
    else:
        print("❌ npm not found")
        return False
    
    return True

def setup_backend():
    """Setup the backend"""
    print("\n📦 Setting up backend...")
    
    backend_dir = Path("backend")
    if not backend_dir.exists():
        print("❌ Backend directory not found")
        return False
    
    # Create virtual environment
    print("   Creating virtual environment...")
    success, output = run_command("python3 -m venv venv", cwd=backend_dir)
    if not success:
        print(f"❌ Failed to create virtual environment: {output}")
        return False
    
    # Activate virtual environment and install dependencies
    venv_python = backend_dir / "venv" / "bin" / "python"
    if not venv_python.exists():
        venv_python = backend_dir / "venv" / "Scripts" / "python.exe"
    
    print("   Installing Python dependencies...")
    success, output = run_command(f"{venv_python} -m pip install --upgrade pip", cwd=backend_dir)
    if not success:
        print(f"❌ Failed to upgrade pip: {output}")
        return False
    
    success, output = run_command(f"{venv_python} -m pip install -r requirements.txt", cwd=backend_dir)
    if not success:
        print(f"❌ Failed to install dependencies: {output}")
        return False
    
    # Initialize database
    print("   Initializing database...")
    success, output = run_command(f"{venv_python} -m alembic upgrade head", cwd=backend_dir)
    if not success:
        print(f"❌ Failed to initialize database: {output}")
        return False
    
    # Create environment file
    env_file = backend_dir / ".env"
    if not env_file.exists():
        print("   Creating environment file...")
        secret_key = secrets.token_urlsafe(32)
        env_content = f"""# Database Configuration
DATABASE_URL=sqlite:///./test_management.db

# Security
SECRET_KEY={secret_key}
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# CORS Settings
ALLOWED_ORIGINS=http://localhost:3000
"""
        with open(env_file, 'w') as f:
            f.write(env_content)
    
    print("✅ Backend setup completed")
    return True

def setup_frontend():
    """Setup the frontend"""
    print("\n📦 Setting up frontend...")
    
    frontend_dir = Path("frontend")
    if not frontend_dir.exists():
        print("❌ Frontend directory not found")
        return False
    
    # Install dependencies
    print("   Installing Node.js dependencies...")
    success, output = run_command("npm install", cwd=frontend_dir)
    if not success:
        print(f"❌ Failed to install dependencies: {output}")
        return False
    
    print("✅ Frontend setup completed")
    return True

def announce_web_setup():
    """No accounts are seeded — the admin is created via the web setup wizard."""
    print("\n👤 Admin account:")
    print("   No default account is created. On first launch the app sends you")
    print("   to the setup wizard (/setup) to create your administrator securely.")
    return True

def main():
    """Main setup function"""
    print("🚀 Test Management System Setup")
    print("=" * 40)
    
    # Check prerequisites
    if not check_prerequisites():
        print("\n❌ Prerequisites check failed. Please install missing dependencies.")
        sys.exit(1)
    
    # Setup backend
    if not setup_backend():
        print("\n❌ Backend setup failed.")
        sys.exit(1)
    
    # Setup frontend
    if not setup_frontend():
        print("\n❌ Frontend setup failed.")
        sys.exit(1)
    
    # No user seeding — the admin is created through the web setup wizard.
    announce_web_setup()

    print("\n" + "=" * 40)
    print("🎉 Setup completed successfully!")
    print("\n📋 Next Steps:")
    print("1. Start the backend:")
    print("   cd backend && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000")
    print("\n2. Start the frontend:")
    print("   cd frontend && npm run dev")
    print("\n3. Open the application and complete the one-time setup wizard:")
    print("   Frontend: http://localhost:3000  (redirects to /setup on first run)")
    print("   Backend API: http://localhost:8000")
    print("   API Documentation: http://localhost:8000/api-docs")
    print("\n🔐 No default credentials are shipped — the first account you create")
    print("   becomes the administrator, and public signup is then closed.")

if __name__ == "__main__":
    main()
