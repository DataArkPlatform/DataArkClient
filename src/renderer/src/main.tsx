import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/onboarding.css'
import './styles/toast.css'
import './styles/modal.css'
import './styles/conversations.css'
import './styles/detail.css'
import './styles/trash.css'
import './styles/settings.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
