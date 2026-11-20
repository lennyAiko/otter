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
| Frontend libraries | TanStack Form (forms), TanStack Table (grids), CodeMirror 6 (SQL editor) — mandated |

## Stack

- Wails **v2.17.1** (Go 1.27), window + asset embedding
- Go backend with **pgx v5** (`pgxpool`) for Postgres
- React **19** + Vite **7** frontend
- Postgres **17** in Docker, database `shop_dev`

### Frontend libraries

Installed in `frontend/package.json`; use them instead of hand-rolled equivalents.

| Package | Installed | Used for |
|---|---|---|
| `@tanstack/react-form` | 1.33 | Every form: connection screen (Stage 2), DDL builders (Stage 7) |
| `@tanstack/react-table` | 9.3 | Data grid (Stage 4) and SQL result grid (Stage 6) |
| `codemirror` + `@codemirror/lang-sql` | 6.x | SQL editor (Stage 6); view/state/commands for setup and keymaps |

Rules:

- Validation lives in TanStack Form `validators` (`onChange` + `onSubmit` with the
  same rule so submit re-checks), not in ad-hoc component state.
- Keep every field mounted while its mode is active: TanStack Form drops unmounted
  fields from `fieldInfo`, so validation only covers what is mounted.
- TanStack Table **v9** uses the new `useTable` API with explicit features
  (`features: {...coreFeatures, rowSortingFeature}`); v8 snippets
  (`useReactTable`, `getCoreRowModel`) do not apply. A
  `@tanstack/react-table/legacy` shim exists; we use the current API.
