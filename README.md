# TestMona | AI Test Management System

[![Product Hunt](https://img.shields.io/badge/Product_Hunt-TestMona-FF5521?style=for-the-badge&logo=producthunt)](https://www.producthunt.com/products/testmona?utm_source=other&utm_medium=social)

TestMona is an AI-powered, full-stack test management platform for organizing QA
across projects — requirements, test cases, suites, runs, defects, milestones, and
reports — with a built-in Doc Hub, an advanced query language, and AI assistance.
Built with a React frontend and a FastAPI API.

![TestMona dashboard](Docs/Screenshot-2.png)

## Features

| Feature | Description |
| --- | --- |
| AI-Assisted Testing | Pluggable multi-provider AI manager with a project requirement assistant, action-specific test-case generation, and built-in similarity/duplicate detection so generated cases stay unique. |
| Doc Hub (Docs-as-Code) | Versioned spaces and documents with a rich editor, @mentions, public doc sharing, and one-click document→requirement conversion. |
| Advanced Search & TQL | A JQL-style Test Query Language for precise filtering across defects, requirements, and test cases from a dedicated search workspace. |
| Requirements & Traceability | Requirement folders, review comments and history, external tracker import, and end-to-end traceability linking requirements, test cases, and defects. |
| Test Execution | Step-level outcomes with execution timers, bulk run creation, per-environment filtering, assignees with live progress, and defect logging from runs. |
| Reports & Analytics | A consolidated analytics workspace, printable run reports, and public, shareable report links for stakeholders. |
| Milestones & Test Plans | Portfolio views with automatic status rollups and managed plan/test links. |
| Data-Driven Testing | Reusable datasets and global parameters resolved directly inside test-case flows. |
| Reusable Assets & Custom Fields | Shared steps, tags, and project-level custom fields across entities. |
| Audit & Collaboration | Project audit trails (with purge), an RTL-aware notification system, and full internationalization (multi-language + RTL). |


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

Open the app at [http://localhost:3000](http://localhost:3000). The backend API is available at [http://localhost:8000](http://localhost:8000), and Swagger docs are available at [http://localhost:8000/api-docs](http://localhost:8000/api-docs).

## Documentation


[![Project Wiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/pricyproject/testmona)

## Database

SQLite is the zero-config default. To use **MariaDB/MySQL** (or PostgreSQL), set `DATABASE_URL` — the target database is auto-created on first start:

```bash
# MariaDB / MySQL (driver: PyMySQL, already in requirements)
DATABASE_URL="mysql+pymysql://user:password@localhost:3306/test_management?charset=utf8mb4"
# PostgreSQL
DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/test_management"
```

## Docker

```bash
docker compose up --build            # SQLite (default)
docker compose --profile mariadb up   # bundled MariaDB service
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
