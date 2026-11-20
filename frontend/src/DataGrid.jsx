import {useEffect, useMemo, useState} from 'react'
import {flexRender, useTable} from '@tanstack/react-table'
import {coreFeatures, rowSortingFeature} from '@tanstack/table-core'
import {QueryRows} from '../wailsjs/go/main/App'

const PAGE_SIZE = 8

const features = {...coreFeatures, rowSortingFeature}

export default function DataGrid({schema, table}) {
    const [result, setResult] = useState(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [filterText, setFilterText] = useState('')
    const [filter, setFilter] = useState('')
    const [sorting, setSorting] = useState([])
    const [pageIndex, setPageIndex] = useState(0)

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
                if (!stale) setError(String(err))
            })
            .finally(() => {
                if (!stale) setLoading(false)
            })
        return () => {
            stale = true
        }
    }, [schema, table.name, filter, sortColumn, sortDesc, pageIndex])

    const columnDefs = useMemo(
        () => (result?.columns ?? []).map((name, index) => ({
            id: name,
            accessorFn: (row) => row[index],
            header: name,
            cell: (context) => {
                const value = context.getValue()
                if (value === null || value === undefined) {
                    return <span className="null">NULL</span>
                }
                return <span className="cell" title={String(value)}>{String(value)}</span>
            },
        })),
        [result?.columns],
    )

    const tableInstance = useTable({
        features,
        data: result?.rows ?? [],
        columns: columnDefs,
        state: {sorting},
        onSortingChange: (updater) => {
            setSorting((previous) => (typeof updater === 'function' ? updater(previous) : updater))
            setPageIndex(0)
        },
        manualSorting: true,
    })

    const total = result?.total ?? 0
    const pageCount = result?.pageCount ?? 0

    return (
        <>
            <div className="grid-toolbar">
                <input
                    aria-label="Filter rows"
                    className="filter-input"
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Filter rows"
                    value={filterText}
                />
                <span className="muted small">
                    {loading ? 'Loading…' : `${total} ${total === 1 ? 'row' : 'rows'}`}
                </span>
                {error && <span className="err">{error}</span>}
                <div className="pager">
                    <button disabled={loading || pageIndex <= 0} onClick={() => setPageIndex(pageIndex - 1)} type="button">
                        Prev
                    </button>
                    <span className="muted small">
                        Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
                    </span>
                    <button
                        disabled={loading || pageIndex + 1 >= pageCount}
                        onClick={() => setPageIndex(pageIndex + 1)}
                        type="button"
                    >
                        Next
                    </button>
                </div>
            </div>

            <div className="grid-wrap">
                {!result ? (
                    <p className="empty muted small">{error ? 'Could not load rows.' : 'Loading rows…'}</p>
                ) : (
                    <table className="grid">
                        <thead>
                        {tableInstance.getHeaderGroups().map((group) => (
                            <tr key={group.id}>
                                {group.headers.map((header) => (
                                    <th key={header.id}>
                                        <button
                                            className="sort"
                                            onClick={header.column.getToggleSortingHandler()}
                                            type="button"
                                        >
                                            <span>
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                            </span>
                                            <span className="sort-mark">
                                                {header.column.getIsSorted() === 'asc' ? '▲' : ''}
                                                {header.column.getIsSorted() === 'desc' ? '▼' : ''}
                                            </span>
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        ))}
                        </thead>
                        <tbody>
                        {tableInstance.getRowModel().rows.map((row) => (
                            <tr key={row.id}>
                                {row.getAllCells().map((cell) => (
                                    <td key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
                {result && result.rows.length === 0 && (
                    <p className="empty muted small">No rows match.</p>
                )}
            </div>
        </>
    )
}
