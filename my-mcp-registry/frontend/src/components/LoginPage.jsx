import React, { useState } from "react"

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [selectedRole, setSelectedRole] = useState("admin")
  const [error, setError] = useState("")

  const handleQuickLogin = (role) => {
    if (role === "admin") {
      onLogin({
        id: "usr-admin",
        name: "Admin User",
        email: "admin@datasense.ai",
        role: "admin",
        avatar: "AD",
        org: "Platform Engineering"
      })
    } else {
      onLogin({
        id: "usr-regular",
        name: "Priya Raman",
        email: "user@datasense.ai",
        role: "user",
        avatar: "PR",
        org: "Product Team"
      })
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email.trim()) {
      setError("Please enter your email address")
      return
    }

    // Determine role automatically from email or role selector
    let detectedRole = selectedRole
    if (email.toLowerCase().includes("admin")) {
      detectedRole = "admin"
    } else if (email.toLowerCase().includes("user") || email.toLowerCase().includes("priya")) {
      detectedRole = "user"
    }

    onLogin({
      id: "usr-" + Date.now(),
      name: email.split("@")[0],
      email: email.trim(),
      role: detectedRole,
      avatar: email.substring(0, 2).toUpperCase(),
      org: detectedRole === "admin" ? "Platform Engineering" : "Product Team"
    })
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo-mark">⚡</div>
          <h2 className="login-title">MCP Registry Access</h2>
          <p className="login-subtitle">
            Role-Based Authentication & Permissions Management
          </p>
        </div>

        {error && <div className="login-error-banner">{error}</div>}

        {/* 1-Click Fast Role Selection */}
        <div className="role-cards-container">
          <div
            className="role-card admin"
            onClick={() => handleQuickLogin("admin")}
          >
            <div className="role-card-badge admin-badge">👑 Administrator</div>
            <h3 className="role-card-title">Admin Login</h3>
            <p className="role-card-desc">
              Full control. Has the <strong>Register Server</strong> option and full visibility into all server details, connections, and environment variables.
            </p>
            <div className="role-features">
              <span>✓ + Register MCP Server available</span>
              <span>✓ Server details & telemetry visible</span>
              <span>✓ Delete & manage servers</span>
            </div>
            <button className="btn-role-login admin">
              Sign in as Admin →
            </button>
          </div>

          <div
            className="role-card user"
            onClick={() => handleQuickLogin("user")}
          >
            <div className="role-card-badge user-badge">👤 Standard User</div>
            <h3 className="role-card-title">User Login</h3>
            <p className="role-card-desc">
              Consumer view. Browse 15 servers and 153 tools, copy client configs, and access token links. <strong>Register server option is disabled</strong>.
            </p>
            <div className="role-features">
              <span>✕ Register server option hidden</span>
              <span>✓ Browse all 15 servers & 153 tools</span>
              <span>✓ 1-Click Claude / Cursor / LangGraph</span>
            </div>
            <button className="btn-role-login user">
              Sign in as User →
            </button>
          </div>
        </div>

        <div className="login-divider">
          <span>OR SIGN IN WITH CREDENTIALS</span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              placeholder="admin@datasense.ai or user@datasense.ai"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (e.target.value.toLowerCase().includes("admin")) setSelectedRole("admin")
                if (e.target.value.toLowerCase().includes("user")) setSelectedRole("user")
              }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Assign Role</label>
            <select
              className="form-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              <option value="admin">👑 Administrator (Register Servers & View Details)</option>
              <option value="user">👤 Regular User (View Only - No Registration)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary-login">
            Sign In with {selectedRole === "admin" ? "Admin Privileges" : "User Access"}
          </button>
        </form>
      </div>
    </div>
  )
}
