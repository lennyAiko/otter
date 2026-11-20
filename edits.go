package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxEdits = 500

type KeyValue struct {
	Column string `json:"column"`
	Value  string `json:"value"`
}

type Edit struct {
	Schema string     `json:"schema"`
	Table  string     `json:"table"`
	Column string     `json:"column"`
	Keys   []KeyValue `json:"keys"`
	Value  *string    `json:"value"`
}

type CommitResult struct {
	Updated int `json:"updated"`
}

type columnInfo struct {
	Type       string
	PrimaryKey bool
}

type tableMeta struct {
	qualified string
	columns   map[string]columnInfo
	pk        string
	pkCount   int
}

type preparedEdit struct {
	sql     string
	args    []any
	display string
}

func loadTableMeta(ctx context.Context, pool *pgxpool.Pool, schema, table string) (tableMeta, error) {
	rows, err := pool.Query(ctx, `
		select
			a.attname,
			format_type(a.atttypid, a.atttypmod),
			exists (
				select 1
				from pg_index i
				where i.indrelid = c.oid
				  and i.indisprimary
				  and a.attnum = any (i.indkey)
			)
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		join pg_attribute a on a.attrelid = c.oid
		where n.nspname = $1
		  and c.relname = $2
		  and c.relkind in ('r', 'p')
		  and a.attnum > 0
		  and not a.attisdropped
		order by a.attnum`, schema, table)
	if err != nil {
		return tableMeta{}, err
	}
	defer rows.Close()

	meta := tableMeta{
		qualified: pgx.Identifier{schema}.Sanitize() + "." + pgx.Identifier{table}.Sanitize(),
		columns:   map[string]columnInfo{},
	}
	for rows.Next() {
		var name, typ string
		var primaryKey bool
		if err := rows.Scan(&name, &typ, &primaryKey); err != nil {
			return tableMeta{}, err
		}
		meta.columns[name] = columnInfo{Type: typ, PrimaryKey: primaryKey}
		if primaryKey {
			meta.pk = name
			meta.pkCount++
		}
	}
	if err := rows.Err(); err != nil {
		return tableMeta{}, err
	}
	if len(meta.columns) == 0 {
		return tableMeta{}, fmt.Errorf("table %s.%s not found", schema, table)
	}
	return meta, nil
}

// prepareEdits validates edits against the catalog and builds parameterized
// statements. Each edit touches one non-PK column of one row identified by its
// single-column primary key.
func (d *database) prepareEdits(ctx context.Context, edits []Edit) ([]preparedEdit, error) {
	pool, err := d.active()
	if err != nil {
		return nil, err
	}
	if len(edits) == 0 {
		return nil, fmt.Errorf("no edits to apply")
	}
	if len(edits) > maxEdits {
		return nil, fmt.Errorf("too many edits at once (limit %d)", maxEdits)
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	metas := map[string]tableMeta{}
	prepared := make([]preparedEdit, 0, len(edits))
	for i, edit := range edits {
		edit.Schema = strings.TrimSpace(edit.Schema)
		edit.Table = strings.TrimSpace(edit.Table)
		edit.Column = strings.TrimSpace(edit.Column)
		if edit.Schema == "" || edit.Table == "" || edit.Column == "" {
			return nil, fmt.Errorf("edit %d: schema, table and column are required", i+1)
		}

		key := edit.Schema + "\x00" + edit.Table
		meta, ok := metas[key]
		if !ok {
			meta, err = loadTableMeta(ctx, pool, edit.Schema, edit.Table)
			if err != nil {
				return nil, err
			}
			metas[key] = meta
		}

		column, ok := meta.columns[edit.Column]
		if !ok {
			return nil, fmt.Errorf("edit %d: %s.%s has no column %q", i+1, edit.Schema, edit.Table, edit.Column)
		}
		if column.PrimaryKey {
			return nil, fmt.Errorf("edit %d: primary key columns are not editable (%s)", i+1, edit.Column)
		}
		switch {
		case meta.pkCount == 0:
			return nil, fmt.Errorf("edit %d: %s.%s has no primary key, so rows cannot be updated safely", i+1, edit.Schema, edit.Table)
		case meta.pkCount > 1:
			return nil, fmt.Errorf("edit %d: %s.%s has a composite primary key, which is read-only for now", i+1, edit.Schema, edit.Table)
		}

		pkValue, found := "", false
		for _, kv := range edit.Keys {
			if kv.Column == meta.pk {
				pkValue = kv.Value
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("edit %d: missing primary key value for %s", i+1, meta.pk)
		}

		columnIdent := pgx.Identifier{edit.Column}.Sanitize()
		pkIdent := pgx.Identifier{meta.pk}.Sanitize()
		pkType := meta.columns[meta.pk].Type

		prepared = append(prepared, preparedEdit{
			sql: "update " + meta.qualified +
				" set " + columnIdent + " = $1::text::" + column.Type +
				" where " + pkIdent + " = $2::text::" + pkType,
			args: []any{edit.Value, pkValue},
			display: "update " + meta.qualified +
				"\n   set " + columnIdent + " = " + displayLiteral(edit.Value, column.Type) +
				"\n where " + pkIdent + " = " + displayLiteral(&pkValue, pkType) + ";",
		})
	}
	return prepared, nil
}

// previewUpdates returns the SQL the commit would run, with literals rendered
// for review.
func (d *database) previewUpdates(ctx context.Context, edits []Edit) (string, error) {
	prepared, err := d.prepareEdits(ctx, edits)
	if err != nil {
		return "", err
	}
	statements := make([]string, len(prepared))
	for i, statement := range prepared {
		statements[i] = statement.display
	}
	return strings.Join(statements, "\n\n"), nil
}

// commitEdits applies every edit in one transaction; any failure rolls the
// whole batch back.
func (d *database) commitEdits(ctx context.Context, edits []Edit) (CommitResult, error) {
	pool, err := d.active()
	if err != nil {
		return CommitResult{}, err
	}
	prepared, err := d.prepareEdits(ctx, edits)
	if err != nil {
		return CommitResult{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return CommitResult{}, err
	}
	defer tx.Rollback(ctx)

	for i, statement := range prepared {
		tag, err := tx.Exec(ctx, statement.sql, statement.args...)
		if err != nil {
			return CommitResult{}, fmt.Errorf("edit %d failed: %w", i+1, err)
		}
		if tag.RowsAffected() != 1 {
			return CommitResult{}, fmt.Errorf(
				"edit %d failed: expected to update 1 row, updated %d (did the row disappear or was it already changed?)",
				i+1, tag.RowsAffected())
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return CommitResult{}, err
	}
	return CommitResult{Updated: len(prepared)}, nil
}

func displayLiteral(value *string, typ string) string {
	if value == nil {
		return "NULL"
	}
	return "'" + strings.ReplaceAll(*value, "'", "''") + "'::" + typ
}
