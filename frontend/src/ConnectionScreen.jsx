import {useEffect, useRef, useState} from 'react'
import {useForm} from '@tanstack/react-form'
import {
    Connect,
    DeleteConnection,
    ListConnections,
    ParseConnectionURL,
    SaveConnection,
    TestConnection,
} from '../wailsjs/go/main/App'

const blank = {
    id: '',
    name: '',
    host: 'localhost',
    port: '5432',
    database: 'shop_dev',
    user: 'postgres',
    sslMode: 'disable',
    password: '',
    url: 'postgresql://postgres:postgres@localhost:5432/shop_dev',
}

const rule = (fn) => ({onChange: fn, onSubmit: fn})
const requiredRule = (message) => rule(({value}) => (String(value).trim() ? undefined : message))
const portRule = rule(({value}) => (/^\d+$/.test(String(value).trim()) ? undefined : 'Use a number'))

function FieldError({field}) {
    const [error] = field.state.meta.errors
    return error ? <em className="err">{String(error)}</em> : null
}

export default function ConnectionScreen({onConnected}) {
    const [profiles, setProfiles] = useState([])
    const [mode, setMode] = useState('fields')
    const [status, setStatus] = useState({kind: 'idle', text: 'Not connected'})
    const [busy, setBusy] = useState(false)
    const intent = useRef('save')

    const form = useForm({
        defaultValues: blank,
        onSubmit: async ({value}) => {
            if (intent.current === 'test') {
                await testConnection(value)
            } else {
                await saveAndConnect(value)
            }
        },
    })

    useEffect(() => {
        refreshProfiles()
    }, [])

    async function refreshProfiles() {
        try {
            setProfiles(await ListConnections())
        } catch (err) {
            setStatus({kind: 'error', text: String(err)})
        }
    }

    async function resolveConfig(value) {
        if (mode === 'url') {
            return await ParseConnectionURL(value.url)
        }
        return {
            host: value.host.trim(),
            port: value.port.trim(),
            database: value.database.trim(),
            user: value.user.trim(),
            password: value.password,
            sslMode: value.sslMode || 'disable',
        }
    }

    async function testConnection(value) {
        setBusy(true)
        setStatus({kind: 'busy', text: 'Testing…'})
        try {
            const info = await TestConnection(await resolveConfig(value))
            setStatus({kind: 'ok', text: `Connected — PostgreSQL ${info.serverVersion}`})
        } catch (err) {
            setStatus({kind: 'error', text: String(err)})
        } finally {
            setBusy(false)
        }
    }

    async function saveAndConnect(value) {
        setBusy(true)
        setStatus({kind: 'busy', text: 'Connecting…'})
        try {
            const cfg = await resolveConfig(value)
            const profile = await SaveConnection({
                id: value.id,
                name: value.name.trim(),
                host: cfg.host,
                port: cfg.port,
                database: cfg.database,
                user: cfg.user,
                sslMode: cfg.sslMode,
            })
            form.setFieldValue('id', profile.id)
            form.setFieldValue('name', profile.name)
            form.setFieldValue('host', profile.host)
            form.setFieldValue('port', profile.port)
            form.setFieldValue('database', profile.database)
            form.setFieldValue('user', profile.user)
            form.setFieldValue('sslMode', profile.sslMode)
            await refreshProfiles()
            onConnected(await Connect(cfg))
        } catch (err) {
            setStatus({kind: 'error', text: String(err)})
        } finally {
            setBusy(false)
        }
    }

    function useProfile(profile) {
        setMode('fields')
        for (const key of ['id', 'name', 'host', 'port', 'database', 'user', 'sslMode']) {
            form.setFieldValue(key, profile[key] ?? '')
        }
        form.setFieldValue('password', '')
        setStatus({kind: 'idle', text: 'Not connected'})
    }

    function newProfile() {
        form.reset()
        setMode('fields')
        setStatus({kind: 'idle', text: 'Not connected'})
    }

    async function deleteProfile(profile) {
        try {
            await DeleteConnection(profile.id)
            await refreshProfiles()
            if (form.state.values.id === profile.id) {
                form.reset()
            }
        } catch (err) {
            setStatus({kind: 'error', text: String(err)})
        }
    }

    return (
        <div className="page">
            <header className="masthead">
                <div className="brand">Otter</div>
                <div className="tagline">A small Postgres viewer, built one stage at a time.</div>
            </header>

            <div className="layout">
                <section className="card">
                    <div className="card-head">
                        <h2>Your connections</h2>
                        <button className="link" onClick={newProfile} type="button">New connection</button>
                    </div>
                    {profiles.length === 0 ? (
                        <p className="muted">Nothing saved yet — fill the form and connect once.</p>
                    ) : (
                        <ul className="conn-list">
                            {profiles.map((profile) => (
                                <li className={form.state.values.id === profile.id ? 'on' : ''} key={profile.id}>
                                    <button className="conn-main" onClick={() => useProfile(profile)} type="button">
                                        <span className="conn-name">{profile.name}</span>
                                        <span className="conn-dsn mono">
                                            {profile.user}@{profile.host}:{profile.port}/{profile.database}
                                        </span>
                                    </button>
                                    <button
                                        aria-label={`Delete ${profile.name}`}
                                        className="icon"
                                        onClick={() => deleteProfile(profile)}
                                        type="button"
                                    >
                                        ✕
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="card">
                    <div className="card-head">
                        <h2>Connection</h2>
                        <div className="tabs">
                            <button className={mode === 'fields' ? 'on' : ''} onClick={() => setMode('fields')} type="button">
                                Fields
                            </button>
                            <button className={mode === 'url' ? 'on' : ''} onClick={() => setMode('url')} type="button">
                                URL
                            </button>
                        </div>
                    </div>

                    <form
                        className="form"
                        onSubmit={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            intent.current = 'save'
                            form.handleSubmit()
                        }}
                    >
                        <form.Field name="name" validators={requiredRule('Enter a name')}>
                            {(field) => (
                                <label>
                                    <span>Name</span>
                                    <input
                                        autoComplete="off"
                                        onBlur={field.handleBlur}
                                        onChange={(event) => field.handleChange(event.target.value)}
                                        placeholder="Local dev"
                                        value={field.state.value}
                                    />
                                    <FieldError field={field}/>
                                </label>
                            )}
                        </form.Field>

                        {mode === 'fields' ? (
                            <>
                                <div className="row">
                                    <form.Field name="host" validators={requiredRule('Enter a host')}>
                                        {(field) => (
                                            <label>
                                                <span>Host</span>
                                                <input
                                                    autoComplete="off"
                                                    onBlur={field.handleBlur}
                                                    onChange={(event) => field.handleChange(event.target.value)}
                                                    value={field.state.value}
                                                />
                                                <FieldError field={field}/>
                                            </label>
                                        )}
                                    </form.Field>
                                    <form.Field name="port" validators={portRule}>
                                        {(field) => (
                                            <label>
                                                <span>Port</span>
                                                <input
                                                    autoComplete="off"
                                                    onBlur={field.handleBlur}
                                                    onChange={(event) => field.handleChange(event.target.value)}
                                                    value={field.state.value}
                                                />
                                                <FieldError field={field}/>
                                            </label>
                                        )}
                                    </form.Field>
                                </div>
                                <div className="row">
                                    <form.Field name="database" validators={requiredRule('Enter a database')}>
                                        {(field) => (
                                            <label>
                                                <span>Database</span>
                                                <input
                                                    autoComplete="off"
                                                    onBlur={field.handleBlur}
                                                    onChange={(event) => field.handleChange(event.target.value)}
                                                    value={field.state.value}
                                                />
                                                <FieldError field={field}/>
                                            </label>
                                        )}
                                    </form.Field>
                                    <form.Field name="user" validators={requiredRule('Enter a user')}>
                                        {(field) => (
                                            <label>
                                                <span>User</span>
                                                <input
                                                    autoComplete="off"
                                                    onBlur={field.handleBlur}
                                                    onChange={(event) => field.handleChange(event.target.value)}
                                                    value={field.state.value}
                                                />
                                                <FieldError field={field}/>
                                            </label>
                                        )}
                                    </form.Field>
                                </div>
                                <form.Field name="password">
                                    {(field) => (
                                        <label>
                                            <span>Password (asked now, never saved)</span>
                                            <input
                                                autoComplete="off"
                                                onChange={(event) => field.handleChange(event.target.value)}
                                                type="password"
                                                value={field.state.value}
                                            />
                                        </label>
                                    )}
                                </form.Field>
                            </>
                        ) : (
                            <form.Field name="url" validators={requiredRule('Enter a connection URL')}>
                                {(field) => (
                                    <label>
                                        <span>Connection URL</span>
                                        <input
                                            autoComplete="off"
                                            className="mono"
                                            onBlur={field.handleBlur}
                                            onChange={(event) => field.handleChange(event.target.value)}
                                            placeholder="postgresql://user:password@localhost:5432/db"
                                            spellCheck={false}
                                            value={field.state.value}
                                        />
                                        <FieldError field={field}/>
                                    </label>
                                )}
                            </form.Field>
                        )}

                        <div className="actions">
                            <button className="primary" disabled={busy} type="submit">
                                Save and connect
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => {
                                    intent.current = 'test'
                                    form.handleSubmit()
                                }}
                                type="button"
                            >
                                Test connection
                            </button>
                            <span className={`status ${status.kind}`}>{status.text}</span>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    )
}
