package main

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

const (
	maxIdentifierLength = 63
	maxColumns          = 100
	maxDefaultLength    = 200
)

// sqlTypePattern accepts base types plus optional precision/length and array
// suffixes: text, numeric(10,2), character varying(50), timestamptz, text[].
var sqlTypePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_ ]*(\(\s*\d+(\s*,\s*\d+)?\s*\))?(\[\])?$`)

// ColumnDef is one column in a table builder submission.
type ColumnDef struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Default    string `json:"default"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primaryKey"`
}

// TableDef is a table builder submission.
type TableDef struct {
	Schema  string      `json:"schema"`
	Name    string      `json:"name"`
	Columns []ColumnDef `json:"columns"`
}

// quoteIdent renders a Postgres identifier, escaping embedded quotes. This is
// the only protection DDL has — there are no parameters to bind.
func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func validateName(kind, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("%s name is required", kind)
	}
	if len(name) > maxIdentifierLength {
		return "", fmt.Errorf("%s name is longer than %d characters", kind, maxIdentifierLength)
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("%s name contains a null byte", kind)
	}
	return name, nil
}

func validateColumn(column ColumnDef) (ColumnDef, error) {
	name, err := validateName("column", column.Name)
	if err != nil {
		return ColumnDef{}, err
	}
	column.Name = name

	column.Type = strings.TrimSpace(column.Type)
	if column.Type == "" {
		return ColumnDef{}, fmt.Errorf("column %q needs a type", name)
	}
	if !sqlTypePattern.MatchString(column.Type) {
		return ColumnDef{}, fmt.Errorf("column %q has an unsupported type %q (try numeric(10,2), varchar(50), timestamptz)", name, column.Type)
	}

	column.Default = strings.TrimSpace(column.Default)
	if len(column.Default) > maxDefaultLength {
		return ColumnDef{}, fmt.Errorf("column %q has a default longer than %d characters", name, maxDefaultLength)
	}
	if strings.Contains(column.Default, ";") {
		return ColumnDef{}, fmt.Errorf("column %q default must be a single expression", name)
	}
	return column, nil
}

// renderCreateTable builds the DDL. Execution and preview both come from here,
// so what the form shows is exactly what runs.
func renderCreateTable(def TableDef) (string, error) {
	schema, err := validateName("schema", def.Schema)
	if err != nil {
		return "", err
	}
	table, err := validateName("table", def.Name)
	if err != nil {
		return "", err
	}
	if len(def.Columns) == 0 {
		return "", fmt.Errorf("add at least one column")
	}
	if len(def.Columns) > maxColumns {
		return "", fmt.Errorf("at most %d columns", maxColumns)
	}

	seen := map[string]bool{}
	parts := make([]string, 0, len(def.Columns)+1)
	primary := make([]string, 0, 2)
	for i, column := range def.Columns {
		column, err = validateColumn(column)
		if err != nil {
			return "", fmt.Errorf("column %d: %w", i+1, err)
		}
		if seen[column.Name] {
			return "", fmt.Errorf("duplicate column name %q", column.Name)
		}
		seen[column.Name] = true

		part := quoteIdent(column.Name) + " " + column.Type
		if column.Default != "" {
			part += " default " + column.Default
		}
		if !column.Nullable {
			part += " not null"
		}
		parts = append(parts, part)
		if column.PrimaryKey {
			primary = append(primary, quoteIdent(column.Name))
		}
	}
	if len(primary) > 0 {
		parts = append(parts, "primary key ("+strings.Join(primary, ", ")+")")
	}

	return fmt.Sprintf("create table %s.%s (\n  %s\n)",
		quoteIdent(schema), quoteIdent(table), strings.Join(parts, ",\n  ")), nil
}

// createSchema runs a quoted CREATE SCHEMA.
func (d *database) createSchema(ctx context.Context, name string) error {
	pool, err := d.active()
	if err != nil {
		return err
	}
	name, err = validateName("schema", name)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, "create schema "+quoteIdent(name))
	return err
}

// createTable validates the definition and runs the generated DDL.
func (d *database) createTable(ctx context.Context, def TableDef) error {
	pool, err := d.active()
	if err != nil {
		return err
	}
	ddl, err := renderCreateTable(def)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, ddl)
	return err
}
