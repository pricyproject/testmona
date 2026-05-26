# TestMona

TestMona is a full-stack test management system for organizing QA work across projects. It includes project workspaces, requirements, test cases, suites, runs, defects, reports, reusable test assets, audit trails, and a React frontend backed by a FastAPI API.

![TestMona dashboard](Docs/Screenshot-2.png)

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS
- Backend: FastAPI, SQLAlchemy, Alembic, Pydantic, JWT auth
- Tooling: Docker Compose, ESLint, Postman collections

## Quick Start

Automated setup:

```bash
./install.sh
```

Run the backend:

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run the frontend:

```bash
cd frontend
npm run dev
```

Open the app at [http://localhost:3000](http://localhost:3000). The backend API is available at [http://localhost:8000](http://localhost:8000), and Swagger docs are available at [http://localhost:8000/docs](http://localhost:8000/docs).

## Docker

```bash
docker-compose up --build
```

## Demo Login

```text
Email: demo@testmona.com
Password: demo123
```

## Repository Layout

```text
backend/     FastAPI app, routes, models, migrations, OpenAPI, and Postman assets
frontend/    React/Vite application
Docs/        Screenshot assets
```

## Useful Commands

```bash
cd backend
source venv/bin/activate
alembic upgrade head
pytest
```

```bash
cd frontend
npm run build
npm run lint
```

## Support

Sponsor or hire us:

- USDT (TRC20) - TRX (Tron): `THVWGyyD7HmFZB8vLakuHxB6VUKXF6Dz8j`
- Polygon: `0xe662c535565e3bbf553ab79a6ca3eb220d65d491`
- SUI: `0xd16f6c89b4f0db396ee3a108d78a90d4469c4acfd36ac9cf76a87d064741f8eb`
- DOT (Polkadot): `135XJi1pK9gK7wdzbj8UUZ5RMzVGXoXkeypV67Hh4g21Dve2`
- Solana: `CLg467FS4PnuV6jBT7fYBHSL8BH4fCcqtGd1WHEufrhN`
- ETH: `0xe662c535565e3bbf553ab79a6ca3eb220d65d491`
- BTC (Bitcoin): `bc1qcc0jyfe8r07uy8r972v9m7pp5cgp9zpd0kkzjs`
- XRP (Ripple): `rKyycDku9qevKWzSw9DxCDUSRXMNFHHq1k`
- TON: `UQDSdI27I1LVRSaflE9GypnWPAGN4z0YARlYJtbF9RmSxzpF`
