package main

import (
	"reflect"
	"testing"
)

func TestSplitStatements(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  []string
	}{
		{"empty", "", []string{}},
		{"whitespace and semicolons only", " \n\t;\n;;", []string{}},
		{"single statement", "select 1", []string{"select 1"}},
		{"trailing semicolon", "select 1;", []string{"select 1"}},
		{"two statements", "select 1; select 2;", []string{"select 1", "select 2"}},
		{"empty fragments dropped", ";;select 1;;", []string{"select 1"}},
		{"semicolon in string", "select 'a;b' as x;", []string{"select 'a;b' as x"}},
		{"doubled quote", "select 'it''s; fine'; select 2", []string{"select 'it''s; fine'", "select 2"}},
		{"backslash escape", `select E'a\';b'; select 2`, []string{`select E'a\';b'`, "select 2"}},
		{"quoted identifier", `select 1 as "a;b"; select 2`, []string{`select 1 as "a;b"`, "select 2"}},
		{"doubled identifier quote", `select "a""b;c"; select 2`, []string{`select "a""b;c"`, "select 2"}},
		{"line comment", "select 1; -- two; select 2\nselect 3", []string{"select 1", "select 3"}},
		{"block comment", "select 1 /* ; */; select 2", []string{"select 1 /* ; */", "select 2"}},
		{"nested block comment", "select 1 /* a /* ; */ b */; select 2", []string{"select 1 /* a /* ; */ b */", "select 2"}},
		{
			"dollar quoted body",
			"create function f() returns int language sql as $$ select 1; select 2; $$; select 3;",
			[]string{"create function f() returns int language sql as $$ select 1; select 2; $$", "select 3"},
		},
		{
			"tagged dollar quote",
			"do $body$ begin perform 1; end $body$; select 2",
			[]string{"do $body$ begin perform 1; end $body$", "select 2"},
		},
		{"positional parameter", "select $1::text; select 2", []string{"select $1::text", "select 2"}},
		{"comment only", "-- hi\n/* there */", []string{}},
		{"unterminated string keeps fragment", "select 'abc", []string{"select 'abc"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := splitStatements(tc.input)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("splitStatements(%q) = %#v, want %#v", tc.input, got, tc.want)
			}
		})
	}
}

func TestErrorPosition(t *testing.T) {
	statement := "ab\ncd"
	cases := []struct {
		position     int
		line, column int
	}{
		{1, 1, 1},
		{3, 1, 3},
		{4, 2, 1},
		{5, 2, 2},
		{99, 2, 3},
	}
	for _, tc := range cases {
		line, column := errorPosition(statement, tc.position)
		if line != tc.line || column != tc.column {
			t.Fatalf("errorPosition(%q, %d) = (%d, %d), want (%d, %d)",
				statement, tc.position, line, column, tc.line, tc.column)
		}
	}
}
