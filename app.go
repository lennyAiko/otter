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
