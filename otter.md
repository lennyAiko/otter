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
- CodeMirror is imported only by `SqlEditor.jsx`; from Stage 6 it is part of the
  bundle (which roughly doubles), and that is expected.

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
├── edits.go                    edit validation, SQL preview, transactional commit
├── sqlrunner.go                one-statement runner with text-format results
├── ddl.go                      schema/table DDL validation, quoting, execution
├── connections.go              saved profiles in the user config dir (no passwords)
├── docker-compose.yml          Postgres 17 dev service
├── dev/seed.sql                schema + data, runs on first container start
├── frontend/
│   ├── index.html
│   ├── src/main.jsx            React entry
│   ├── src/App.jsx             session switch: connection screen ↔ workspace
│   ├── src/ConnectionScreen.jsx  profiles + connection form (TanStack Form)
│   ├── src/Workspace.jsx       schema sidebar + grid host
│   ├── src/DataGrid.jsx        TanStack Table v9 grid (server-side filter/sort/page, inline edits)
│   ├── src/SqlEditor.jsx       CodeMirror 6 SQL runner (Run, Ctrl+Enter, history)
│   ├── src/ResultGrid.jsx      read-only TanStack Table grid for SQL results
│   ├── src/DdlForms.jsx        TanStack Form schema + table builders with DDL preview
│   ├── src/Toast.jsx           toast provider and useToast hook
│   ├── src/App.css
│   ├── src/style.css           design tokens (light/dark), base type and focus
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
| 4. Data grid | **Done** — filter/sort/paging verified |
| 5. Edit and commit | **Done** — commit, rollback, NULL and read-only paths verified |
| 6. SQL runner | **Done** — SELECT, RETURNING, errors, cap, history verified |
| 7. Create schema and table | **Done** — verified through the forms and psql |
| 8. Design pass | **Done** — tokens, dark mode, toasts verified live |
| 9. Package | **Done** — `wails build`, standalone smoke test, metadata verified |
| 10. Script runner | **In progress** |

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
- `pg_namespace` drives the query with `LEFT JOIN`, so schemas without tables
  still appear (with an empty `tables` slice — Stage 7 needs them); nil slices
  marshal as `null`, so they are initialized with `[]T{}`
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
- Header buttons call a local `toggleSort(id)`: asc → desc → clear, computed from
  React state with a functional update (v9's `getToggleSortingHandler()` reads a
  stale atom, so two rapid clicks only advanced one step); ▲/▼ markers read the
  same state; sorting state maps to `sortColumn`/`sortDesc`
- 250ms debounced filter box, row count, Prev/Next pager, sticky header
- NULL cells render as an italic `NULL`; cells truncate with a `title` tooltip
- Grid is keyed by `schema.table`, so switching tables resets filter/sort/page

Concepts: identifier vs value quoting, parameterized SQL and LIKE escaping,
pagination costs, mapping text casts back to display, controlled table state.

**Done when:** filter/sort/paging all reflect the database (verify by changing a
row in `psql` and refreshing).

Stage 5 note: rows cross the bridge as text (`nil` for NULL). Edits are validated
against the catalog type in the grid and sent as typed parameters with explicit
casts; the server casts the text again (`$1::text::<type>`), so the grid never
needs to serialize numbers/booleans itself.

## Stage 5 — Edit and commit

Goal: the staged-edit flow from the prototype, but real and transactional.

Backend (`edits.go`):
- `Edit{Schema, Table, Column, Keys []KeyValue, Value *string}` — one cell; the
  PK value travels in `Keys`
- `loadTableMeta` re-reads column types and PK columns from the catalog;
  `prepareEdits` validates every edit (known column, not a PK column, single
  PK, ≤500 edits) and builds both the parameterized statement and its display
  form, so preview and execution cannot drift
- SQL shape: `update <qualified> set <col> = $1::text::<type> where <pk> =
  $2::text::<pkType>`; identifiers via `pgx.Identifier`, values always parameters
- `PreviewUpdates(edits)` → display SQL joined by blank lines
- `CommitEdits(edits)` → one transaction; each `UPDATE` must affect exactly one
  row or the batch rolls back; the error names the failing edit and carries the
  Postgres message/SQLSTATE
- No PK → "has no primary key, so rows cannot be updated safely"; composite PK
  stays read-only for now

