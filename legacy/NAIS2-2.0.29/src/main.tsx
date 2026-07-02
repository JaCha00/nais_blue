import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import './i18n'
import { cleanupLargeData } from './lib/indexed-db'

// Cleanup large wildcard data before app starts (migration fix)
cleanupLargeData('nais2-wildcards', 100).then((cleaned) => {
    if (cleaned) {
        console.log('[Startup] Large wildcard data was cleaned up')
    }
})

// Hide splash screen when React is ready
const hideSplash = () => {
    const splash = document.getElementById('splash-screen')
    if (splash) {
        splash.classList.add('fade-out')
        setTimeout(() => splash.remove(), 500)
    }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

// Delay slightly to ensure app renders, then hide splash
requestAnimationFrame(() => {
    requestAnimationFrame(hideSplash)
})
