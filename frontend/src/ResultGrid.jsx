import {useMemo} from 'react'
import {flexRender, useTable} from '@tanstack/react-table'
import {coreFeatures} from '@tanstack/table-core'

const features = {...coreFeatures}

// Read-only TanStack Table used for SQL results. Stage 4's DataGrid adds
// editing and server paging on top of the same rendering rules.
export default function ResultGrid({columns, rows, emptyText = 'No rows returned.', label = 'Query results'}) {
    const columnDefs = useMemo(() => columns.map((name, index) => ({
        id: String(index),
        accessorFn: (row) => row[index],
        header: name,
    })), [columns])

    const table = useTable({
        features,
        data: rows,
        columns: columnDefs,
    })

    if (rows.length === 0) {
        return (
            <div className="empty-state">
                <p>{emptyText}</p>
            </div>
        )
    }

    return (
        <div className="grid-wrap">
            <table aria-label={label} className="grid">
                <thead>
                {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                        {group.headers.map((header) => (
                            <th key={header.id} scope="col">
                                <span className="col-head">
                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                </span>
                            </th>
                        ))}
                    </tr>
                ))}
                </thead>
                <tbody>
                {table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                        {row.getAllCells().map((cell) => {
                            const value = cell.getValue()
                            return (
                                <td key={cell.id}>
                                    {value === null || value === undefined ? (
                                        <span className="null">NULL</span>
                                    ) : (
                                        <span className="cell" title={String(value)}>{String(value)}</span>
                                    )}
                                </td>
                            )
                        })}
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    )
}
