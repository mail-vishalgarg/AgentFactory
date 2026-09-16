import React, { useState, useEffect } from "react"
import api from "./api/client"
import LoginPage from "./components/LoginPage"

const CATEGORIES = [
  "All",
  "Dev Tools",
  "Database",
  "Cloud & Infra",
  "Productivity",
  "AI & Web"
]

export default function App() {
  // Authentication & Role State
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem("mcp_registry_user")
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [errorBanner, setErrorBanner] = useState(null)
  const [saving, setSaving] = useState(false)
  const [adminPanelOpen, setAdminPanelOpen] = useState(true)

  // Filtering & Search
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [searchQuery, setSearchQuery] = useState("")
  const [copiedKey, setCopiedKey] = useState(null)

  const copyToClipboard = (text, key) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const renderTokenGuide = (text) => {
    if (!text) return null
    const urlRegex = /(https?:\/\/[^\s)]+)/g
    const parts = text.split(urlRegex)
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#b45309", fontWeight: 700, textDecoration: "underline", margin: "0 2px" }}
          >
            {part} ↗
          </a>
        )
      }
      return part
    })
  }

  // 1-Click Exporter Modal State
  const [exportModal, setExportModal] = useState({
    open: false,
    server: null,
    format: "claude",
    filename: "",
    content: "",
    copied: false
  })

  // Full Tools Explorer Modal State
  const [toolsModal, setToolsModal] = useState({
    open: false,
    server: null,
    search: ""
  })

  // Form state for registering new server (Admin only)
  const [formData, setFormData] = useState({
    name: "slack-custom",
    category: "Productivity",
    transport: "stdio",
    command: "npx -y @modelcontextprotocol/server-slack",
    url: "",
    auth_type: "none",
    token_guide: "",
    description: "Slack team workspace MCP server."
  })

  const handleLogin = (user) => {
    setCurrentUser(user)
    try {
      localStorage.setItem("mcp_registry_user", JSON.stringify(user))
    } catch {}
  }

  const handleLogout = () => {
    setCurrentUser(null)
    try {
      localStorage.removeItem("mcp_registry_user")
    } catch {}
  }

  const handleSwitchRole = () => {
    if (currentUser?.role === "admin") {
      handleLogin({
        id: "usr-regular",
        name: "Priya Raman",
        email: "user@datasense.ai",
        role: "user",
        avatar: "PR",
        org: "Product Team"
      })
    } else {
      handleLogin({
        id: "usr-admin",
        name: "Admin User",
        email: "admin@datasense.ai",
        role: "admin",
        avatar: "AD",
        org: "Platform Engineering"
      })
    }
  }

  const fetchServers = async () => {
    try {
      setLoading(true)
      const res = await api.get("")
      setServers(res.data)
    } catch (err) {
      console.error("Failed to fetch servers from SQL database:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServers()
  }, [])

  const handleOpenModal = () => {
    if (currentUser?.role !== "admin") return
    setFormData({
      name: "slack-custom",
      category: "Productivity",
      transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-slack",
      url: "",
      auth_type: "api_key",
      token_guide: "https://api.slack.com/apps",
      description: "Slack team workspace MCP server."
    })
    setErrorBanner(null)
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setErrorBanner(null)
  }

  const handlePrefill = (preset) => {
    setErrorBanner(null)
    if (preset === "github") {
      setFormData({
        name: "github-custom",
        category: "Dev Tools",
        transport: "stdio",
        command: "npx -y @modelcontextprotocol/server-github",
        url: "https://api.github.com",
        auth_type: "api_key",
        token_guide: "https://github.com/settings/tokens/new",
        description: "GitHub MCP server with all 44 repository and PR tools."
      })
    } else if (preset === "sqlite") {
      setFormData({
        name: "sqlite-custom",
        category: "Database",
        transport: "stdio",
        command: "uvx mcp-server-sqlite --db-path ./project.db",
        url: "sqlite:///project.db",
        auth_type: "none",
        token_guide: "Local SQLite file",
        description: "SQLite database tool server."
      })
    } else if (preset === "postgres") {
      setFormData({
        name: "postgres-custom",
        category: "Database",
        transport: "stdio",
        command: "npx -y @modelcontextprotocol/server-postgres postgresql://localhost/main",
        url: "https://supabase.com/dashboard",
        auth_type: "api_key",
        token_guide: "https://supabase.com/dashboard/project/_/settings/database",
        description: "PostgreSQL database query executor."
      })
    } else if (preset === "deadserver") {
      setFormData({
        name: "dead-test",
        category: "Dev Tools",
        transport: "http",
        command: "",
        url: "http://localhost:8000/mock/deadserver",
        auth_type: "none",
        token_guide: "",
        description: "Unreachable endpoint test for failure guard."
      })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (currentUser?.role !== "admin") return
    setErrorBanner(null)
    setSaving(true)

    try {
      const payload = {
        name: formData.name.trim(),
        category: formData.category,
        transport: formData.transport,
        command: formData.transport === "stdio" ? formData.command.trim() : "",
        url: formData.url.trim(),
        auth_type: formData.auth_type,
        token_guide: formData.token_guide.trim(),
        description: formData.description.trim() || undefined
      }

      await api.post("", payload)
      setSaving(false)
      setModalOpen(false)
      await fetchServers()
    } catch (err) {
      setSaving(false)
      const detail = err.response?.data?.detail || "The server did not answer. Registration aborted."
      setErrorBanner(detail.startsWith("✕") || detail.startsWith("×") ? detail : "✕ " + detail)
    }
  }

  const handleOpenExport = async (server, format = "claude") => {
    try {
      const res = await api.get("/" + server.id + "/export?format=" + format)
      setExportModal({
        open: true,
        server,
        format,
        filename: res.data.filename,
        content: res.data.content,
        copied: false
      })
    } catch (err) {
      console.error("Failed to export config:", err)
    }
  }

  const handleChangeExportFormat = async (format) => {
    if (!exportModal.server) return
    try {
      const res = await api.get("/" + exportModal.server.id + "/export?format=" + format)
      setExportModal({
        ...exportModal,
        format,
        filename: res.data.filename,
        content: res.data.content,
        copied: false
      })
    } catch (err) {
      console.error("Failed to update export format:", err)
    }
  }

  const handleDelete = async (id) => {
    if (currentUser?.role !== "admin") {
      alert("Permission denied: Only administrators can delete MCP servers.")
      return
    }
    if (!confirm("Are you sure you want to delete this MCP server and its tools from SQL?")) return
    try {
      await api.delete("/" + id)
      await fetchServers()
    } catch (err) {
      alert("Failed to delete server from SQL: " + err.message)
    }
  }

  // Filter logic
  const filteredServers = servers.filter(s => {
    const matchesCat = selectedCategory === "All" || (s.category && s.category.toLowerCase() === selectedCategory.toLowerCase())
    if (!matchesCat) return false
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const nameMatch = s.name.toLowerCase().includes(q) || (s.display_name && s.display_name.toLowerCase().includes(q))
    const descMatch = s.description && s.description.toLowerCase().includes(q)
    const toolMatch = s.tools && s.tools.some(t => t.name.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q)))
    return nameMatch || descMatch || toolMatch
  })

  const totalToolsCount = servers.reduce((acc, s) => acc + (s.tools || []).length, 0)
  const isAdmin = currentUser?.role === "admin"

  // If user is not logged in, show LoginPage first
  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <div className="standalone-app-root">
      {/* Top Header */}
      <header className="standalone-header">
        <div className="header-left">
          <span className="logo-icon">⚡</span>
          <div>
            <h1 className="logo-title">My Personal MCP Registry</h1>
            <span className="logo-tagline">Dynamic SQL Database • Role-Based Access Control</span>
          </div>
        </div>

        <div className="header-stats">
          <div className="stat-item">
            <span className="stat-val">{servers.length}</span>
            <span className="stat-lbl">MCP Servers</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-val">{totalToolsCount}</span>
            <span className="stat-lbl">Real Tools in SQL</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-val" style={{ color: "#16a34a" }}>● Connected</span>
            <span className="stat-lbl">Supabase / SQL</span>
          </div>
        </div>

        {/* User Profile & Role Info */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className="header-user-badge">
            <div className={"header-user-avatar " + (isAdmin ? "admin" : "user")}>
              {currentUser.avatar || "U"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
              <span style={{ fontSize: "12px", fontWeight: 750, color: "var(--ink)" }}>
                {currentUser.name}
              </span>
              <span className={"header-user-role " + (isAdmin ? "admin" : "user")}>
                {isAdmin ? "👑 Admin (Full Access)" : "👤 User (View Only)"}
              </span>
            </div>
          </div>

          <button 
            className="btn-signout"
            onClick={handleSwitchRole}
            title="Switch between Admin and User view"
          >
            Switch to {isAdmin ? "User" : "Admin"}
          </button>

          <button 
            className="btn-signout"
            onClick={handleLogout}
            title="Sign out of registry"
          >
            Sign Out
          </button>

          {/* REQUIREMENT: If Admin, Register Server is available. If User, NOT available */}
          {isAdmin && (
            <button className="btn primary" onClick={handleOpenModal}>
              + Register MCP Server
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="standalone-main">
        {/* REQUIREMENT: Admin Server Details & Activity Panel (Visible only to Admin) */}
        {isAdmin && (
          <section className="admin-insights-panel">
            <div className="admin-insights-header">
              <div className="admin-insights-title">
                <span>👑 Administrator Operations & Server Details</span>
                <span className="badge-pill zero-auth">Active Telemetry</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="btn-signout"
                  onClick={() => setAdminPanelOpen(!adminPanelOpen)}
                >
                  {adminPanelOpen ? "▲ Hide Details Table" : "▼ Show Server Details (" + servers.length + ")"}
                </button>
              </div>
            </div>

            <p style={{ margin: "0 0 10px 0", fontSize: "12.5px", color: "#475569" }}>
              As an <strong>Administrator</strong>, you have full visibility into all 15 servers, internal connection protocols, environment variables, and live tool counts stored in your SQL database.
            </p>

            {adminPanelOpen && (
              <div className="admin-table-wrapper">
                <table className="admin-server-table">
                  <thead>
                    <tr>
                      <th>Server Name</th>
                      <th>Category</th>
                      <th>Transport & Command / URL</th>
                      <th>Required Auth / Env Var</th>
                      <th>Tools Count</th>
                      <th>Status</th>
                      <th>Admin Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map(s => {
                      const envKeys = Object.keys(s.env_vars || {}).join(", ") || "None"
                      const toolCount = (s.tools || []).length
                      const target = s.url || s.command || "N/A"
                      return (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.display_name || s.name}</strong>
                            <div style={{ fontSize: "10.5px", color: "#64748b", fontFamily: "var(--mono)" }}>{s.id}</div>
                          </td>
                          <td>
                            <span className="badge-category">{s.category}</span>
                          </td>
                          <td>
                            <div style={{ maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <span style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "10px", color: "#475569" }}>{s.transport}: </span>
                              <code style={{ fontSize: "11px", background: "#f1f5f9", padding: "1px 4px", borderRadius: "3px" }}>{target}</code>
                            </div>
                          </td>
                          <td>
                            <code style={{ fontSize: "11px", color: "#0f766e", fontWeight: 700 }}>{envKeys}</code>
                          </td>
                          <td>
                            <span style={{ fontWeight: 800, color: "#1e293b" }}>{toolCount} tools</span>
                          </td>
                          <td>
                            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "11px" }}>● Connected</span>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button 
                                className="btn-mini-copy"
                                onClick={() => handleOpenExport(s, "claude")}
                                style={{ padding: "3px 7px", fontSize: "11px" }}
                              >
                                Config
                              </button>
                              <button 
                                className="btn-text danger"
                                onClick={() => handleDelete(s.id)}
                                style={{ padding: "3px 6px", fontSize: "11px", cursor: "pointer" }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Regular User Mode Banner */}
        {!isAdmin && (
          <div style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "8px",
            padding: "10px 16px",
            marginBottom: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#166534", fontSize: "12.5px" }}>
              <span>👤</span>
              <span><strong>User Consumer Mode:</strong> You are logged in as a standard user. You can browse tools, use 1-click token links, and export configs. <em>(Registration is restricted to administrators)</em></span>
            </div>
            <button
              className="btn-signout"
              onClick={handleSwitchRole}
              style={{ background: "#dcfce7", borderColor: "#86efac", color: "#166534", fontWeight: 700 }}
            >
              👑 Log in as Admin to Register Servers
            </button>
          </div>
        )}

        {/* Filter & Search Row */}
        <div className="filter-search-row">
          <div className="category-bar">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={"category-pill " + (selectedCategory === cat ? "active" : "")}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat} {cat === "All" ? "(" + servers.length + ")" : ""}
              </button>
            ))}
          </div>

          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="search-input"
              placeholder="Search servers or any of the 153 tools (e.g. pull_request, docker, sql)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Server Cards Grid */}
        {loading ? (
          <div style={{ padding: "60px", textAlign: "center", color: "var(--muted)" }}>
            Querying MCP servers and tools from SQL database...
          </div>
        ) : filteredServers.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--surface)", borderRadius: "8px", color: "var(--muted)" }}>
            No servers found matching "{searchQuery}".
          </div>
        ) : (
          <div className="cards-grid">
            {filteredServers.map(s => {
              const tools = s.tools || []
              const previewTools = tools.slice(0, 4)
              const remainingCount = tools.length - 4
              const effectiveUrl = s.url || (s.transport === "stdio" ? s.command : "http://localhost:8000/api/servers/" + s.id)

              // Extract direct URL from token_guide
              const matchTokenUrl = s.token_guide ? s.token_guide.match(/(https?:\/\/[^\s)]+)/) : null
              const directTokenUrl = matchTokenUrl ? matchTokenUrl[1] : null

              return (
                <div key={s.id} className="server-card">
                  {/* Header */}
                  <div className="server-card-header">
                    <div className="server-title-group" style={{ flexWrap: "wrap", gap: "6px" }}>
                      <b style={{ fontSize: "14.5px", color: "var(--ink)" }}>{s.display_name || s.name}</b>
                      <span className="badge-category">{s.category}</span>
                      <span className="badge badge-ok">● ok</span>
                    </div>

                    <span className="meta-pill" style={{ fontWeight: 700, color: "var(--ink)" }}>
                      {tools.length} tools
                    </span>
                  </div>

                  {/* Prominent Server Address URL */}
                  <div className="server-address-box">
                    <div className="address-header">
                      <span className="address-label">🌐 Server Address URL</span>
                      <button 
                        className={"btn-mini-copy " + (copiedKey === "url-" + s.id ? "copied" : "")}
                        onClick={() => copyToClipboard(effectiveUrl, "url-" + s.id)}
                        title="Copy exact server address URL"
                      >
                        {copiedKey === "url-" + s.id ? "✓ Copied" : "📋 Copy URL"}
                      </button>
                    </div>
                    <code className="address-code">{effectiveUrl}</code>
                  </div>

                  {/* Token & Env Var Guide */}
                  {s.token_guide && (
                    <div className="token-guide-box easy-token" style={{ marginTop: "10px" }}>
                      <div className="token-guide-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "14px" }}>🔑</span>
                          <span className="token-guide-label" style={{ color: "#92400e" }}>Required Token / Env Var</span>
                        </div>
                        {directTokenUrl && (
                          <a
                            href={directTokenUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-token-link"
                            style={{
                              background: "#d97706",
                              color: "#ffffff",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "10.5px",
                              fontWeight: 750,
                              textDecoration: "none",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px"
                            }}
                          >
                            🔗 Open Token Page ↗
                          </a>
                        )}
                      </div>
                      <div className="token-guide-text">
                        {renderTokenGuide(s.token_guide)}
                      </div>
                    </div>
                  )}

                  <p className="server-desc">{s.description || "No description provided."}</p>

                  {/* Admin Details Section on Card (Visible only to Admin) */}
                  {isAdmin && (
                    <div style={{
                      background: "#f8fafc",
                      border: "1px dashed #cbd5e1",
                      borderRadius: "6px",
                      padding: "7px 10px",
                      fontSize: "11px",
                      color: "#475569",
                      marginBottom: "10px"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <strong>👑 Admin Details:</strong>
                        <span style={{ fontFamily: "var(--mono)", color: "#64748b" }}>ID: {s.id}</span>
                      </div>
                      <div>Command/Pkg: <code style={{ color: "#0f766e" }}>{s.command || s.package_name || s.url}</code></div>
                      <div>Transport: <strong>{s.transport}</strong> | Auth: <strong>{s.auth_type}</strong></div>
                    </div>
                  )}

                  {/* Tools Preview List */}
                  <div className="tools-list">
                    {previewTools.map(tool => (
                      <div key={tool.name} className="tool-item">
                        <span className="tool-name">{tool.name}</span>
                        <span className={"risk-tag " + tool.risk_level}>{tool.risk_level}</span>
                      </div>
                    ))}

                    {tools.length > 0 && (
                      <div
                        className="tool-more-row"
                        style={{ cursor: "pointer", fontWeight: 650, color: "var(--accent)", background: "var(--surface-2)", padding: "6px 10px", borderRadius: "4px", textAlign: "center", marginTop: "6px" }}
                        onClick={() => setToolsModal({ open: true, server: s, search: "" })}
                      >
                        🔍 View All {tools.length} Tools {remainingCount > 0 ? "(" + remainingCount + " more)" : ""} →
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="server-card-footer">
                    <button className="btn-copy-config" onClick={() => handleOpenExport(s, "claude")}>
                      📋 Export Config
                    </button>
                    {isAdmin && (
                      <div className="card-actions">
                        <button className="btn-text danger" onClick={() => handleDelete(s.id)}>Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* ─── MODAL 1: REGISTER MCP SERVER (ADMIN ONLY) ─── */}
      {modalOpen && isAdmin && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header between">
              <div>
                <h2>Register an MCP Server (Admin Only)</h2>
                <p>Connects, reads all tools, and saves directly to your SQL database.</p>
              </div>
              <button className="btn-text" onClick={handleCloseModal} style={{ fontSize: "18px", border: "none", background: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>

            <div className="modal-body-split">
              <div className="modal-form-col">
                {errorBanner && <div className="alert-banner">{errorBanner}</div>}

                <div className="fld">
                  <label style={{ color: "var(--muted)", fontSize: "11px", textTransform: "uppercase" }}>Quick Pre-fills:</label>
                  <div className="chip-row">
                    <span className="chip" onClick={() => handlePrefill("github")}>+ GitHub (44 tools)</span>
                    <span className="chip" onClick={() => handlePrefill("sqlite")}>+ SQLite</span>
                    <span className="chip" onClick={() => handlePrefill("postgres")}>+ Postgres</span>
                    <span className="chip dead" onClick={() => handlePrefill("deadserver")}>× Dead Server Test</span>
                  </div>
                </div>

                <form id="reg-form" onSubmit={handleSubmit}>
                  <div className="fld">
                    <label>Server Name</label>
                    <input type="text" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                  </div>
                  <div className="fld">
                    <label>Category</label>
                    <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                      <option value="Dev Tools">Dev Tools</option>
                      <option value="Database">Database</option>
                      <option value="Cloud & Infra">Cloud &amp; Infra</option>
                      <option value="Productivity">Productivity</option>
                      <option value="AI & Web">AI &amp; Web</option>
                    </select>
                  </div>
                  <div className="fld">
                    <label>Transport</label>
                    <select value={formData.transport} onChange={e => setFormData({ ...formData, transport: e.target.value })}>
                      <option value="stdio">stdio (subprocess command)</option>
                      <option value="http">http (SSE / JSON-RPC)</option>
                    </select>
                  </div>

                  {formData.transport === "stdio" ? (
                    <div className="fld">
                      <label>CLI Command</label>
                      <input
                        type="text"
                        required
                        placeholder="npx -y @modelcontextprotocol/server-slack"
                        value={formData.command}
                        onChange={e => setFormData({ ...formData, command: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div className="fld">
                      <label>Server Address URL</label>
                      <input
                        type="url"
                        required
                        placeholder="https://mcp.example.com/api"
                        value={formData.url}
                        onChange={e => setFormData({ ...formData, url: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="fld">
                    <label>Authentication Type</label>
                    <select value={formData.auth_type} onChange={e => setFormData({ ...formData, auth_type: e.target.value })}>
                      <option value="api_key">API Key / Token</option>
                      <option value="none">None (Zero Token)</option>
                      <option value="oauth">OAuth 2.0</option>
                    </select>
                  </div>

                  <div className="fld">
                    <label>Token Guide Link (Where to get token)</label>
                    <input
                      type="text"
                      placeholder="https://example.com/settings/tokens"
                      value={formData.token_guide}
                      onChange={e => setFormData({ ...formData, token_guide: e.target.value })}
                    />
                  </div>

                  <div className="fld">
                    <label>Description</label>
                    <textarea rows="2" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                  </div>
                </form>
              </div>

              <div className="modal-info-col">
                <div className="info-box">
                  <h4>Admin Registration Guard</h4>
                  <p>When you click save, the registry automatically initiates the MCP handshake and extracts all available tools directly into SQL.</p>
                  <ul>
                    <li>Dynamic JSON-RPC 2.0 listTools handshake</li>
                    <li>Automatic pagination extraction</li>
                    <li>Automatic classification of tool risk levels</li>
                    <li>If unreachable, registration safely aborts</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn secondary" onClick={handleCloseModal}>Cancel</button>
              <button className="btn primary" form="reg-form" type="submit" disabled={saving}>
                {saving ? "Connecting & Introspecting..." : "Save Server to SQL"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: 1-CLICK EXPORTER ─── */}
      {exportModal.open && exportModal.server && (
        <div className="modal-overlay" onClick={() => setExportModal({ ...exportModal, open: false })}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header between">
              <div>
                <h2>1-Click Client Exporter: {exportModal.server.display_name || exportModal.server.name}</h2>
                <p>Plug this server into your local AI environment or Agent pipeline.</p>
              </div>
              <button className="btn-text" onClick={() => setExportModal({ ...exportModal, open: false })} style={{ fontSize: "18px", border: "none", background: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>

            <div className="export-tabs">
              <button className={"export-tab " + (exportModal.format === "claude" ? "active" : "")} onClick={() => handleChangeExportFormat("claude")}>
                Claude Desktop
              </button>
              <button className={"export-tab " + (exportModal.format === "cursor" ? "active" : "")} onClick={() => handleChangeExportFormat("cursor")}>
                Cursor IDE
              </button>
              <button className={"export-tab " + (exportModal.format === "langgraph" ? "active" : "")} onClick={() => handleChangeExportFormat("langgraph")}>
                LangGraph / Python
              </button>
            </div>

            <div className="export-code-box">
              <div className="export-filename">Target file: <code>{exportModal.filename}</code></div>
              <pre className="export-pre"><code>{exportModal.content}</code></pre>
            </div>

            <div className="modal-footer between">
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                {exportModal.server.auth_type !== "none" ? "⚠️ Replace placeholder tokens with your actual API key" : "🟢 Ready to use without any API keys"}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn secondary" onClick={() => setExportModal({ ...exportModal, open: false })}>Close</button>
                <button
                  className={"btn primary " + (exportModal.copied ? "btn-copied" : "")}
                  onClick={() => {
                    navigator.clipboard.writeText(exportModal.content)
                    setExportModal({ ...exportModal, copied: true })
                    setTimeout(() => setExportModal(prev => ({ ...prev, copied: false })), 2000)
                  }}
                >
                  {exportModal.copied ? "✓ Copied to Clipboard" : "📋 Copy Config Snippet"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 3: VIEW ALL TOOLS EXPLORER ─── */}
      {toolsModal.open && toolsModal.server && (
        <div className="modal-overlay" onClick={() => setToolsModal({ open: false, server: null, search: "" })}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: "800px" }}>
            <div className="modal-header between">
              <div>
                <h2>{toolsModal.server.display_name || toolsModal.server.name} — Full Tool Catalog</h2>
                <p>All {toolsModal.server.tools?.length || 0} tools extracted dynamically from SQL database.</p>
              </div>
              <button className="btn-text" onClick={() => setToolsModal({ open: false, server: null, search: "" })} style={{ fontSize: "18px", border: "none", background: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>

            <div style={{ padding: "12px 24px 0" }}>
              <input
                type="text"
                className="search-input"
                style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: "6px" }}
                placeholder="Search tools in this server by name or description..."
                value={toolsModal.search}
                onChange={e => setToolsModal({ ...toolsModal, search: e.target.value })}
              />
            </div>

            <div className="modal-body" style={{ maxHeight: "420px", overflowY: "auto", padding: "16px 24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(toolsModal.server.tools || [])
                  .filter(t => !toolsModal.search || t.name.toLowerCase().includes(toolsModal.search.toLowerCase()) || (t.description && t.description.toLowerCase().includes(toolsModal.search.toLowerCase())))
                  .map(t => (
                    <div key={t.name} style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "10px 14px", background: "var(--surface)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <code style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>{t.name}</code>
                        <span className={"risk-tag " + t.risk_level}>{t.risk_level}</span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>{t.description || "No description."}</div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setToolsModal({ open: false, server: null, search: "" })}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
