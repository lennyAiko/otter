package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const maxSQLRows = 1000

// SQLResult is one executed statement. Columns is empty for commands.
type SQLResult struct {
	Columns    []string `json:"columns"`
	Rows       [][]any  `json:"rows"`
	RowCount   int      `json:"rowCount"`
	Affected   int64    `json:"affected"`
	DurationMs int64    `json:"durationMs"`
	Truncated  bool     `json:"truncated"`
	Notice     string   `json:"notice"`
}

// runQuery executes one statement and renders every value in Postgres' own
// text format, so numerics, timestamps, arrays, etc. display as psql shows
// them and NULL stays nil.
func (d *database) runQuery(ctx context.Context, sql string) (SQLResult, error) {
	pool, err := d.active()
	if err != nil {
		return SQLResult{}, err
	}

	sql = strings.TrimSpace(sql)
	if sql == "" {
		return SQLResult{}, fmt.Errorf("enter a SQL statement")
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	start := time.Now()
	rows, err := pool.Query(ctx, sql, pgx.QueryResultFormats{pgx.TextFormatCode})
	if err != nil {
		return SQLResult{}, err
	}
	defer rows.Close()

	result := SQLResult{Columns: []string{}, Rows: [][]any{}}
	fields := rows.FieldDescriptions()
	if len(fields) > 0 {
		for _, field := range fields {
			result.Columns = append(result.Columns, field.Name)
		}
		for rows.Next() {
			if len(result.Rows) == maxSQLRows {
				result.Truncated = true
				break
			}
			raw := rows.RawValues()
			row := make([]any, len(raw))
			for i, value := range raw {
				if value != nil {
					row[i] = string(value)
				}
			}
			result.Rows = append(result.Rows, row)
		}
		result.RowCount = len(result.Rows)
	} else {
		for rows.Next() {
		}
	}
	if err := rows.Err(); err != nil {
		return SQLResult{}, err
	}

	result.Affected = rows.CommandTag().RowsAffected()
	result.DurationMs = time.Since(start).Milliseconds()
	if result.Truncated {
		result.Notice = fmt.Sprintf("Showing the first %d rows; narrow the query for the rest.", maxSQLRows)
	}
	return result, nil
}
