import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import AgentBuilder from './pages/AgentBuilder'
import AgentDetail from './pages/AgentDetail'
import MCPRegistry from './pages/MCPRegistry'
import MyAgents from './pages/MyAgents'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/mcp" replace />} />
          <Route path="mcp" element={<MCPRegistry />} />
          <Route path="build" element={<AgentBuilder />} />
          <Route path="agents" element={<MyAgents />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="agents/:id/playground" element={<AgentDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
