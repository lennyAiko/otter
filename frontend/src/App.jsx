import {useState} from 'react'
import './App.css'
import ConnectionScreen from './ConnectionScreen'
import Workspace from './Workspace'
import {ToastProvider} from './Toast'
import {Disconnect} from '../wailsjs/go/main/App'

export default function App() {
    const [session, setSession] = useState(null)

    async function back() {
        try {
            await Disconnect()
        } finally {
            setSession(null)
        }
    }

    return (
        <ToastProvider>
            {session
                ? <Workspace info={session} onBack={back}/>
                : <ConnectionScreen onConnected={setSession}/>}
        </ToastProvider>
    )
}
