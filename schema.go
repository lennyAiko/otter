package main

import (
	"context"
	"time"
)

type ColumnNode struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primaryKey"`
}

type TableNode struct {
	Name    string       `json:"name"`
	Columns []ColumnNode `json:"columns"`
}

type SchemaNode struct {
	Name   string      `json:"name"`
	Tables []TableNode `json:"tables"`
}

// schemaTree lists tables and their columns from the catalog.
// Views and foreign tables are intentionally excluded for now.
func (d *database) schemaTree(ctx context.Context) ([]SchemaNode, error) {
	pool, err := d.active()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := pool.Query(ctx, `
		select
			n.nspname,
			c.relname,
			a.attname,
			format_type(a.atttypid, a.atttypmod),
			not a.attnotnull,
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
		where c.relkind in ('r', 'p')
		  and a.attnum > 0
		  and not a.attisdropped
		  and n.nspname not in ('pg_catalog', 'information_schema')
		  and n.nspname not like 'pg\_%'
		order by n.nspname, c.relname, a.attnum`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tree := []SchemaNode{}
	lastSchema, lastTable := "", ""
	for rows.Next() {
		var schema, table, column, typ string
		var nullable, primaryKey bool
		if err := rows.Scan(&schema, &table, &column, &typ, &nullable, &primaryKey); err != nil {
			return nil, err
		}
		if schema != lastSchema {
			tree = append(tree, SchemaNode{Name: schema})
			lastSchema, lastTable = schema, ""
		}
		s := &tree[len(tree)-1]
		if table != lastTable {
			s.Tables = append(s.Tables, TableNode{Name: table})
			lastTable = table
		}
		t := &s.Tables[len(s.Tables)-1]
		t.Columns = append(t.Columns, ColumnNode{
			Name:       column,
			Type:       typ,
			Nullable:   nullable,
			PrimaryKey: primaryKey,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return tree, nil
}