Frontend (`DataGrid.jsx`):
- Double-click opens a text editor (Enter commits, Escape cancels, blur commits);
  values are validated against the catalog type (`not a number`, `use true or
  false`) rather than silently coerced; a NULL button stages SQL NULL
- Pending cells are highlighted; edit bar shows the count with Review SQL,
  Save changes, Discard; re-editing a pending cell starts from the staged value
- Cell content is a stable `DataCell` component reading grid state from context:
  v9's `flexRender` treats an inline renderer as a new component type, which
  remounted the input on every keystroke and broke focus/Enter
- Tables with no PK or a composite PK are read-only, with the reason in the
  content header

Concepts: transactions, optimistic UI, parameters vs literals, why a PK is
required for safe updates, component identity and remounting.

**Done when:** edit several cells across rows, review SQL, save, confirm in
`psql`; introduce a constraint violation and see the whole batch roll back.

## Stage 6 — SQL runner

Goal: real query execution with results and history.

Backend (`sqlrunner.go`):
- `RunQuery(sql)` → `{Columns, Rows, RowCount, Affected, DurationMs, Truncated,
  Notice}`; blank input rejected, 30s timeout, empty SQL rejected
- One statement per run: the extended protocol refuses multiple commands, which
  is the documented limitation for now
- Results are fetched with `pgx.QueryResultFormats{pgx.TextFormatCode}` and read
  via `RawValues()`, so every type arrives as Postgres' own text (numeric,
  timestamptz, arrays) and NULL stays nil
- `FieldDescriptions()` distinguishes result sets from commands; both paths read
  `CommandTag()` for the affected count
- Rows capped at 1,000 with a `Truncated` flag and notice
- Errors come back verbatim from pgx (`ERROR: … (SQLSTATE …)`)

Frontend (`SqlEditor.jsx`, `ResultGrid.jsx`):
- CodeMirror 6 with `basicSetup` (line numbers, history, syntax highlighting),
  `sql()` language, a theme mapped to the CSS tokens, `EditorView.lineWrapping`,
  and a `Mod-Enter` keymap above the defaults bound to Run
- Editor text and history live in `Workspace`, so they survive tab switches and
  stay per connection; clicking a history entry refills the editor and focuses it
- SQL results render in `ResultGrid`, a read-only TanStack Table v9 grid (no
  sorting or paging; the server already capped the rows); NULL uses the same
  italic style as the data grid
- Run bar shows `N rows · X ms` or `N rows affected · X ms`, truncation notice,
  and an error panel for failures; failed entries are marked in history
- Content pane gains Data / SQL tabs; picking a table switches back to Data

Concepts: `pgx` query vs exec, text vs binary result formats, result-set
termination, latency measurement, controlled imperative editors in React.

**Done when:** `SELECT` returns rows; `UPDATE ... RETURNING` works; a syntax
error shows Postgres' message; history restores a query.

## Stage 7 — Create schema and table

Goal: the DDL builders from the prototype.

Backend (`ddl.go`):
- `CreateSchema(name)` and `CreateTable(def)`; `quoteIdent` is the only
  protection DDL gets (no parameters), so every identifier goes through it
- `renderCreateTable` is the single source for the statement: name/column
  validation (required, ≤63 chars, no NUL), unique column names, ≤100 columns,
  one PK clause quoted from the checked columns
- Column types are whitelisted by pattern (`text`, `numeric(10,2)`,
  `character varying(50)`, `text[]`); defaults are single expressions (≤200
  chars, no `;`)
- Postgres errors are returned verbatim (e.g. `relation "x" already exists
  (SQLSTATE 42P07)`)

Frontend (`DdlForms.jsx`, TanStack Form):
- Sidebar gains "New table" / "New schema"; schemas with no tables are listed
  ("No tables yet.")
- Schema form: name field with `onChange`/`onSubmit` validators and a quoted
  `create schema …;` preview; success refreshes the tree and jumps to the table
  builder with that schema preselected
- Table builder: schema select, table name, and a `columns` array field with
  `pushValue`/`removeValue`; each row has name, type (datalist), default,
  nullable and PK checkboxes
- Validators mirror the server (required names, type pattern, default
  expression, unique column names); the form-level error clears on the next
  change so stale server errors don't linger
