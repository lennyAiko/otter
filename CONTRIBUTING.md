# Contributing to Otter

Thanks for taking a look. Otter is a small desktop PostgreSQL viewer built with
Wails v2, React 19, and pgx v5. Bug reports, fixes, and focused features are
welcome.

If you plan to change behavior, open an issue first so the approach can be
discussed before you spend time on it.

## Set up

Follow [README.md](README.md) for tool versions. In short:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1
docker compose up -d
wails dev
```

Connect to `localhost:5432`, database `shop_dev`, user `postgres`, password
`postgres`. The password is entered per session and never written to disk.
`wails dev` also serves the UI at <http://localhost:34115>.

The seed in `dev/seed.sql` only runs when the Docker volume is created. To
start over (this deletes all local data):

```sh
docker compose down -v && docker compose up -d
```

## How the project is organized

`otter.md` is the plan and stage log: it lists the stages, the agreed rules, and
what each stage had to prove. Read it before starting work, and update it when a
stage lands.

The Go package at the repository root is the Wails-bound backend. React code
lives in `frontend/src`. The generated bindings in `frontend/wailsjs` are written
by `wails dev` / `wails build` — don't edit them by hand.

## Code guidelines

### Backend (Go)

- Run `gofmt`; keep functions small and files focused (`rows.go`, `edits.go`,
  `sqlrunner.go`, …).
- Identifiers are never interpolated raw: check the name against catalog
  metadata, then quote it with `pgx.Identifier{...}.Sanitize()`.
- Values are always query parameters (`$1`…), never string-concatenated.
- Sort and filter columns are validated against table metadata, not trusted from
  the frontend.
- Multi-cell saves run in one transaction; a failure rolls back the whole batch.
- Passwords are never logged and never written to disk.
- Result sets are capped (1,000 rows) and the UI says when output was truncated.
- If you touch `splitStatements`, add table cases to `sqlrunner_test.go`
  (quotes, comments, dollar bodies, parameters).

### Frontend (React)

- Forms use TanStack Form; grids use TanStack Table v9; CodeMirror 6 appears only
  in `SqlEditor.jsx`.
- Style with the design tokens in `style.css` (`--surface-*`, `--text-*`,
  `--accent*`, `--danger`, …). No hard-coded colors; check both light and dark
  mode.
- Keep interactive elements real `<button>`s and keep the aria patterns already
  in place (`aria-sort`, `aria-pressed`, `aria-current`, `role="status"`,
  `aria-live`, `:focus-visible`, reduced-motion support).
- Call the backend through `frontend/wailsjs/go/main/App`; don't mock around it.

## Checks before opening a pull request

```sh
go test ./...
go build ./...
cd frontend && npm run build
```

Then smoke-test in `wails dev`: connect, filter and sort a table, edit a cell and
save, run a multi-statement script with the transaction toggle on and off, and
create a schema or table. Say in the PR what you verified and what you could not.

## Commits and pull requests

- Keep commits focused and use an imperative subject line ("Fix NULL display in
  result grid"), with the *why* in the body.
- One feature or fix per pull request; link the issue it addresses.
- Update `otter.md` when you complete or change a stage.
- Don't commit `build/bin`, generated installers, saved connection profiles, or
  anything containing credentials.

## Reporting bugs

Include the operating system, the app version (Explorer → Properties → Details on
Windows), steps to reproduce, the expected and actual result, and any console or
backend error text. Redact passwords and real data before pasting logs.

## License

Otter is released under the [MIT License](LICENSE). By contributing you agree
that your changes are licensed under the same terms.
