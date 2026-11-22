import {useEffect, useRef} from 'react'

export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onConfirm,
    onCancel,
}) {
    const cancelRef = useRef(null)

    useEffect(() => {
        if (!open) return
        cancelRef.current?.focus()
        function onKey(event) {
            if (event.key === 'Escape') onCancel()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onCancel])

    if (!open) return null

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onCancel()
            }}
        >
            <div aria-labelledby="confirm-title" aria-modal="true" className="modal" role="dialog">
                <h2 id="confirm-title">{title}</h2>
                <p className="muted">{message}</p>
                <div className="actions">
                    <button onClick={onCancel} ref={cancelRef} type="button">{cancelLabel}</button>
                    <button className={danger ? 'danger' : 'primary'} onClick={onConfirm} type="button">
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}
