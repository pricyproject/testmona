# TestMona | AI Test Management System

[![Product Hunt](https://img.shields.io/badge/Product_Hunt-TestMona-FF5521?style=for-the-badge&logo=producthunt)](https://www.producthunt.com/products/testmona?utm_source=other&utm_medium=social)

TestMona is your AI teammate for keeping QA in order. It brings everything a test
team juggles (requirements, test cases, suites, runs, defects, milestones, and
reports) into one place, and adds a built-in Doc Hub, a powerful query language,
and a helping hand from AI when you need it. Under the hood it's a React frontend
talking to a FastAPI backend.

<img src="Docs/Screenshot-2.png" alt="TestMona dashboard" width="50%" />

## What you can do with it

| | Feature | What it gives you |
| :---: | --- | --- |
| 🤖 | **AI Test-Case Generation** | Point the AI at a requirement and get a full set of draft test cases back, complete with steps and expected results, ready to review and save. |
| ✨ | **AI Requirement Assistant** | Get suggested titles, descriptions, and acceptance criteria while you write, so a rough idea turns into a clear requirement in seconds. |
| 💬 | **Ask Your Project (AI Chat)** | Hold a conversation with your project: ask questions across requirements, test cases, and docs, and regenerate an answer whenever you want a fresh take. |
| 🪄 | **AI Doc Hub** | Convert documents into requirements, enhance drafts in place, and get an optional AI risk assessment on a doc change before you publish it. |
| 🔁 | **AI Duplicate Detection** | Built-in similarity scoring quietly flags near-duplicate cases as they're generated, so you're not writing the same test twice. |
| 🔌 | **Bring-Your-Own AI Provider** | A pluggable multi-provider AI manager with model-routing settings lets you wire in your own provider and pick the right model per task. |
| 📚 | **Doc Hub (Docs-as-Code)** | Versioned spaces and documents with a rich editor, `@mentions`, and shareable public links; turn any doc into a requirement in a single click. |
| 🔍 | **Advanced Search & TQL** | A JQL-style query language that lets you slice across defects, requirements, and test cases from one dedicated search workspace. |
| 🔗 | **Requirements & Traceability** | Organize requirements into folders, leave review comments, pull in items from external trackers, and trace the thread from requirement to test case to defect. |
| ▶️ | **Test Execution** | Record step-by-step outcomes with built-in timers, spin up runs in bulk, filter by environment, assign work, and log defects without leaving the run. |
| 📊 | **Reports & Analytics** | One analytics workspace, printable run reports, and public links you can hand straight to stakeholders. |
| 🎯 | **Milestones & Test Plans** | Portfolio views that roll status up automatically, with plan and test links you manage in place. |
| 🧪 | **Data-Driven Testing** | Reusable datasets and global parameters that resolve right inside your test-case flows. |
| ♻️ | **Reusable Assets & Custom Fields** | Shared steps, tags, and project-level custom fields you can reuse across everything. |
| 🌐 | **Audit & Collaboration** | Project audit trails (purge included), RTL-aware notifications, and full internationalization across languages and writing directions. |


## Quick Start

One script gets the dependencies in place:

```bash
./install.sh
```

Then start the backend:

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

…and the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

That's it. Here's where everything lives once it's running:

| What | Where |
| --- | --- |
| App | [http://localhost:3000](http://localhost:3000) |
| API | [http://localhost:8000](http://localhost:8000) |
| API docs (Swagger) | [http://localhost:8000/api-docs](http://localhost:8000/api-docs) |

## Documentation


[![Project Wiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/pricyproject/testmona)

## Database

Out of the box you get SQLite, with nothing to configure. Want something heavier? Point
`DATABASE_URL` at MariaDB/MySQL or PostgreSQL and TestMona creates the database for
you on first start.

| Engine | `DATABASE_URL` | Driver |
| --- | --- | --- |
| SQLite | *(default, leave it unset)* | built-in |
| MariaDB / MySQL | `mysql+pymysql://user:password@localhost:3306/test_management?charset=utf8mb4` | PyMySQL (already bundled) |
| PostgreSQL | `postgresql+psycopg2://user:password@localhost:5432/test_management` | psycopg2 |

## Docker

Prefer containers? Pick the line that matches your database:

| Command | What it runs |
| --- | --- |
| `docker compose up --build` | The app on SQLite (default) |
| `docker compose --profile mariadb up` | The app plus a bundled MariaDB service |

## Useful Commands

Handy things you'll reach for on the backend, to apply migrations and run the tests:

```bash
cd backend
source venv/bin/activate
alembic upgrade head
pytest
```

…and on the frontend, build and lint:

```bash
cd frontend
npm run build
npm run lint
```

## Support

Like what we're building? You can sponsor the project or hire the team. Tips are
welcome at any of these addresses:

| Network | Address |
| --- | --- |
| USDT (TRC20) / TRX (Tron) | `THVWGyyD7HmFZB8vLakuHxB6VUKXF6Dz8j` |
| Polygon | `0xe662c535565e3bbf553ab79a6ca3eb220d65d491` |
| SUI | `0xd16f6c89b4f0db396ee3a108d78a90d4469c4acfd36ac9cf76a87d064741f8eb` |
| DOT (Polkadot) | `135XJi1pK9gK7wdzbj8UUZ5RMzVGXoXkeypV67Hh4g21Dve2` |
| Solana | `CLg467FS4PnuV6jBT7fYBHSL8BH4fCcqtGd1WHEufrhN` |
| ETH | `0xe662c535565e3bbf553ab79a6ca3eb220d65d491` |
| BTC (Bitcoin) | `bc1qcc0jyfe8r07uy8r972v9m7pp5cgp9zpd0kkzjs` |
| XRP (Ripple) | `rKyycDku9qevKWzSw9DxCDUSRXMNFHHq1k` |
| TON | `UQDSdI27I1LVRSaflE9GypnWPAGN4z0YARlYJtbF9RmSxzpF` |
