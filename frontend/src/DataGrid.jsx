import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {flexRender, useTable} from '@tanstack/react-table'
import {coreFeatures} from '@tanstack/table-core'
import {CommitEdits, PreviewUpdates, QueryRows} from '../wailsjs/go/main/App'
import {isSessionLost} from './errors'
import {useToast} from './Toast'

const PAGE_SIZE = 8
const SEP = '\u0000'
const features = {...coreFeatures}

const NUMERIC_TYPE = /^(smallint|integer|bigint|decimal|numeric|real|double precision)/
const BOOLEAN_TYPE = /^boolean$/
const NUMBER_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const BOOLEAN_TEXT = /^(true|false|t|f|1|0)$/i

// A stable component type keeps React from remounting the editor on each
// keystroke; all grid state arrives through context instead of new closures.
const GridContext = createContext(null)

function DataCell({cell}) {
    const grid = useContext(GridContext)
    const name = cell.column.id
    const pkValue = grid.pkIndex >= 0 ? String(cell.row.original[grid.pkIndex]) : null
    const key = pkValue === null ? '' : pkValue + SEP + name
    const active = grid.editing !== null && grid.editing.key === key

    if (active) {
        return (
            <div className="cell-edit">
                <input
                    autoFocus
                    className="cell-input"
                    onBlur={grid.commitEdit}
                    onChange={(event) => grid.setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault()
                            grid.commitEdit()
                        } else if (event.key === 'Escape') {
                            event.preventDefault()
                            grid.cancelEdit()
                        }
                    }}
                    value={grid.draft}
                />
                <button
                    className="null-btn"
                    onMouseDown={(event) => {
                        event.preventDefault()
                        grid.applyNull()
                    }}
                    type="button"
                >
                    NULL
                </button>
            </div>
        )
    }

    const pendingCell = key ? grid.pending[key] : undefined
    const value = pendingCell ? pendingCell.value : cell.getValue()
    if (value === null || value === undefined) {
        return <span className="null">NULL</span>
    }
    return <span className="cell" title={String(value)}>{String(value)}</span>
}

