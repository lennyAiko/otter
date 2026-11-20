import {useEffect, useState} from 'react';
import './App.css';
import {
    Connect,
    DeleteConnection,
    Disconnect,
    ListConnections,
    ParseConnectionURL,
    SaveConnection,
    TestConnection,
} from '../wailsjs/go/main/App';

const emptyForm = {
    id: '',
    name: '',
    host: 'localhost',
    port: '5432',
    database: 'shop_dev',
    user: 'postgres',
    sslMode: 'disable',
    password: '',
};

export default function App() {
    const [profiles, setProfiles] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [mode, setMode] = useState('fields');
    const [url, setUrl] = useState('postgresql://postgres:postgres@localhost:5432/shop_dev');
    const [errors, setErrors] = useState({});
    const [status, setStatus] = useState({kind: 'idle', text: 'Not connected'});
    const [info, setInfo] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        refresh();
    }, []);

    async function refresh() {
        try {
            setProfiles(await ListConnections());
        } catch (err) {
            setStatus({kind: 'error', text: String(err)});
        }
    }

    const field = (key) => ({
        value: form[key],
        onChange: (e) => setForm((f) => ({...f, [key]: e.target.value})),
    });

    function useProfile(p) {
        setForm({...emptyForm, ...p, password: ''});
        setMode('fields');
        setErrors({});
    }

    async function deleteProfile(p) {
        try {
            await DeleteConnection(p.id);
            await refresh();
            if (form.id === p.id) {
                setForm(emptyForm);
            }
        } catch (err) {
            setStatus({kind: 'error', text: String(err)});
        }
    }

    function validate() {
        const e = {};
        if (!form.name.trim()) {
            e.name = 'Enter a name';
        }
        if (mode === 'fields') {
            if (!form.host.trim()) e.host = 'Enter a host';
            if (!/^\d+$/.test(form.port)) e.port = 'Use a number';
            if (!form.database.trim()) e.database = 'Enter a database';
            if (!form.user.trim()) e.user = 'Enter a user';
        } else if (!url.trim()) {
            e.url = 'Enter a connection URL';
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    async function resolveConfig() {
        if (mode === 'url') {
            return await ParseConnectionURL(url);
        }
        return {
            host: form.host.trim(),
            port: form.port.trim(),
            database: form.database.trim(),
            user: form.user.trim(),
            password: form.password,
            sslMode: form.sslMode || 'disable',
        };
    }

    async function test(e) {
        e.preventDefault();
        if (!validate()) return;
        setBusy(true);
        setStatus({kind: 'busy', text: 'Testing…'});
        try {
            const result = await TestConnection(await resolveConfig());
            setStatus({kind: 'ok', text: `Connected — PostgreSQL ${result.serverVersion}`});
        } catch (err) {
            setStatus({kind: 'error', text: String(err)});
        } finally {
            setBusy(false);
        }
    }

    async function saveAndConnect(e) {
        e.preventDefault();
        if (!validate()) return;
        setBusy(true);
        setInfo(null);
        setStatus({kind: 'busy', text: 'Connecting…'});
        try {
            const cfg = await resolveConfig();
            const profile = await SaveConnection({
                id: form.id,
                name: form.name.trim(),
                host: cfg.host,
                port: cfg.port,
                database: cfg.database,
                user: cfg.user,
                sslMode: cfg.sslMode,
            });
            setForm((f) => ({
                ...f,
                id: profile.id,
                name: profile.name,
                host: profile.host,
                port: profile.port,
                database: profile.database,
                user: profile.user,
                sslMode: profile.sslMode,
            }));
            const result = await Connect(cfg);
            setInfo(result);
            setStatus({kind: 'ok', text: `Connected — PostgreSQL ${result.serverVersion}`});
            await refresh();
        } catch (err) {
            setStatus({kind: 'error', text: String(err)});
        } finally {
            setBusy(false);
        }
    }

    async function disconnect() {
        await Disconnect();
        setInfo(null);
        setStatus({kind: 'idle', text: 'Not connected'});
    }

    function newProfile() {
        setForm(emptyForm);
        setMode('fields');
        setErrors({});
        setStatus({kind: 'idle', text: 'Not connected'});
    }

    return (
        <main className="page">
            <header className="masthead">
                <h1>Otter</h1>
                <p>Saved connections live in your user config folder. Passwords are never stored.</p>
            </header>

            <div className="layout">
                <section className="card">
                    <h2>Your connections</h2>
                    {profiles.length === 0 ? (
                        <p className="muted">No saved connections yet.</p>
                    ) : (
                        <ul className="conn-list">
                            {profiles.map((p) => (
                                <li key={p.id} className={form.id === p.id ? 'selected' : ''}>
                                    <button type="button" className="conn-main" onClick={() => useProfile(p)}>
                                        <span className="conn-name">{p.name}</span>
                                        <span className="conn-dsn">{p.user}@{p.host}:{p.port}/{p.database}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="icon"
                                        aria-label={`Delete ${p.name}`}
                                        onClick={() => deleteProfile(p)}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <button type="button" className="full" onClick={newProfile}>New connection</button>
                </section>

                <section className="card">
                    <div className="card-head">
                        <h2>Connection</h2>
                        <div className="tabs" role="tablist" aria-label="Connection input mode">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mode === 'fields'}
                                className={`tab ${mode === 'fields' ? 'on' : ''}`}
                                onClick={() => setMode('fields')}
                            >
                                Fields
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mode === 'url'}
                                className={`tab ${mode === 'url' ? 'on' : ''}`}
                                onClick={() => setMode('url')}
                            >
                                URL
                            </button>
                        </div>
                    </div>

                    <form className="form" onSubmit={saveAndConnect}>
                        <label>
                            <span>Name</span>
                            <input {...field('name')} placeholder="Local dev" autoComplete="off" />
                            {errors.name && <em className="err">{errors.name}</em>}
                        </label>

                        {mode === 'fields' ? (
                            <>
                                <div className="row">
                                    <label>
                                        <span>Host</span>
                                        <input {...field('host')} placeholder="localhost" />
                                        {errors.host && <em className="err">{errors.host}</em>}
                                    </label>
                                    <label>
                                        <span>Port</span>
                                        <input {...field('port')} inputMode="numeric" placeholder="5432" />
                                        {errors.port && <em className="err">{errors.port}</em>}
                                    </label>
                                </div>
                                <div className="row">
                                    <label>
                                        <span>Database</span>
                                        <input {...field('database')} placeholder="shop_dev" />
                                        {errors.database && <em className="err">{errors.database}</em>}
                                    </label>
                                    <label>
                                        <span>User</span>
                                        <input {...field('user')} placeholder="postgres" autoComplete="off" />
                                        {errors.user && <em className="err">{errors.user}</em>}
                                    </label>
                                </div>
                                <label>
                                    <span>Password (asked now, never saved)</span>
                                    <input {...field('password')} type="password" autoComplete="off" />
                                </label>
                            </>
                        ) : (
                            <label>
                                <span>Connection URL</span>
                                <input
                                    className="mono"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="postgresql://user:password@localhost:5432/db"
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                                {errors.url && <em className="err">{errors.url}</em>}
                            </label>
                        )}

                        <div className="actions">
                            <button type="submit" className="primary" disabled={busy}>Save and connect</button>
                            <button type="button" onClick={test} disabled={busy}>Test connection</button>
                            <button type="button" onClick={disconnect}>Disconnect</button>
                            <span className={`status ${status.kind}`}>{status.text}</span>
                        </div>
                    </form>
                </section>
            </div>

            {info && (
                <section className="card">
                    <h2>{info.database} @ PostgreSQL {info.serverVersion}</h2>
                    <p className="muted">Connected as {info.user}. Schemas:</p>
                    <ul className="chips">
                        {info.schemas.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                </section>
            )}
        </main>
    );
}
