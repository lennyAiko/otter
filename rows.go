package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultPageSize = 8
	maxPageSize     = 200
	maxFilterLength = 200
)

type TableRequest struct {
	Schema     string `json:"schema"`
	Table      string `json:"table"`
	Filter     string `json:"filter"`
	SortColumn string `json:"sortColumn"`
	SortDesc   bool   `json:"sortDesc"`
	Page       int    `json:"page"`
	PageSize   int    `json:"pageSize"`
}

type TableRows struct {
	Columns   []string `json:"columns"`
	Rows      [][]any  `json:"rows"`
	Total     int      `json:"total"`
	Page      int      `json:"page"`
	PageSize  int      `json:"pageSize"`
	PageCount int      `json:"pageCount"`
}

type rowColumn struct {
	name       string
	primaryKey bool
}

// queryRows pages through one table. Identifiers come from the catalog and are
// quoted; the filter is a parameter. Values are cast to text for display, so a
// NULL cell stays distinguishable from the string "NULL".
func (d *database) queryRows(ctx context.Context, req TableRequest) (TableRows, error) {
	pool, err := d.active()
	if err != nil {
		return TableRows{}, err
	}

	req.Schema = strings.TrimSpace(req.Schema)
	req.Table = strings.TrimSpace(req.Table)
	if req.Schema == "" || req.Table == "" {
		return TableRows{}, fmt.Errorf("schema and table are required")
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	columns, err := loadRowColumns(ctx, pool, req.Schema, req.Table)
	if err != nil {
		return TableRows{}, err
	}
	if len(columns) == 0 {
		return TableRows{}, fmt.Errorf("table %s.%s not found", req.Schema, req.Table)
	}

	quoted := make(map[string]string, len(columns))
	selected := make([]string, len(columns))
	allColumns := make([]string, len(columns))
	primaryKeys := make([]string, 0, 2)
	for i, column := range columns {
		ident := pgx.Identifier{column.name}.Sanitize()
		quoted[column.name] = ident
		selected[i] = ident + "::text"
		allColumns[i] = ident
		if column.primaryKey {
			primaryKeys = append(primaryKeys, column.name)
		}
	}

	qualified := pgx.Identifier{req.Schema}.Sanitize() + "." + pgx.Identifier{req.Table}.Sanitize()

	filter := strings.TrimSpace(req.Filter)
	if runes := []rune(filter); len(runes) > maxFilterLength {
		filter = string(runes[:maxFilterLength])
	}

	where := ""
	args := []any{}
	if filter != "" {
		conditions := make([]string, len(allColumns))
		for i, column := range allColumns {
			conditions[i] = column + "::text ilike $1"
		}
		where = " where (" + strings.Join(conditions, " or ") + ")"
		args = append(args, "%"+escapeLike(filter)+"%")
	}

	var total int
	countSQL := "select count(*) from " + qualified + where
	if err := pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return TableRows{}, err
	}

	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	pageCount := 0
	page := req.Page
	if total > 0 {
		pageCount = (total + pageSize - 1) / pageSize
		if page < 1 {
			page = 1
		}
		if page > pageCount {
			page = pageCount
		}
	} else {
		page = 1
	}

	sortColumn := ""
	if req.SortColumn != "" {
		if _, ok := quoted[req.SortColumn]; !ok {
			return TableRows{}, fmt.Errorf("unknown sort column %q", req.SortColumn)
		}
		sortColumn = req.SortColumn
	}

	order := make([]string, 0, len(primaryKeys)+1)
	if sortColumn != "" {
		direction := " asc"
		if req.SortDesc {
			direction = " desc"
		}
		order = append(order, quoted[sortColumn]+direction)
	}
	for _, pk := range primaryKeys {
		if pk == sortColumn {
			continue
		}
		order = append(order, quoted[pk]+" asc")
	}
	if len(order) == 0 {
		order = append(order, allColumns[0]+" asc")
	}

	offset := (page - 1) * pageSize
	dataSQL := "select " + strings.Join(selected, ", ") +
		" from " + qualified + where +
		" order by " + strings.Join(order, ", ") +
		fmt.Sprintf(" limit %d offset %d", pageSize, offset)
	rows, err := pool.Query(ctx, dataSQL, args...)
	if err != nil {
		return TableRows{}, err
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	names := make([]string, len(fields))
	for i, field := range fields {
		names[i] = field.Name
	}

	data := make([][]any, 0, pageSize)
	scans := make([]pgtype.Text, len(fields))
	targets := make([]any, len(fields))
	for i := range scans {
		targets[i] = &scans[i]
	}
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return TableRows{}, err
		}
		values := make([]any, len(fields))
		for i, cell := range scans {
			if cell.Valid {
				values[i] = cell.String
			}
		}
		data = append(data, values)
	}
	if err := rows.Err(); err != nil {
		return TableRows{}, err
	}

	return TableRows{
		Columns:   names,
		Rows:      data,
		Total:     total,
		Page:      page,
		PageSize:  pageSize,
		PageCount: pageCount,
	}, nil
}

func loadRowColumns(ctx context.Context, pool *pgxpool.Pool, schema, table string) ([]rowColumn, error) {
	rows, err := pool.Query(ctx, `
		select
			a.attname,
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
		return nil, err
	}
	defer rows.Close()

	var columns []rowColumn
	for rows.Next() {
		var column rowColumn
		var primaryKey bool
		if err := rows.Scan(&column.name, &primaryKey); err != nil {
			return nil, err
		}
		column.primaryKey = primaryKey
		columns = append(columns, column)
	}
	return columns, rows.Err()
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func escapeLike(s string) string {
	return likeEscaper.Replace(s)
}
