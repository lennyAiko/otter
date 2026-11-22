import {useEffect, useMemo, useState} from 'react'
import {ListSchemaTree} from '../wailsjs/go/main/App'
import DataGrid from './DataGrid'
import SqlEditor from './SqlEditor'
import {SchemaForm, TableForm} from './DdlForms'
import {useToast} from './Toast'

export default function Workspace({info, onBack}) {
    const notify = useToast()
    const [tree, setTree] = useState(null)
    const [error, setError] = useState('')
    const [filter, setFilter] = useState('')
    const [selected, setSelected] = useState(null)
    const [view, setView] = useState('data')
    const [sqlText, setSqlText] = useState('')
    const [sqlHistory, setSqlHistory] = useState([])
    const [restoreSeq, setRestoreSeq] = useState(0)
    const [ddlSchema, setDdlSchema] = useState('public')

    useEffect(() => {
        load()
    }, [])

    async function load() {
        setError('')
        try {
            setTree(await ListSchemaTree())
        } catch (err) {
            setError(String(err))
            setTree([])
        }
    }

    useEffect(() => {
        if (!tree) return
        const stillExists = selected
            && tree.some((s) => s.name === selected.schema && s.tables.some((t) => t.name === selected.name))
        if (stillExists) return
        const first = tree.find((s) => s.tables.length > 0)
        setSelected(first ? {schema: first.name, name: first.tables[0].name} : null)
    }, [tree])

    const query = filter.trim().toLowerCase()
    const groups = useMemo(() => {
        if (!tree) return []
        return tree
            .map((schema) => ({
                ...schema,
                tables: schema.tables.filter(
                    (table) => !query
                        || table.name.toLowerCase().includes(query)
                        || schema.name.toLowerCase().includes(query),
                ),
            }))
            .filter((schema) => !query || schema.tables.length > 0)
    }, [tree, query])

    const schemaNames = tree?.map((schema) => schema.name) ?? []

    const selectedTable = tree
        ?.find((schema) => schema.name === selected?.schema)
        ?.tables.find((table) => table.name === selected?.name)
    const selectedPkCount = selectedTable
        ? selectedTable.columns.filter((column) => column.primaryKey).length
        : 0

    function recordRun(sql, ok) {
        setSqlHistory((previous) => [
            {sql, ok},
            ...previous.filter((entry) => entry.sql !== sql),
        ].slice(0, 20))
    }

    function restoreSql(text) {
        setSqlText(text)
        setRestoreSeq((current) => current + 1)
    }

    async function handleSchemaCreated(name) {
        setDdlSchema(name)
        await load()
        setView('create-table')
        notify(`Schema "${name}" created`)
    }

    async function handleTableCreated(schema, name) {
        await load()
        setSelected({schema, name})
        setDdlSchema(schema)
        setView('data')
        notify(`Table "${schema}.${name}" created`)
    }

    const heading = view === 'create-schema'
        ? 'New schema'
        : view === 'create-table'
            ? 'New table'
            : view === 'sql'
                ? 'SQL runner'
                : selectedTable
                    ? `${selected.schema}.${selectedTable.name}`
                    : 'Workspace'

    return (
        <div className="workspace">
            <header className="topbar">
                <button
                    aria-label="Back to connections"
                    className="back"
                    onClick={onBack}
                    title="Back to connections"
                    type="button"
                >
                    ←
                </button>
                <div className="topbar-title">
                    <strong>
                        <span className="status-dot" aria-hidden="true"/>
                        {info.database}
                    </strong>
                    <span className="muted small">
                        {info.user} · PostgreSQL {info.serverVersion}
                    </span>
                </div>
                <button onClick={load} type="button">Refresh</button>
            </header>

            <div className="workspace-body">
                <aside aria-label="Schema browser" className="sidebar">
                    <input
                        aria-label="Search tables"
                        className="sidebar-search"
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder="Search tables"
                        value={filter}
                    />
                    <div className="sidebar-actions">
                        <button
                            onClick={() => {
                                setDdlSchema(selected?.schema ?? 'public')
                                setView('create-table')
                            }}
                            type="button"
                        >
                            New table
                        </button>
                        <button onClick={() => setView('create-schema')} type="button">
                            New schema
                        </button>
                    </div>
                    {error && <p className="err">{error}</p>}
                    {!tree && (
                        <p className="muted small">
                            <span className="spinner" aria-hidden="true"/> Loading…
                        </p>
                    )}
                    {tree && groups.length === 0 && (
                        <p className="muted small">{query ? 'No tables match.' : 'No tables found.'}</p>
                    )}
                    {groups.map((schema) => (
                        <div className="schema-group" key={schema.name}>
                            <div className="schema-label">{schema.name}</div>
                            {schema.tables.length === 0 && (
                                <p className="muted small schema-empty">No tables yet.</p>
                            )}
                            {schema.tables.map((table) => {
                                const active = selected?.schema === schema.name && selected?.name === table.name
                                const hasPk = table.columns.some((column) => column.primaryKey)
                                return (
                                    <button
                                        aria-current={active ? 'true' : undefined}
                                        className={`table-row ${active ? 'on' : ''}`}
                                        key={table.name}
                                        onClick={() => {
                                            setSelected({schema: schema.name, name: table.name})
                                            setView('data')
                                        }}
                                        type="button"
                                    >
                                        <span className="table-name">{table.name}</span>
                                        {!hasPk && <span className="badge">no PK</span>}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                </aside>

                <main className="content">
                    <div className="content-head">
                        <div className="head-row">
                            <h2>{heading}</h2>
                            <div className="tabs">
                                <button
                                    aria-pressed={view === 'data'}
                                    className={view === 'data' ? 'on' : ''}
                                    onClick={() => setView('data')}
                                    type="button"
                                >
                                    Data
                                </button>
                                <button
                                    aria-pressed={view === 'sql'}
                                    className={view === 'sql' ? 'on' : ''}
                                    onClick={() => setView('sql')}
                                    type="button"
                                >
                                    SQL
                                </button>
                            </div>
                        </div>
                        <p className="muted small">
                            {view === 'sql'
                                ? 'One statement per run · results capped at 1,000 rows · history is per connection'
                                : view === 'create-schema'
                                    ? 'Creates a schema with a quoted identifier'
                                    : view === 'create-table'
                                        ? 'DDL preview updates as you type · identifiers are quoted'
                                        : selectedTable
                                            ? <>
                                                {selectedTable.columns.length} columns
                                                {selectedPkCount === 0 && ' · read-only (no primary key)'}
                                                {selectedPkCount > 1 && ' · read-only (composite primary key)'}
                                            </>
                                            : 'Pick a table from the sidebar.'}
                        </p>
                    </div>

                    {view === 'sql' ? (
                        <SqlEditor
                            history={sqlHistory}
                            initialText={sqlText}
                            onRan={recordRun}
                            onRestore={restoreSql}
                            onTextChange={setSqlText}
                            restoreSeq={restoreSeq}
                        />
                    ) : view === 'create-schema' ? (
                        <SchemaForm onCancel={() => setView('data')} onCreated={handleSchemaCreated}/>
                    ) : view === 'create-table' ? (
                        <TableForm
                            initialSchema={ddlSchema}
                            onCancel={() => setView('data')}
                            onCreated={handleTableCreated}
                            schemas={schemaNames}
                        />
                    ) : selectedTable ? (
                        <DataGrid
                            key={`${selected.schema}.${selectedTable.name}`}
                            schema={selected.schema}
                            table={selectedTable}
                        />
                    ) : (
                        <p className="muted">Pick a table from the sidebar.</p>
                    )}
                </main>
            </div>
        </div>
    )
}
