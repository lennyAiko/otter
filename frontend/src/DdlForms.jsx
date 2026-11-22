import {useState} from 'react'
import {useForm} from '@tanstack/react-form'
import {CreateSchema, CreateTable} from '../wailsjs/go/main/App'

const TYPE_SUGGESTIONS = [
    'integer', 'bigint', 'smallint', 'numeric(10,2)', 'text', 'varchar(255)', 'char(1)',
    'boolean', 'timestamptz', 'timestamp', 'date', 'time', 'uuid', 'jsonb', 'double precision',
]

const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_ ]*(\(\s*\d+(\s*,\s*\d+)?\s*\))?(\[\])?$/

const rule = (fn) => ({onChange: fn, onSubmit: fn})

const nameRule = (label) => rule(({value}) => {
    const name = String(value).trim()
    if (!name) return `Enter a ${label}`
    if (name.length > 63) return `Longer than 63 characters`
    return undefined
})

const typeRule = rule(({value}) => {
    const type = String(value).trim()
    if (!type) return 'Enter a type'
    if (!TYPE_PATTERN.test(type)) return 'Use text, numeric(10,2), timestamptz…'
    return undefined
})

const defaultRule = rule(({value}) => (String(value).includes(';') ? 'Single expression only' : undefined))

function FieldError({field}) {
    const [error] = field.state.meta.errors
    return error ? <em className="err">{String(error)}</em> : null
}

function quoteIdent(name) {
    return `"${name.replaceAll('"', '""')}"`
}

function renderTableSQL(values) {
    const schema = values.schema || 'public'
    const table = values.name.trim()
    if (!table || values.columns.length === 0) return ''
    const parts = values.columns.map((column) => {
        let part = `${quoteIdent(column.name.trim() || '?')} ${column.type.trim() || '?'}`
        if (column.default.trim()) part += ` default ${column.default.trim()}`
        if (!column.nullable) part += ' not null'
        return part
    })
    const primary = values.columns.filter((column) => column.primaryKey)
    if (primary.length > 0) {
        parts.push(`primary key (${primary.map((column) => quoteIdent(column.name.trim() || '?')).join(', ')})`)
    }
    return `create table ${quoteIdent(schema)}.${quoteIdent(table)} (\n  ${parts.join(',\n  ')}\n);`
}

export function SchemaForm({onCreated, onCancel}) {
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    const form = useForm({
        defaultValues: {name: ''},
        listeners: {onChange: () => setError('')},
        onSubmit: async ({value}) => {
            setBusy(true)
            setError('')
            try {
                const name = value.name.trim()
                await CreateSchema(name)
                onCreated(name)
            } catch (err) {
                setError(String(err))
            } finally {
                setBusy(false)
            }
        },
    })

    return (
        <form
            className="ddl-form"
            onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                form.handleSubmit()
            }}
        >
            <form.Field name="name" validators={nameRule('schema name')}>
                {(field) => (
                    <label>
                        <span>Schema name</span>
                        <input
                            autoComplete="off"
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            placeholder="reporting"
                            value={field.state.value}
                        />
                        <FieldError field={field}/>
                    </label>
                )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.name}>
                {(name) => (
                    <pre className="sql-preview">
                        {name.trim() ? `create schema ${quoteIdent(name.trim())};` : 'create schema …;'}
                    </pre>
                )}
            </form.Subscribe>

            <div className="actions">
                <button className={`primary ${busy ? 'busy' : ''}`} disabled={busy} type="submit">
                    {busy && <span className="spinner" aria-hidden="true"/>}
                    {busy ? 'Creating…' : 'Create schema'}
                </button>
                <button onClick={onCancel} type="button">Cancel</button>
                {error && <span className="status error" role="alert">{error}</span>}
            </div>
        </form>
    )
}

function emptyColumn() {
    return {name: '', type: 'text', default: '', nullable: true, primaryKey: false}
}

