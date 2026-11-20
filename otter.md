# Otter — Build Plan

Otter is a desktop PostgreSQL viewer built with Wails. The UX spec is
`postgres_viewer_prototype.html` (mock-data prototype): saved connections, schema/table
browser, editable data grid with SQL review, SQL runner with history, and create
schema/table forms.

This file is the agreed plan for the tutorial build. Each stage ends in a runnable app
and a verification checkpoint.

---

## Decisions

| Question | Choice |
|---|---|
| Tutorial format | Stage-by-stage: implement, explain, you run and verify, then next stage |
| Data layer | Real Postgres from day one (no mock phase) |
| Frontend | React port of the prototype, in the existing Wails React template |

## Stack

- Wails **v2.17.1** (Go 1.27), window + asset embedding
- Go backend with **pgx v5** (`pgxpool`) for Postgres
- React **19** + Vite **7** frontend
- Postgres **17** in Docker, database `shop_dev`

## How the layers talk

```
React component
  → import { Connect } from "../wailsjs/go/main/App"
  → window.go.main.App.Connect(cfg)          (runtime bridge)
  → Go: func (a *App) Connect(cfg) ...       (app.go)
  → db.go (pgxpool queries)
  → Postgres
```

Rules that follow from this:

- Every **exported method** on `App` becomes a JS function; unexported methods do not.
- Return values/arguments are JSON-marshalled, so struct fields need exported names
  and `json:"..."` tags.
- Generate bindings with `wails dev` or `wails generate module` after changing the Go
  API. Never hand-edit `frontend/wailsjs/`.

## Repository map

```
otter/
├── main.go                     window options, embed, startup/shutdown
├── app.go                      Wails-bound App methods (the API surface)
├── db.go                       pool lifecycle, DSN, schema queries
├── connections.go              saved profiles in the user config dir (no passwords)
├── docker-compose.yml          Postgres 17 dev service
├── dev/seed.sql                schema + data, runs on first container start
├── frontend/
│   ├── index.html
│   ├── src/main.jsx            React entry
│   ├── src/App.jsx             screens (grows per stage)
│   ├── src/App.css
│   ├── src/style.css           tokens/theme for now; prototype tokens in Stage 8
│   └── wailsjs/                generated bindings (regenerate, don't edit)
├── postgres_viewer_prototype.html   reference spec
└── otter.md                    this file
```

`db.go` will split into per-domain files as the API grows (e.g. `db_schema.go`,
`db_rows.go`, `db_edit.go`, `db_sql.go`) around Stage 3–6; the doc will note splits
when they happen.

## Dev environment

| Task | Command |
|---|---|
| Start Postgres | `docker compose up -d` |
| Stop Postgres | `docker compose stop` |
| Reset DB to seed | `docker compose down -v && docker compose up -d` |
| Run app (hot reload) | `wails dev` |
| Regenerate bindings only | `wails generate module` |
| Compile check | `go build ./...` |
| Frontend check | `cd frontend && npm run build` |
| Production build (Stage 9) | `wails build` |

Seed data: `public.users` (12), `public.orders` (10, FK to users),
`public.audit_log` (4, **no primary key** — exercises the read-only grid path),
`billing.invoices` (4, FK to orders). Credentials: `postgres` / `postgres`,
database `shop_dev`.

Init scripts in `dev/seed.sql` only run when the volume is empty. Editing the seed
requires `docker compose down -v` first.

---

## Status

| Stage | State |
|---|---|
| 0. Environment | **Done** — container healthy, seed verified (17.12) |
| 1. Vertical slice | **Done** — Connect verified |
| 2. Saved connections | **Code complete** — checkpoint pending |
| 3–9 | Not started |

---

## Stage 1 — Vertical slice (Connect)

Goal: prove the whole chain works before building UI breadth.

Backend (`db.go`, `app.go`):
- `ConnectConfig` / `ConnectionInfo` types
- Single `pgxpool.Pool` guarded by a mutex
- DSN via `net/url` (safe escaping), 8s timeout, `Ping`, then
  `current_setting('server_version')` and `pg_namespace` schema list
