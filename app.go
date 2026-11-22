package main

import "context"

// App is the struct Wails binds to the frontend.
// Every exported method becomes a JS function under wailsjs/go/main/App.
type App struct {
	ctx   context.Context
	db    *database
	conns *connectionStore
}

func NewApp() *App {
	return &App{db: &database{}, conns: newConnectionStore()}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(ctx context.Context) {
	a.db.close()
}

// Connect opens a pooled connection and reports basic server info.
func (a *App) Connect(cfg ConnectConfig) (ConnectionInfo, error) {
	return a.db.connect(a.ctx, cfg)
}

// TestConnection opens a throwaway pool, reports server info, and closes it.
// The active connection is left untouched.
func (a *App) TestConnection(cfg ConnectConfig) (ConnectionInfo, error) {
	return a.db.test(a.ctx, cfg)
}

// Disconnect closes the active pool, if any.
func (a *App) Disconnect() {
	a.db.close()
}

// ListConnections returns saved profiles (never passwords).
func (a *App) ListConnections() ([]ConnectionProfile, error) {
	return a.conns.list()
}

// SaveConnection upserts a profile and returns it with its assigned ID.
func (a *App) SaveConnection(profile ConnectionProfile) (ConnectionProfile, error) {
	return a.conns.save(profile)
}

// DeleteConnection removes a saved profile by ID.
func (a *App) DeleteConnection(id string) error {
	return a.conns.remove(id)
}

// ParseConnectionURL converts a postgresql:// URL into connection fields.
func (a *App) ParseConnectionURL(raw string) (ConnectConfig, error) {
	return parseConnectionURL(raw)
}

// ListSchemaTree returns schemas, tables, and column metadata for the
// active connection.
func (a *App) ListSchemaTree() ([]SchemaNode, error) {
	return a.db.schemaTree(a.ctx)
}

// QueryRows returns one page of a table's rows with optional filter and sort.
func (a *App) QueryRows(req TableRequest) (TableRows, error) {
	return a.db.queryRows(a.ctx, req)
}

// PreviewUpdates returns the SQL that CommitEdits would run.
func (a *App) PreviewUpdates(edits []Edit) (string, error) {
	return a.db.previewUpdates(a.ctx, edits)
}

// CommitEdits applies all edits in a single transaction.
func (a *App) CommitEdits(edits []Edit) (CommitResult, error) {
	return a.db.commitEdits(a.ctx, edits)
}

// RunQuery executes one SQL statement and returns its rows or command tag.
func (a *App) RunQuery(sql string) (SQLResult, error) {
	return a.db.runQuery(a.ctx, sql)
}

// CreateSchema creates a schema with a quoted identifier.
func (a *App) CreateSchema(name string) error {
	return a.db.createSchema(a.ctx, name)
}

// CreateTable validates a table definition and runs the generated DDL.
func (a *App) CreateTable(def TableDef) error {
	return a.db.createTable(a.ctx, def)
}
