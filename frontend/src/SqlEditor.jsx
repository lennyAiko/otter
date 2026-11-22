import {useEffect, useRef, useState} from 'react'
import {EditorState} from '@codemirror/state'
import {EditorView, keymap} from '@codemirror/view'
import {basicSetup} from 'codemirror'
import {sql as sqlLanguage} from '@codemirror/lang-sql'
import {RunQuery} from '../wailsjs/go/main/App'
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

    async function run() {
        const view = viewRef.current
        const text = view ? view.state.doc.toString() : initialText
        if (!text.trim() || running) return
        setRunning(true)
        setError('')
        try {
            const rows = await RunQuery(text)
            setResult(rows)
            callbacks.current.onRan(text, true)
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

    const hasRows = result !== null && result.columns.length > 0
    const summary = result === null
        ? ''
        : hasRows
            ? `${result.rowCount} ${result.rowCount === 1 ? 'row' : 'rows'} · ${result.durationMs} ms`
            : `${result.affected} ${result.affected === 1 ? 'row' : 'rows'} affected · ${result.durationMs} ms`

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
                <span className="muted small">Ctrl+Enter</span>
                {summary && <span className="muted small" role="status">{summary}</span>}
                {result?.notice && <span className="notice">{result.notice}</span>}
            </div>

            {error && <pre className="error-panel">{error}</pre>}

            {hasRows && (
                <ResultGrid
                    columns={result.columns}
                    emptyText="The statement returned no rows."
                    rows={result.rows}
                />
            )}
            {result !== null && !hasRows && !error && (
                <p className="muted small">Statement executed.</p>
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