- `App.Connect`, `App.Disconnect`, pool closed in `OnShutdown`

Frontend (`App.jsx`):
- Connection form prefilled for the dev database
- `await Connect(cfg)`; rejection text shown in the status line

Concepts: Wails bindings, bound struct lifetime, connection pooling, DSN escaping.

**Done when:** the app connects and shows PostgreSQL 17.12 with schemas
`billing` and `public`.

## Stage 2 — Saved connections

Goal: profiles survive restarts; the connection screen matches the prototype.

Backend:
- `Connections` service: load/save JSON at `os.UserConfigDir()/otter/connections.json`
- Methods: `ListConnections`, `SaveConnection`, `DeleteConnection`,
  `TestConnection` (connect, ping, close)
- **Passwords are never persisted** — the UI asks at connect time
- Accept a `postgresql://` URL as an alternative to fields (parse server-side)

Frontend:
- Connection list with name, `user@host:port/db`, Connect/Delete
- New-connection form with Fields/URL tabs; inline validation messages
- "Test connection" that opens and closes a throwaway pool

Concepts: Wails runtime helpers (`runtime.SaveFileDialog` not needed yet),
config paths, keeping secrets out of disk, validating at the boundary.

**Done when:** create a profile, restart the app, profile is still there and
connects after re-entering the password; delete removes it.

## Stage 3 — Schema/table tree

Goal: the sidebar from the prototype, backed by catalog queries.

Backend:
- `ListSchemaTree()`: schemas → tables → columns
  (`name`, `type`, `nullable`, `primaryKey`), single query joining `pg_class`,
  `pg_attribute`, `pg_index`, `pg_namespace`; exclude system schemas
- Table metadata endpoint: `TableInfo(schema, table)` returning columns + PK columns

Frontend:
- Sidebar tree grouped by schema, table search, selection state
- Selecting a table drives the content pane (empty grid placeholder this stage)
- "No primary key" badge logic driven by real metadata

Concepts: catalog queries, composite vs single-column PKs (single-PK edits in
Stage 5; composite stays read-only initially), not trusting user input for names.

**Done when:** sidebar matches the seeded DB; `audit_log` is flagged no-PK;
`billing` appears as its own schema group.

## Stage 4 — Data grid (read)

Goal: server-side filter/sort/pagination over real SQL.

Backend:
- `QueryRows(TableRequest{Schema, Table, Filter, SortColumn, SortDesc, Page, PageSize})`
  → `{Columns, Rows, Total, Page, PageCount}`
- Identifiers quoted with `pgx.Identifier{...}.Sanitize()`; sort column validated
  against the table's real columns
- Filter: case-insensitive substring over the row, implemented as an `OR` of
  `col::text ILIKE $1` against the table's columns
- `COUNT(*)` with the same predicate for paging; `LIMIT/OFFSET`
- Result size cap; page size fixed at 8 to match the prototype

Frontend:
- Grid with sortable headers, filter box (debounced), pager, row count
- NULL rendered distinctly; long values truncated with tooltip

Concepts: identifier vs value quoting, parameterized SQL, pagination costs,
debouncing.

**Done when:** filter/sort/paging all reflect the database (verify by changing a
row in `psql` and refreshing).

## Stage 5 — Edit and commit

Goal: the staged-edit flow from the prototype, but real and transactional.

Backend:
- `PreviewUpdates(edits []Edit)` → SQL text for review (server-generated so it
  matches what will run)
- `CommitEdits(edits []Edit)` → single transaction, parameterized `UPDATE`s keyed
  by the table's PK; any failure rolls back everything and reports which edit
  failed; returns row counts
- Reject edits without a PK or targeting PK columns

Frontend:
- Double-click editing with numeric/boolean coercion, NULL toggle, Enter/Escape
- Pending edits highlighted, Save/Discard, review panel showing generated SQL
- Tables with no PK are read-only with an explanatory badge

