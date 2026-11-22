import {useEffect, useRef, useState} from 'react'
import {EditorState} from '@codemirror/state'
import {EditorView, keymap} from '@codemirror/view'
import {basicSetup} from 'codemirror'
import {sql as sqlLanguage} from '@codemirror/lang-sql'
import {RunScript} from '../wailsjs/go/main/App'
import ResultGrid from './ResultGrid'

const editorTheme = EditorView.theme({
    '&': {
        backgroundColor: 'var(--surface-2)',
        color: 'var(--text-primary)',
        fontSize: '13px',
    },
    '.cm-content': {
        fontFamily: 'var(--font-mono)',
        padding: '8px 0',
    },
    '.cm-gutters': {
        backgroundColor: 'var(--surface-2)',
        color: 'var(--text-muted)',
        border: 'none',
    },
    '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--accent-fill) 8%, transparent)',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--accent-fill)',
    },
    '.cm-cursor': {
        borderLeftColor: 'var(--text-primary)',
    },
    '&.cm-focused': {
        outline: 'none',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--accent-fill) 25%, transparent)',
    },
})

function firstLine(text) {
    const line = text.trim().split('\n')[0]
    return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

function Statement({index, stmt}) {
    const failed = Boolean(stmt.error)
    const hasRows = stmt.columns.length > 0
    const summary = failed
        ? 'failed'
        : hasRows
            ? `${stmt.rowCount} ${stmt.rowCount === 1 ? 'row' : 'rows'} · ${stmt.durationMs} ms`
            : `${stmt.affected} ${stmt.affected === 1 ? 'row' : 'rows'} affected · ${stmt.durationMs} ms`

    return (
        <section className={`stmt ${failed ? 'failed' : ''}`}>
            <div className="stmt-head">
                <span className="stmt-index">{index + 1}</span>
                <code className="stmt-sql" title={stmt.sql}>{firstLine(stmt.sql)}</code>
                <span className="stmt-meta">{summary}</span>
            </div>
            {failed ? (
                <pre className="error-panel">{stmt.error}</pre>
            ) : hasRows ? (
                <ResultGrid
                    columns={stmt.columns}
                    emptyText="The statement returned no rows."
                    label={`Statement ${index + 1} results`}
                    rows={stmt.rows}
                />
            ) : (
                <p className="muted small stmt-ok">Statement executed.</p>
            )}
            {stmt.notice && <p className="notice stmt-note">{stmt.notice}</p>}
        </section>
    )
}

export default function SqlEditor({initialText, restoreSeq, history, onTextChange, onRestore, onRan}) {
    const hostRef = useRef(null)
    const viewRef = useRef(null)
    const runRef = useRef(() => {})
    const seenSeq = useRef(restoreSeq)
    const callbacks = useRef({})
    callbacks.current = {onTextChange, onRan}

    const [result, setResult] = useState(null)
    const [error, setError] = useState('')
    const [running, setRunning] = useState(false)
    const [inTransaction, setInTransaction] = useState(true)

    async function run() {
        const view = viewRef.current
        const text = view ? view.state.doc.toString() : initialText
        if (!text.trim() || running) return
        setRunning(true)
        setError('')
        try {
            const scriptResult = await RunScript(text, inTransaction)
            setResult(scriptResult)
            callbacks.current.onRan(text, scriptResult.statements.every((stmt) => !stmt.error))
        } catch (err) {
            setResult(null)
            setError(String(err))
            callbacks.current.onRan(text, false)
        } finally {
            setRunning(false)
        }
    }

    useEffect(() => {
        runRef.current = run
    })

    useEffect(() => {
        const view = new EditorView({
            parent: hostRef.current,
            state: EditorState.create({
                doc: initialText,
                extensions: [
                    keymap.of([{
                        key: 'Mod-Enter',
                        run: () => {
                            runRef.current()
                            return true
                        },
                    }]),
                    basicSetup,
                    sqlLanguage(),
                    editorTheme,
                    EditorView.lineWrapping,
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            callbacks.current.onTextChange(update.state.doc.toString())
                        }
                    }),
                ],
            }),
        })
        viewRef.current = view
        return () => {
            view.destroy()
            viewRef.current = null
        }
    }, [])

    useEffect(() => {
        const view = viewRef.current
        if (!view || restoreSeq === seenSeq.current) return
        seenSeq.current = restoreSeq
        view.dispatch({
            changes: {from: 0, to: view.state.doc.length, insert: initialText},
        })
        view.focus()
    }, [restoreSeq])

    const summary = result === null
        ? ''
        : `${result.statements.length} ${result.statements.length === 1 ? 'statement' : 'statements'} · ${result.durationMs} ms`
            + (result.rolledBack ? ' · rolled back' : result.inTransaction ? ' · committed' : '')

    return (
        <div className="sql-view">
            <div className="sql-editor" ref={hostRef}/>

            <div className="grid-toolbar">
                <button
                    className={`primary ${running ? 'busy' : ''}`}
                    disabled={running}
                    onClick={run}
                    type="button"
                >
                    {running && <span className="spinner" aria-hidden="true"/>}
                    {running ? 'Running…' : 'Run'}
                </button>
                <label
                    className="check tx-toggle"
                    title={inTransaction
                        ? 'Every statement commits together; one failure rolls the script back.'
                        : 'Each statement commits on its own; earlier statements stay if a later one fails.'}
                >
                    <input
                        checked={inTransaction}
                        disabled={running}
                        onChange={(event) => setInTransaction(event.target.checked)}
                        type="checkbox"
                    />
                    One transaction
                </label>
                <span className="muted small">Ctrl+Enter</span>
                {summary && <span className="muted small" role="status">{summary}</span>}
            </div>

            {error && <pre className="error-panel">{error}</pre>}
            {result?.error && <pre className="error-panel">{result.error}</pre>}
            {result?.rolledBack && (
                <p className="script-banner" role="status">
                    Rolled back — the script failed, so no changes were kept.
                </p>
            )}

            {result !== null && result.statements.length > 0 && (
                <div className="script-results">
                    {result.statements.map((stmt, index) => (
                        <Statement index={index} key={index} stmt={stmt}/>
                    ))}
                </div>
            )}

            {history.length > 0 && (
                <div className="sql-history">
                    <h3>History</h3>
                    {history.map((entry, index) => (
                        <button
                            className={`history-item ${entry.ok ? '' : 'failed'}`}
                            key={`${index}-${entry.sql}`}
                            onClick={() => onRestore(entry.sql)}
                            title={entry.sql}
                            type="button"
                        >
                            {firstLine(entry.sql)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
