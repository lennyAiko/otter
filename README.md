# Otter

A small desktop PostgreSQL viewer: saved connections, a schema browser, a paged
data grid with staged inline edits and SQL review, a SQL runner with history, and
schema/table builders. Built with Wails v2, React 19, and pgx v5.

## Requirements

| Tool | Version |
|---|---|
| Go | 1.26+ |
| Node.js | 20+ (with npm) |
| Wails CLI | 2.17.1 |
| Docker Desktop | any recent version (for the dev database) |
| WebView2 Runtime | preinstalled on Windows 10/11 |

Install the Wails CLI:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1
wails doctor   # verify the toolchain
```

## Run it

Start the dev database, then the app:

```sh
docker compose up -d
wails dev
```

Connect with `localhost:5432`, database `shop_dev`, user `postgres`, password
`postgres`. The password is asked at connect time and never written to disk;
saved profiles (without passwords) live in the OS config directory under
`otter/connections.json`.

`wails dev` also serves the UI with Go bindings at <http://localhost:34115> for
browser-based development.

## Build a release

```sh
wails build
```

The result is `build/bin/otter.exe` on Windows. The frontend is compiled into the
binary, so no Node.js is needed at runtime. Window title, version, company, and
the application icon come from `wails.json` and `build/`.

## Database

The seed in `dev/seed.sql` runs only when the Docker volume is created:

- `public.users` (12 rows), `public.orders` (10, foreign key to users)
- `public.audit_log` (4, **no primary key** — exercises the read-only grid)
- `billing.invoices` (4, foreign key to orders)

To start over from the seed (this **deletes all local changes** in the dev
database):

```sh
docker compose down -v && docker compose up -d
```

## Safety model

- Identifiers are quoted through `pgx.Identifier`; values are always query
  parameters, never interpolated
- Sort and filter columns are validated against the catalog
- Tables without a primary key (or with a composite key) are read-only
- Multi-cell saves run in one transaction; one failed update rolls back the batch
- SQL results are capped at 1,000 rows and say so when truncated

## Layout

```
main.go              window options and asset embedding
app.go               Wails-bound API (Connect, QueryRows, CommitEdits, …)
db.go                pool lifecycle and DSN building
schema.go            catalog query for the sidebar tree
rows.go              paged row reads (filter, sort, PK tie-breaker)
edits.go             edit validation, SQL preview, transactional commit
sqlrunner.go         one-statement runner with text-format results
ddl.go               schema/table DDL validation and execution
connections.go       saved profiles (no passwords)
frontend/src         React UI; TanStack Form/Table and CodeMirror 6
otter.md             build plan and stage notes
```

Compile checks:

```sh
go build ./...
cd frontend && npm run build
```
