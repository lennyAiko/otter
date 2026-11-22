package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	maxSQLRows       = 1000
	statementTimeout = 30 * time.Second
	rollbackTimeout  = 5 * time.Second
	beginTimeout     = 10 * time.Second
)

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

// ScriptStatement is one statement's outcome within a script.
type ScriptStatement struct {
	SQL        string   `json:"sql"`
	Columns    []string `json:"columns"`
	Rows       [][]any  `json:"rows"`
	RowCount   int      `json:"rowCount"`
	Affected   int64    `json:"affected"`
	DurationMs int64    `json:"durationMs"`
	Truncated  bool     `json:"truncated"`
	Notice     string   `json:"notice"`
	Error      string   `json:"error"`
}

// ScriptResult is every statement that ran, up to the first failure.
type ScriptResult struct {
	Statements    []ScriptStatement `json:"statements"`
	InTransaction bool              `json:"inTransaction"`
	RolledBack    bool              `json:"rolledBack"`
	DurationMs    int64             `json:"durationMs"`
	Error         string            `json:"error"`
}

type statementSource interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
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

	ctx, cancel := context.WithTimeout(ctx, statementTimeout)
	defer cancel()

	return runStatement(ctx, pool, sql)
}

// runScript executes each statement in order, stopping at the first failure.
// In transaction mode the whole script commits together or rolls back.
func (d *database) runScript(ctx context.Context, script string, inTransaction bool) (ScriptResult, error) {
	pool, err := d.active()
	if err != nil {
		return ScriptResult{}, err
	}

	statements := splitStatements(script)
	if len(statements) == 0 {
		return ScriptResult{}, fmt.Errorf("enter a SQL script")
	}

	started := time.Now()
	result := ScriptResult{
		Statements:    make([]ScriptStatement, 0, len(statements)),
		InTransaction: inTransaction,
	}

	var source statementSource = pool
	var tx pgx.Tx
	if inTransaction {
		beginCtx, cancel := context.WithTimeout(ctx, beginTimeout)
		tx, err = pool.Begin(beginCtx)
		cancel()
		if err != nil {
			return ScriptResult{}, err
		}
		source = tx
	}

	for _, statement := range statements {
		stmtCtx, cancel := context.WithTimeout(ctx, statementTimeout)
		res, err := runStatement(stmtCtx, source, statement)
		cancel()

		item := ScriptStatement{
			SQL:     statement,
			Columns: []string{},
			Rows:    [][]any{},
		}
		if err != nil {
			item.Error = formatStatementError(statement, err)
			result.Statements = append(result.Statements, item)
			if tx != nil {
				rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), rollbackTimeout)
				_ = tx.Rollback(rollbackCtx)
				rollbackCancel()
				result.RolledBack = true
			}
			result.DurationMs = time.Since(started).Milliseconds()
			return result, nil
		}

		item.Columns = res.Columns
		item.Rows = res.Rows
		item.RowCount = res.RowCount
		item.Affected = res.Affected
		item.DurationMs = res.DurationMs
		item.Truncated = res.Truncated
		item.Notice = res.Notice
		result.Statements = append(result.Statements, item)
	}

	if tx != nil {
		if err := tx.Commit(ctx); err != nil {
			result.RolledBack = true
			result.Error = "commit failed: " + err.Error()
		}
	}

	result.DurationMs = time.Since(started).Milliseconds()
	return result, nil
}