Concepts: transactions, optimistic UI, parameters vs literals, why a PK is
required for safe updates.

**Done when:** edit several cells across rows, review SQL, save, confirm in
`psql`; introduce a constraint violation and see the whole batch roll back.

## Stage 6 — SQL runner

Goal: real query execution with results and history.

Backend:
- `RunQuery(sql)` → `{Columns, Rows, RowCount, DurationMs, Affected, Notice}`
- Detect result sets vs commands (`rows.FieldDescriptions()`); cap returned rows
  (e.g. 1000) and report truncation
- Errors returned with Postgres message and SQLSTATE
- Run against the active pooled connection

Frontend:
- SQL editor (textarea, tab-to-indent later), Run button, Ctrl+Enter
- Result grid reusing the Stage 4 table component; error panel
- History list (session memory, per connection), click to restore

Concepts: `pgx` query vs exec, result-set termination, latency measurement,
multi-statement handling (documented limitation: one statement per run initially).

**Done when:** `SELECT` returns rows; `UPDATE ... RETURNING` works; a syntax
error shows Postgres' message; history restores a query.

## Stage 7 — Create schema and table

Goal: the DDL builders from the prototype.

Backend:
- `CreateSchema(name)`, `CreateTable(def)` using quoted identifiers, server-side
  parameter validation where parameters exist (none in DDL — identifiers are
  quoted, which is the protection)
- Return Postgres errors verbatim; refresh tree on success

Frontend:
- Schema form with SQL preview
- Table builder: schema picker, column rows (name, type, default, nullable, PK),
  add/remove column, live preview, single vs composite PK rendering
- Duplicate/invalid-name checks (client-side hints + server truth)

Concepts: DDL vs DML, identifier quoting, defaults as expressions vs literals.

**Done when:** create a schema and a table, both appear in the sidebar and accept
rows through the grid.

## Stage 8 — Design pass

Goal: visual parity with the prototype on the core screens.

- Port the prototype's design tokens (palette, spacing, radii, type scale) into
  `style.css`; light and dark themes via `color-scheme`
- App shell: header bar, sidebar, tabs, toolbar, pending-changes bar, toasts
- Empty states, error states, loading states
- Keyboard: Enter/Escape while editing, Ctrl+Enter to run SQL, focus management
- Accessibility: labels, focus rings, table semantics

**Done when:** side-by-side with `postgres_viewer_prototype.html`, the core flows
look and behave the same.

## Stage 9 — Package

- App icon and `wails.json` metadata (name, version, company)
- Production `wails build`; smoke-test the binary outside dev mode
- README: install prerequisites, `docker compose up -d`, `wails dev`, build steps
- Verify the app works against a fresh seed (`docker compose down -v && up -d`)

**Done when:** `build/bin/otter.exe` runs standalone and completes the Stage 1–7
flows against the dev database.

---

## Safety and correctness rules (from Stage 4 onward)

1. **Identifiers** (schema, table, column) are never interpolated raw — always
   `pgx.Identifier{...}.Sanitize()`, and only after checking the name against
   catalog metadata.
2. **Values** are always query parameters (`$1`…), never string-concatenated.
3. Sort and filter columns are validated against `TableInfo`, not trusted from the
   frontend.
4. Tables without a primary key are read-only; PK columns are not editable.
5. Passwords are never written to disk or logged.
6. Multi-cell saves run in **one transaction**; partial writes are not acceptable.
7. Result sets are capped; the UI says when output was truncated.

## Out of scope (for now)

Multiple simultaneous connections, SSH tunnels, CSV import/export, EXPLAIN
visualization, schema diff/migrations, password vault, multi-statement SQL
scripts, composite-PK editing.

## Checkpoint protocol

Each stage: code arrives in the repo, this file's status table is updated, and the
stage ends with a short runbook (command, expected result, one thing to inspect in
the code). Report either the expected result or the exact error text; the next
stage only starts after the checkpoint passes.