export function TableForm({schemas, initialSchema, onCreated, onCancel}) {
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    const form = useForm({
        defaultValues: {
            schema: initialSchema || 'public',
            name: '',
            columns: [{name: 'id', type: 'integer', default: '', nullable: false, primaryKey: true}],
        },
        listeners: {onChange: () => setError('')},
        onSubmit: async ({value}) => {
            setBusy(true)
            setError('')
            try {
                await CreateTable({
                    schema: value.schema,
                    name: value.name.trim(),
                    columns: value.columns.map((column) => ({
                        name: column.name.trim(),
                        type: column.type.trim(),
                        default: column.default.trim(),
                        nullable: column.nullable,
                        primaryKey: column.primaryKey,
                    })),
                })
                onCreated(value.schema, value.name.trim())
            } catch (err) {
                setError(String(err))
            } finally {
                setBusy(false)
            }
        },
    })

    return (
        <form
            className="ddl-form"
            onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                form.handleSubmit()
            }}
        >
            <div className="row">
                <form.Field name="schema">
                    {(field) => (
                        <label>
                            <span>Schema</span>
                            <select
                                onChange={(event) => field.handleChange(event.target.value)}
                                value={field.state.value}
                            >
                                {schemas.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </label>
                    )}
                </form.Field>
                <form.Field name="name" validators={nameRule('table name')}>
                    {(field) => (
                        <label>
                            <span>Table name</span>
                            <input
                                autoComplete="off"
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                placeholder="monthly_totals"
                                value={field.state.value}
                            />
                            <FieldError field={field}/>
                        </label>
                    )}
                </form.Field>
            </div>

            <datalist id="pg-types">
                {TYPE_SUGGESTIONS.map((type) => <option key={type} value={type}/>)}
            </datalist>

            <form.Field
                name="columns"
                validators={rule(({value}) => {
                    const names = value.map((column) => column.name.trim()).filter(Boolean)
                    return new Set(names).size === names.length ? undefined : 'Column names must be unique'
                })}
            >
                {(field) => (
                    <div className="ddl-columns">
                        <div className="ddl-column-head">
                            <span>Name</span>
                            <span>Type</span>
                            <span>Default expression</span>
                            <span>Nullable</span>
                            <span>PK</span>
                            <span/>
                        </div>
                        {field.state.value.map((column, index) => (
                            <div className="ddl-column" key={index}>
                                <form.Field
                                    name={`columns[${index}].name`}
                                    validators={nameRule('column name')}
                                >
                                    {(input) => (
                                        <label>
                                            <input
                                                autoComplete="off"
                                                onBlur={input.handleBlur}
                                                onChange={(event) => input.handleChange(event.target.value)}
                                                placeholder="column"
                                                value={input.state.value}
                                            />
                                            <FieldError field={input}/>
                                        </label>
                                    )}
                                </form.Field>
                                <form.Field name={`columns[${index}].type`} validators={typeRule}>
                                    {(input) => (
                                        <label>
                                            <input
                                                autoComplete="off"
                                                list="pg-types"
                                                onBlur={input.handleBlur}
                                                onChange={(event) => input.handleChange(event.target.value)}
                                                value={input.state.value}
                                            />
                                            <FieldError field={input}/>
                                        </label>
                                    )}
                                </form.Field>
                                <form.Field name={`columns[${index}].default`} validators={defaultRule}>
                                    {(input) => (
                                        <label>
                                            <input
                                                autoComplete="off"
                                                className="mono"
                                                onChange={(event) => input.handleChange(event.target.value)}
                                                placeholder="now()"
                                                value={input.state.value}
                                            />
                                            <FieldError field={input}/>
                                        </label>
                                    )}
                                </form.Field>
                                <form.Field name={`columns[${index}].nullable`}>
                                    {(input) => (
                                        <label className="check">
                                            <input
                                                checked={input.state.value}
                                                onChange={(event) => input.handleChange(event.target.checked)}
                                                type="checkbox"
                                            />
                                        </label>
                                    )}
                                </form.Field>
                                <form.Field name={`columns[${index}].primaryKey`}>
                                    {(input) => (
                                        <label className="check">
                                            <input
                                                checked={input.state.value}
                                                onChange={(event) => input.handleChange(event.target.checked)}
                                                type="checkbox"
                                            />
                                        </label>
                                    )}
                                </form.Field>
                                <button
                                    aria-label={`Remove column ${index + 1}`}
                                    className="icon"
                                    disabled={field.state.value.length === 1}
                                    onClick={() => field.removeValue(index)}
                                    type="button"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        <div className="actions">
                            <button onClick={() => field.pushValue(emptyColumn())} type="button">
                                Add column
                            </button>
                            {field.state.meta.errors.length > 0 && (
                                <em className="err">{String(field.state.meta.errors[0])}</em>
                            )}
                        </div>
                    </div>
                )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values}>
                {(values) => <pre className="sql-preview">{renderTableSQL(values) || 'Fill in the table name to see the SQL.'}</pre>}
            </form.Subscribe>

            <div className="actions">
                <button className={`primary ${busy ? 'busy' : ''}`} disabled={busy} type="submit">
                    {busy && <span className="spinner" aria-hidden="true"/>}
                    {busy ? 'Creating…' : 'Create table'}
                </button>
                <button onClick={onCancel} type="button">Cancel</button>
                {error && <span className="status error" role="alert">{error}</span>}
            </div>
        </form>
    )
}
