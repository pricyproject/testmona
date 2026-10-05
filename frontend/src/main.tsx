import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient.ts'
import App from './App.tsx'
import './index.css'

// When a lazily-imported chunk fails to load — typically because Vite changed
// the optimized-deps `?v=` hash (dev re-bundle) or a new build was deployed —
// the stale module URL 404s. Recover by reloading once instead of crashing the
// route into the error boundary. A sessionStorage guard prevents reload loops.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (!sessionStorage.getItem('vite-preload-reloaded')) {
    sessionStorage.setItem('vite-preload-reloaded', '1')
    window.location.reload()
  }
})
window.addEventListener('load', () => {
  sessionStorage.removeItem('vite-preload-reloaded')
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
