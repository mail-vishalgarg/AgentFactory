import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import AgentBuilder from './pages/AgentBuilder'
import AgentDetail from './pages/AgentDetail'
import Connections from './pages/Connections'
import LoginPage from './pages/LoginPage'
import Marketplace from './pages/Marketplace'
import MarketplaceListingDetail from './pages/MarketplaceListingDetail'
import MCPRegistry from './pages/MCPRegistry'
import MyAgents from './pages/MyAgents'
import SignupPage from './pages/SignupPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/mcp" replace />} />
          <Route path="mcp" element={<MCPRegistry />} />
          <Route path="build" element={<AgentBuilder />} />
          <Route path="agents" element={<MyAgents />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="agents/:id/playground" element={<AgentDetail />} />
          <Route path="connections" element={<Connections />} />
          <Route path="marketplace" element={<Marketplace />} />
          <Route path="marketplace/:id" element={<MarketplaceListingDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