- CodeMirror is only imported by the Stage 6 editor component, keeping it out of
  the initial bundle until then.

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
├── db.go                       pool lifecycle, DSN, connection info
├── schema.go                   catalog queries (schema tree + column metadata)
├── rows.go                     paged row reads (filter, sort, PK tie-breaker)
├── connections.go              saved profiles in the user config dir (no passwords)
├── docker-compose.yml          Postgres 17 dev service
├── dev/seed.sql                schema + data, runs on first container start
├── frontend/
│   ├── index.html
│   ├── src/main.jsx            React entry
│   ├── src/App.jsx             session switch: connection screen ↔ workspace
│   ├── src/ConnectionScreen.jsx  profiles + connection form (TanStack Form)
│   ├── src/Workspace.jsx       schema sidebar + grid host
│   ├── src/DataGrid.jsx        TanStack Table v9 grid (server-side filter/sort/page)
│   ├── src/App.css
│   ├── src/style.css           tokens/theme for now; prototype tokens in Stage 8
│   └── wailsjs/                generated bindings (regenerate, don't edit)
├── postgres_viewer_prototype.html   reference spec
└── otter.md                    this file
```

`db.go` keeps connection-level concerns; per-domain queries get their own files as
the API grows (`schema.go` now; `db_rows.go`, `db_edit.go`, `db_sql.go` planned
for Stages 4–6).

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
| 2. Saved connections | **Done** — profiles persist; form rebuilt on TanStack Form |
| 3. Schema tree | **Done** — verified against the seeded DB |
| 4. Data grid | **Code complete** — checkpoint pending |
| 5–9 | Not started |

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

Frontend (`ConnectionScreen.jsx`, TanStack Form):
- `useForm` with a single `blank` default (fields + URL); `onChange`/`onSubmit`
  validators per field; unmounted mode hides its own fields from validation
- Connection list with name, `user@host:port/db`, load/Delete
- Fields/URL tabs; "Test connection" uses the same validation pipeline via an
  intent ref before calling `TestConnection`
- Inline field errors under each input; server errors in the status line

Concepts: TanStack Form field registration and validation causes, Wails runtime
helpers (`runtime.SaveFileDialog` not needed yet), config paths, keeping secrets
out of disk, validating at the boundary.

**Done when:** create a profile, restart the app, profile is still there and
connects after re-entering the password; delete removes it.

## Stage 3 — Schema/table tree

Goal: the sidebar from the prototype, backed by catalog queries.

Backend (`schema.go`):
- `ListSchemaTree()`: schemas → tables → columns (`name`, `type`, `nullable`,
  `primaryKey`) from one query over `pg_class`, `pg_namespace`, `pg_attribute`,
  plus a correlated `EXISTS` on `pg_index` for PK detection; system schemas and
  dropped columns excluded; relkind `r`/`p` only (views later)
- Table metadata travels inside the tree payload (no separate `TableInfo` call
  until a screen needs one)

Frontend (`Workspace.jsx`):
- `App.jsx` becomes a session switch: ConnectionScreen ↔ Workspace; leaving the
  workspace calls `Disconnect`
- Sidebar grouped by schema with a case-insensitive table search, selection state,
  row counts, and a "no PK" badge driven by real metadata
- Content pane lists the selected table's columns; placeholder for Stage 4
- Auto-selects the first table after load and preserves the selection on refresh

Concepts: catalog queries, composite vs single-column PKs (single-PK edits in
Stage 5; composite stays read-only initially), not trusting user input for names,
exposing nested Go structs to JS.

**Done when:** sidebar matches the seeded DB; `audit_log` is flagged no-PK;
`billing` appears as its own schema group; search narrows the tree.

## Stage 4 — Data grid (read)

Goal: server-side filter/sort/pagination over real SQL.

Backend (`rows.go`):
- `QueryRows(TableRequest{Schema, Table, Filter, SortColumn, SortDesc, Page,
  PageSize})` → `{Columns, Rows, Total, Page, PageSize, PageCount}`
- Column list and PK flags re-read from the catalog for the requested table;
  unknown tables and unknown sort columns are rejected
- All identifiers via `pgx.Identifier{...}.Sanitize()`; the data query selects
  `col::text` so values arrive as text and SQL NULL stays `nil`
- Filter: `OR` of `col::text ilike $1` across all columns; `%`, `_` and `\` in
  the user's text are escaped, and the term is capped at 200 runes
- `COUNT(*)` with the same predicate; page/pageSize clamped server-side
  (default 8); `LIMIT/OFFSET` rendered from the clamped ints
- Sort validated against catalog columns, with PK columns appended as a stable
  tie-breaker (or used as the default order), falling back to the first column

Frontend (`DataGrid.jsx`, TanStack Table v9):
- `useTable({features, data, columns, state: {sorting}, manualSorting: true})`;
  one column def per response column (`accessorFn` by index)
- Header buttons call `getToggleSortingHandler()`; ▲/▼ markers read
  `getIsSorted()`; sorting state maps to `sortColumn`/`sortDesc`
- 250ms debounced filter box, row count, Prev/Next pager, sticky header
- NULL cells render as an italic `NULL`; cells truncate with a `title` tooltip
- Grid is keyed by `schema.table`, so switching tables resets filter/sort/page

Concepts: identifier vs value quoting, parameterized SQL and LIKE escaping,
pagination costs, mapping text casts back to display, controlled table state.

**Done when:** filter/sort/paging all reflect the database (verify by changing a
row in `psql` and refreshing).

Stage 5 note: rows cross the bridge as text (`nil` for NULL). Edits will coerce
using the catalog type already carried by the schema tree and send typed
parameters with explicit casts.

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
- `SqlEditor.jsx` on CodeMirror 6: extensions from `@codemirror/view`/`state`/
  `commands` (`lineNumbers`, `history`, `keymap`, highlighting), `sql()` language,
  a small theme mapped to our CSS tokens, Ctrl+Enter bound to Run
- Result grid reuses the Stage 4 TanStack Table component (pagination off — the
  server already capped rows); error panel
- History list (session memory, per connection), click to restore the editor text

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

Frontend (TanStack Form):
- Schema form with SQL preview (name field with validator + submit-time check)
- Table builder on TanStack Form with an array field for column rows (name, type,
  default, nullable, PK), add/remove column, live preview, single vs composite PK
  rendering
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
