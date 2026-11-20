package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ConnectConfig is what the frontend sends when connecting.
type ConnectConfig struct {
	Host     string `json:"host"`
	Port     string `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
	SSLMode  string `json:"sslMode"`
}

// ConnectionInfo is what the frontend gets back on success.
type ConnectionInfo struct {
	ServerVersion string   `json:"serverVersion"`
	Database      string   `json:"database"`
	User          string   `json:"user"`
	Schemas       []string `json:"schemas"`
}

// database owns the single active connection pool.
type database struct {
	mu   sync.Mutex
	pool *pgxpool.Pool
}

// connect opens a pool and makes it the active connection.
func (d *database) connect(ctx context.Context, cfg ConnectConfig) (ConnectionInfo, error) {
	pool, info, err := openPool(ctx, cfg)
	if err != nil {
		return ConnectionInfo{}, err
	}

	d.mu.Lock()
	previous := d.pool
	d.pool = pool
	d.mu.Unlock()
	if previous != nil {
		previous.Close()
	}

	return info, nil
}

// test opens a throwaway pool, reports server info, and closes it.
// The active connection is left untouched.
func (d *database) test(ctx context.Context, cfg ConnectConfig) (ConnectionInfo, error) {
	pool, info, err := openPool(ctx, cfg)
	if pool != nil {
		pool.Close()
	}
	return info, err
}

func openPool(ctx context.Context, cfg ConnectConfig) (*pgxpool.Pool, ConnectionInfo, error) {
	cfg = cfg.withDefaults()
	if err := cfg.validate(); err != nil {
		return nil, ConnectionInfo{}, err
	}

	poolCfg, err := pgxpool.ParseConfig(cfg.dsn())
	if err != nil {
		return nil, ConnectionInfo{}, fmt.Errorf("invalid connection settings: %w", err)
	}
	poolCfg.MaxConns = 4
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	poolCfg.ConnConfig.ConnectTimeout = 5 * time.Second

	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, ConnectionInfo{}, friendlyError(err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, ConnectionInfo{}, friendlyError(err)
	}

	info := ConnectionInfo{Database: cfg.Database, User: cfg.User}
	if err := pool.QueryRow(ctx, "select current_setting('server_version')").Scan(&info.ServerVersion); err != nil {
		pool.Close()
		return nil, ConnectionInfo{}, fmt.Errorf("connected, but reading the server version failed: %w", err)
	}
	rows, err := pool.Query(ctx, `
		select nspname
		from pg_namespace
		where nspname not in ('pg_catalog', 'information_schema')
		  and nspname not like 'pg\_%'
		order by nspname`)
	if err != nil {
		pool.Close()
		return nil, ConnectionInfo{}, fmt.Errorf("connected, but listing schemas failed: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			pool.Close()
			return nil, ConnectionInfo{}, err
		}
		info.Schemas = append(info.Schemas, name)
	}
	if err := rows.Err(); err != nil {
		pool.Close()
		return nil, ConnectionInfo{}, err
	}

	return pool, info, nil
}

// active returns the current pool or an error when not connected.
func (d *database) active() (*pgxpool.Pool, error) {
	d.mu.Lock()
	pool := d.pool
	d.mu.Unlock()
	if pool == nil {
		return nil, errors.New("not connected")
	}
	return pool, nil
}

// close shuts the pool down; safe to call with no connection.
func (d *database) close() {
	d.mu.Lock()
	pool := d.pool
	d.pool = nil
	d.mu.Unlock()
	if pool != nil {
		pool.Close()
	}
}

func (c ConnectConfig) withDefaults() ConnectConfig {
	if c.Port == "" {
		c.Port = "5432"
	}
	if c.SSLMode == "" {
		c.SSLMode = "disable"
	}
	return c
}

func (c ConnectConfig) validate() error {
	var missing []string
	if strings.TrimSpace(c.Host) == "" {
		missing = append(missing, "host")
	}
	if strings.TrimSpace(c.Database) == "" {
		missing = append(missing, "database")
	}
	if strings.TrimSpace(c.User) == "" {
		missing = append(missing, "user")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing %s", strings.Join(missing, ", "))
	}
	if _, err := net.LookupPort("tcp", c.Port); err != nil {
		return fmt.Errorf("invalid port %q", c.Port)
	}
	return nil
}

// dsn builds a postgres:// URL so user names and passwords with
// special characters are escaped correctly.
func (c ConnectConfig) dsn() string {
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(c.User, c.Password),
		Host:   net.JoinHostPort(c.Host, c.Port),
		Path:   "/" + c.Database,
	}
	q := u.Query()
	q.Set("sslmode", c.SSLMode)
	u.RawQuery = q.Encode()
	return u.String()
}

func friendlyError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("connection timed out — is Postgres running and reachable?")
	}
	return fmt.Errorf("could not connect: %w", err)
}