func runStatement(ctx context.Context, source statementSource, sql string) (SQLResult, error) {
	start := time.Now()
	rows, err := source.Query(ctx, sql, pgx.QueryResultFormats{pgx.TextFormatCode})
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

// splitStatements splits a script on top-level semicolons. It understands
// single-quoted strings, double-quoted identifiers, line and nested block
// comments, and dollar-quoted bodies. Fragments with no executable content
// (whitespace or comments only) are dropped.
func splitStatements(script string) []string {
	statements := []string{}
	start := 0
	meaningful := false
	i := 0
	n := len(script)
	for i < n {
		c := script[i]
		switch {
		case c == '-' && i+1 < n && script[i+1] == '-':
			end := strings.IndexByte(script[i:], '\n')
			if end < 0 {
				i = n
			} else {
				i += end + 1
			}
			if !meaningful {
				start = i
			}
		case c == '/' && i+1 < n && script[i+1] == '*':
			i = skipBlockComment(script, i)
			if !meaningful {
				start = i
			}
		case c == '\'':
			i = skipSingleQuoted(script, i)
			meaningful = true
		case c == '"':
			i = skipDoubleQuoted(script, i)
			meaningful = true
		case c == '$':
			if tag, ok := dollarQuoteTag(script, i); ok {
				if end := strings.Index(script[i+len(tag):], tag); end >= 0 {
					i += len(tag) + end + len(tag)
				} else {
					i = n
				}
			} else {
				i++
			}
			meaningful = true
		case c == ';':
			if meaningful {
				if fragment := strings.TrimSpace(script[start:i]); fragment != "" {
					statements = append(statements, fragment)
				}
			}
			i++
			start = i
			meaningful = false
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v':
			i++
		default:
			meaningful = true
			i++
		}
	}
	if meaningful {
		if fragment := strings.TrimSpace(script[start:]); fragment != "" {
			statements = append(statements, fragment)
		}
	}
	return statements
}

func skipSingleQuoted(s string, i int) int {
	n := len(s)
	i++
	for i < n {
		switch s[i] {
		case '\\':
			if i+1 < n {
				i += 2
			} else {
				i++
			}
		case '\'':
			if i+1 < n && s[i+1] == '\'' {
				i += 2
			} else {
				return i + 1
			}
		default:
			i++
		}
	}
	return n
}

func skipDoubleQuoted(s string, i int) int {
	n := len(s)
	i++
	for i < n {
		if s[i] != '"' {
			i++
			continue
		}
		if i+1 < n && s[i+1] == '"' {
			i += 2
			continue
		}
		return i + 1
	}
	return n
}

func skipBlockComment(s string, i int) int {
	n := len(s)
	depth := 1
	i += 2
	for i < n {
		if i+1 < n && s[i] == '/' && s[i+1] == '*' {
			depth++
			i += 2
		} else if i+1 < n && s[i] == '*' && s[i+1] == '/' {
			depth--
			i += 2
			if depth == 0 {
				return i
			}
		} else {
			i++
		}
	}
	return n
}

// dollarQuoteTag returns the opening tag (e.g. "$$" or "$body$") when s[i]
// starts one. A lone "$" (a parameter like $1, or an operator) does not match.
func dollarQuoteTag(s string, i int) (string, bool) {
	n := len(s)
	j := i + 1
	if j < n && s[j] == '$' {
		return "$$", true
	}
	if j < n && (s[j] == '_' || isASCIILetter(s[j])) {
		j++
		for j < n && (s[j] == '_' || isASCIILetter(s[j]) || (s[j] >= '0' && s[j] <= '9')) {
			j++
		}
		if j < n && s[j] == '$' {
			return s[i : j+1], true
		}
	}
	return "", false
}

func isASCIILetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// formatStatementError adds the position of a Postgres error within the
// statement and its SQLSTATE, which the server reports but pgx omits from
// Error().
func formatStatementError(statement string, err error) string {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err.Error()
	}
	if pgErr.Position > 0 {
		line, column := errorPosition(statement, int(pgErr.Position))
		return fmt.Sprintf("%s (line %d, column %d, SQLSTATE %s)", pgErr.Message, line, column, pgErr.Code)
	}
	return fmt.Sprintf("%s (SQLSTATE %s)", pgErr.Message, pgErr.Code)
}

func errorPosition(statement string, position int) (line, column int) {
	line, column = 1, 1
	seen := 0
	for _, r := range statement {
		if seen >= position-1 {
			break
		}
		if r == '\n' {
			line++
			column = 1
		} else {
			column++
		}
		seen++
	}
	return line, column
}
