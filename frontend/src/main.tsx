import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AuthGate from './Auth'
import BrandIntro from './BrandExperience'
import './ProfessionalTheme.css'
import './WorkspacePolish.css'
import './RolePolish.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrandIntro /><AuthGate><App /></AuthGate>
  </StrictMode>,
)
