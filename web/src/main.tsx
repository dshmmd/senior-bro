import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error)
      return (
        <div className="shell">
          <div className="card">
            <b>Something broke on our side.</b>
            <p style={{ color: 'var(--muted)' }}>{this.state.error.message}</p>
            <button onClick={() => window.location.reload()}>Reload the app</button>
          </div>
        </div>
      )
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
