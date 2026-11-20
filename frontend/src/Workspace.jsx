import {useEffect, useMemo, useState} from 'react'
import {ListSchemaTree} from '../wailsjs/go/main/App'
import DataGrid from './DataGrid'

export default function Workspace({info, onBack}) {
    const [tree, setTree] = useState(null)
    const [error, setError] = useState('')
    const [filter, setFilter] = useState('')
    const [selected, setSelected] = useState(null)

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
            .filter((schema) => schema.tables.length > 0)
    }, [tree, query])

    const selectedTable = tree
        ?.find((schema) => schema.name === selected?.schema)
        ?.tables.find((table) => table.name === selected?.name)

    return (
        <div className="workspace">
            <header className="topbar">
                <button onClick={onBack} type="button">← Connections</button>
                <div className="topbar-title">
                    <strong>{info.database}</strong>
                    <span className="muted small">
                        {info.user} · PostgreSQL {info.serverVersion}
                    </span>
                </div>
                <button onClick={load} type="button">Refresh</button>
            </header>

            <div className="workspace-body">
                <aside className="sidebar">
                    <input
                        aria-label="Search tables"
                        className="sidebar-search"
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder="Search tables"
                        value={filter}
                    />
                    {error && <p className="err">{error}</p>}
                    {!tree && <p className="muted small">Loading…</p>}
                    {tree && groups.length === 0 && (
                        <p className="muted small">{query ? 'No tables match.' : 'No tables found.'}</p>
                    )}
                    {groups.map((schema) => (
                        <div className="schema-group" key={schema.name}>
                            <div className="schema-label">{schema.name}</div>
                            {schema.tables.map((table) => {
                                const active = selected?.schema === schema.name && selected?.name === table.name
                                const hasPk = table.columns.some((column) => column.primaryKey)
                                return (
                                    <button
                                        className={`table-row ${active ? 'on' : ''}`}
                                        key={table.name}
                                        onClick={() => setSelected({schema: schema.name, name: table.name})}
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
                    {selectedTable ? (
                        <>
                            <div className="content-head">
                                <h2>{selected.schema}.{selectedTable.name}</h2>
                                <p className="muted small">
                                    {selectedTable.columns.length} columns
                                    {selectedTable.columns.some((column) => column.primaryKey) ? '' : ' · read-only (no primary key)'}
                                </p>
                            </div>
                            <DataGrid
                                key={`${selected.schema}.${selectedTable.name}`}
                                schema={selected.schema}
                                table={selectedTable}
                            />
                        </>
                    ) : (
                        <p className="muted">Pick a table from the sidebar.</p>
                    )}
                </main>
            </div>
        </div>
    )
}
