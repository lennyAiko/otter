import {createContext, useCallback, useContext, useRef, useState} from 'react'

const ToastContext = createContext(() => {})

export function useToast() {
    return useContext(ToastContext)
}

export function ToastProvider({children}) {
    const [toasts, setToasts] = useState([])
    const nextId = useRef(0)

    const notify = useCallback((text) => {
        const id = nextId.current + 1
        nextId.current = id
        setToasts((current) => [...current.slice(-2), {id, text}])
        setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== id))
        }, 3500)
    }, [])

    return (
        <ToastContext.Provider value={notify}>
            {children}
            <div aria-live="polite" className="toasts">
                {toasts.map((toast) => (
                    <button
                        className="toast"
                        key={toast.id}
                        onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                        title="Dismiss"
                        type="button"
                    >
                        {toast.text}
                    </button>
                ))}
            </div>
        </ToastContext.Provider>
    )
}