- Preview re-renders from `form.Subscribe` state; on success the tree refreshes,
  the new table is selected, and its (empty) grid opens
- Content head gains DDL views alongside Data / SQL

Concepts: DDL vs DML, identifier quoting vs parameter binding, defaults as
expressions vs literals, array fields in TanStack Form, nil slices and JSON.

**Done when:** create a schema and a table, both appear in the sidebar and accept
rows through the grid.

## Stage 8 — Design pass

Goal: visual parity with the prototype on the core screens.

- `style.css` carries the prototype's token layer: `--surface-0/1/2`,
  `--text-primary/secondary/muted`, `--border`/`--border-strong`,
  `--fill-primary`/`--on-primary`, neutral fills, accent/warning/danger/success
  pairs, radii, control height, shadows, and the sans/mono stacks. Light is the
  base; a `prefers-color-scheme: dark` block overrides the 26 color tokens
  (geometry and fonts are shared), and `color-scheme: light dark` lets native
  controls follow
- `App.css` was rebuilt on those tokens: 30px controls, underline tabs,
  46px header with a connection status dot, 200px sidebar, 12px grid with a
  hairline header rule, and the warning-tinted pending-changes bar
- `Toast.jsx`: context plus `useToast`; bottom-right live region, auto-dismiss
  after 3.5s, click to dismiss. Commit and DDL success announce there; after a
  save focus returns to the filter box (the Save button disappears)
- States: spinner for tree/grid/run/save busy work, `.empty-state` blocks for
  empty and filtered tables plus empty SQL results, and a shared `.error-panel`
  for SQL and save failures
- Keyboard and a11y: Enter/Escape in cell editors, Ctrl+Enter to run, a global
  `:focus-visible` ring, `aria-sort` on sorted headers, `scope="col"`, table
  `aria-label`s, `aria-pressed` view toggles, `aria-current` on the selected
  table, and live regions for toasts and status text
- Primary buttons follow the prototype (neutral `fill-primary`, not blue);
  blue is reserved for selection and focus. DDL forms gained Cancel

**Done when:** side-by-side with the prototype, the core flows look and behave
the same in light and dark.

## Stage 9 — Package

- App icon and `wails.json` metadata (name, version, company)
- Production `wails build`; smoke-test the binary outside dev mode
- README: install prerequisites, `docker compose up -d`, `wails dev`, build steps
- Verify the app works against a fresh seed (`docker compose down -v && up -d`)

**Done when:** `build/bin/otter.exe` runs standalone and completes the Stage 1–7
flows against the dev database.

Implementation notes:
- Icon: otter-head mark drawn at 1024 px, bicubic downscales to 16–256 px.
  `build/windows/icon.ico` holds 7 PNG entries; `build/appicon.png` is the master.
- `wails.json` `info` block (company, product, version, copyright, comments) is
  templated by Wails into `build/windows/info.json`, packed into
  `otter-res.syso`, and linked into the exe. The string-table key is `0409`
  (en-US) — Wails' default `0000` (neutral) is read by Explorer but invisible to
  .NET's `FileVersionInfo`, which queries `040904B0` only.
- `wails build` produces `build/bin/otter.exe` (~17 MB). Standalone launch,
  window title (`Otter - Postgres Viewer`), and clean close verified.

## Stage 10 — Script runner

Goal: run a whole SQL script, statement by statement, with clear per-statement
outcomes and an optional all-or-nothing transaction.

- Splitter (`splitStatements`): splits only on top-level semicolons, respecting
  single-quoted strings (`''` and backslash escapes), double-quoted identifiers,
  line comments, nested block comments, and dollar-quoted bodies. Fragments that
  hold only whitespace or comments are dropped.
- `RunScript(script, inTransaction)`: runs statements in order and stops at the
  first failure. Transaction mode commits everything together or rolls back on
  failure; autocommit mode keeps earlier statements. Rows cap at 1,000 per
  statement, same as single-statement runs.
- Errors name the line and column inside the failing statement plus the SQLSTATE.
- UI: numbered result cards (rows grid, command summary, or error), a
  "One transaction" toggle (on by default), and a rolled-back banner.

**Done when:** a mixed script shows per-statement results, a failing statement
names its line, and transaction mode leaves no partial writes behind.

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