export default function DataGrid({schema, table, onPendingChange, onSessionLost}) {
    const notify = useToast()
    const filterRef = useRef(null)
    const [result, setResult] = useState(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [filterText, setFilterText] = useState('')
    const [filter, setFilter] = useState('')
    const [sorting, setSorting] = useState([])
    const [pageIndex, setPageIndex] = useState(0)
    const [reload, setReload] = useState(0)

    const [pending, setPending] = useState({})
    const changeCount = Object.keys(pending).length
    const [editing, setEditing] = useState(null)
    const [draft, setDraft] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState('')
    const [preview, setPreview] = useState('')
    const [showPreview, setShowPreview] = useState(false)

    useEffect(() => {
        onPendingChange?.(changeCount)
    }, [changeCount, onPendingChange])

    useEffect(() => {
        const timer = setTimeout(() => {
            setFilter(filterText.trim())
            setPageIndex(0)
        }, 250)
        return () => clearTimeout(timer)
    }, [filterText])

    const sort = sorting[0]
    const sortColumn = sort?.id ?? ''
    const sortDesc = sort?.desc ?? false

    useEffect(() => {
        let stale = false
        setLoading(true)
        setError('')
        QueryRows({
            schema,
            table: table.name,
            filter,
            sortColumn,
            sortDesc,
            page: pageIndex + 1,
            pageSize: PAGE_SIZE,
        })
            .then((rows) => {
                if (stale) return
                setResult(rows)
                if (rows.page !== pageIndex + 1) {
                    setPageIndex(rows.page - 1)
                }
            })
            .catch((err) => {
                if (stale) return
                setError(String(err))
                if (isSessionLost(err)) onSessionLost?.()
            })
            .finally(() => {
                if (!stale) setLoading(false)
            })
        return () => {
            stale = true
        }
    }, [schema, table.name, filter, sortColumn, sortDesc, pageIndex, reload])

    function toggleSort(columnId) {
        setPageIndex(0)
        setSorting((previous) => {
            const current = previous[0]
            if (!current || current.id !== columnId) return [{id: columnId, desc: false}]
            if (!current.desc) return [{id: columnId, desc: true}]
            return []
        })
    }

    const pkColumns = table.columns.filter((column) => column.primaryKey)
    const editable = pkColumns.length === 1
    const pkName = editable ? pkColumns[0].name : ''
    const pkIndex = editable && result ? result.columns.indexOf(pkName) : -1
    const metaByName = Object.fromEntries(table.columns.map((column) => [column.name, column]))

    const columnDefs = useMemo(() => (result?.columns ?? []).map((name, index) => ({
        id: name,
        accessorFn: (row) => row[index],
        header: name,
        cell: DataCell,
    })), [result?.columns])

    const tableInstance = useTable({
        features,
        data: result?.rows ?? [],
        columns: columnDefs,
    })

    function startEdit(pkValue, column, value) {
        if (editing) return
        setEditing({key: pkValue + SEP + column, pkValue, column, original: value ?? null})
        setDraft(value ?? '')
        setSaveError('')
    }

    function cancelEdit() {
        setEditing(null)
        setDraft('')
    }

    function stage(value) {
        if (!editing) return
        const {key, pkValue, column, original} = editing
        const next = {...pending}
        if ((value ?? '') === (original ?? '')) {
            delete next[key]
        } else {
            next[key] = {pkValue, column, value}
        }
        setPending(next)
        setPreview('')
        setShowPreview(false)
        setSaveError('')
        cancelEdit()
    }

    function validate(value, column) {
        const type = metaByName[column]?.type ?? ''
        const text = value.trim()
        if (NUMERIC_TYPE.test(type) && !NUMBER_TEXT.test(text)) return 'not a number'
        if (BOOLEAN_TYPE.test(type) && !BOOLEAN_TEXT.test(text)) return 'use true or false'
        return ''
    }

    function commitEdit() {
        if (!editing) return
        const message = validate(draft, editing.column)
        if (message) {
            setSaveError(`${editing.column}: ${message}`)
            cancelEdit()
            return
        }
        stage(draft)
    }

    function applyNull() {
        if (!editing) return
        if (editing.original === null) {
            cancelEdit()
            return
        }
        stage(null)
    }

    function buildEdits() {
        return Object.values(pending).map((edit) => ({
            schema,
            table: table.name,
            column: edit.column,
            keys: [{column: pkName, value: edit.pkValue}],
            value: edit.value,
        }))
    }

    async function review() {
        if (showPreview) {
            setShowPreview(false)
            return
        }
        setSaveError('')
        try {
            setPreview(await PreviewUpdates(buildEdits()))
            setShowPreview(true)
        } catch (err) {
            setSaveError(String(err))
        }
    }

    async function save() {
        setSaving(true)
        setSaveError('')
        try {
            const committed = await CommitEdits(buildEdits())
            setPending({})
            setPreview('')
            setShowPreview(false)
            setEditing(null)
            notify(`Saved ${committed.updated} ${committed.updated === 1 ? 'change' : 'changes'}`)
            setReload((current) => current + 1)
            filterRef.current?.focus()
        } catch (err) {
            setSaveError(String(err))
            if (isSessionLost(err)) onSessionLost?.()
        } finally {
            setSaving(false)
        }
    }

    function discard() {
        setPending({})
        setPreview('')
        setShowPreview(false)
        setEditing(null)
        setSaveError('')
    }

    const total = result?.total ?? 0
    const pageCount = result?.pageCount ?? 0
    const hasChanges = changeCount > 0
    const gridValue = {pending, editing, draft, pkIndex, setDraft, commitEdit, cancelEdit, applyNull}

    return (
        <>
            <div className="grid-toolbar">
                <input
                    aria-label="Filter rows"
                    className="filter-input"
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Filter rows"
                    ref={filterRef}
                    value={filterText}
                />
                {loading ? (
                    <span className="muted small">
                        <span className="spinner" aria-hidden="true"/> Loading…
                    </span>
                ) : (
                    <span className="muted small">{total} {total === 1 ? 'row' : 'rows'}</span>
                )}
                {error && <span className="err" role="alert">{error}</span>}
                <div className="pager">
                    <button
                        aria-label="Previous page"
                        disabled={loading || pageIndex <= 0}
                        onClick={() => setPageIndex(pageIndex - 1)}
                        type="button"
                    >
                        Prev
                    </button>
                    <span className="muted small">
                        Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
                    </span>
                    <button
                        aria-label="Next page"
                        disabled={loading || pageIndex + 1 >= pageCount}
                        onClick={() => setPageIndex(pageIndex + 1)}
                        type="button"
                    >
                        Next
                    </button>
                </div>
            </div>

            {hasChanges && (
                <div className="edit-bar">
                    <span className="muted small">
                        {changeCount} pending {changeCount === 1 ? 'change' : 'changes'}
                    </span>
                    <div className="actions-group">
                        <button onClick={review} type="button">
                            {showPreview ? 'Hide SQL' : 'Review SQL'}
                        </button>
                        <button disabled={saving} onClick={discard} type="button">
                            Discard
                        </button>
                        <button
                            className={`primary ${saving ? 'busy' : ''}`}
                            disabled={saving}
                            onClick={save}
                            type="button"
                        >
                            {saving && <span className="spinner" aria-hidden="true"/>}
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
            )}
            {saveError && <p className="err edit-error" role="alert">{saveError}</p>}
            {showPreview && <pre className="sql-preview">{preview}</pre>}

            <GridContext.Provider value={gridValue}>
                <div className="grid-wrap">
                {!result ? (
                    <p className="empty muted small">
                        {error ? 'Could not load rows.' : <><span className="spinner" aria-hidden="true"/> Loading rows…</>}
                    </p>
                ) : (
                    <table aria-label={`${schema}.${table.name}`} className="grid">
                        <thead>
                        {tableInstance.getHeaderGroups().map((group) => (
                            <tr key={group.id}>
                                {group.headers.map((header) => (
                                    <th
                                        aria-sort={sort?.id === header.column.id
                                            ? (sort.desc ? 'descending' : 'ascending')
                                            : 'none'}
                                        key={header.id}
                                        scope="col"
                                    >
                                        <button
                                            className="sort"
                                            onClick={() => toggleSort(header.column.id)}
                                            type="button"
                                        >
                                            <span>
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                            </span>
                                            <span className="sort-mark">
                                                {sort?.id === header.column.id ? (sort.desc ? '▼' : '▲') : ''}
                                            </span>
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        ))}
                        </thead>
                        <tbody>
                        {tableInstance.getRowModel().rows.map((row) => {
                            const pkValue = pkIndex >= 0 ? String(row.original[pkIndex]) : null
                            return (
                                <tr key={row.id}>
                                    {row.getAllCells().map((cell) => {
                                        const name = cell.column.id
                                        const columnMeta = metaByName[name]
                                        const canEdit = editable && pkValue !== null && columnMeta && !columnMeta.primaryKey
                                        const isPending = pkValue !== null && Boolean(pending[pkValue + SEP + name])
                                        const pendingCell = pkValue !== null ? pending[pkValue + SEP + name] : undefined
                                        return (
                                            <td
                                                className={[canEdit ? 'editable' : '', isPending ? 'pending-cell' : '']
                                                    .filter(Boolean)
                                                    .join(' ')}
                                                key={cell.id}
                                                onDoubleClick={canEdit
                                                    ? () => startEdit(
                                                        pkValue,
                                                        name,
                                                        pendingCell ? pendingCell.value : cell.getValue(),
                                                    )
                                                    : undefined}
                                            >
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        )
                                    })}
                                </tr>
                            )
                        })}
                        </tbody>
                    </table>
                )}
                {result && result.rows.length === 0 && (
                    <div className="empty-state">
                        <p>{filter ? 'No rows match this filter.' : 'This table is empty.'}</p>
                        {!filter && <p>Insert rows from the SQL tab.</p>}
                    </div>
                )}
                </div>
            </GridContext.Provider>
        </>
    )
}
