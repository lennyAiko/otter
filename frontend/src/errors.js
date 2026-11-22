// db.active() returns this exact text when the pool is gone, e.g. after the
// backend restarts under an open window.
const DISCONNECTED = 'not connected'

export function isSessionLost(err) {
    return String(err).toLowerCase().includes(DISCONNECTED)
}
