import { NavLink } from 'react-router-dom'

interface NavItem {
  label: string
  to: string
}

const workspace: NavItem[] = [
  { label: '+ Build', to: '/build' },
  { label: 'My Agents', to: '/agents' },
  { label: 'MCP Registry', to: '/mcp' },
  { label: 'Connections', to: '/connections' },
]

const shared: NavItem[] = [
  { label: 'Marketplace', to: '/marketplace' },
  { label: 'Admin Review', to: '/admin' },
]

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="mb-4">
      <p className="px-3 text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
        {title}
      </p>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex items-center px-3 py-2 text-sm rounded-md transition-colors ${
              isActive
                ? 'bg-[#e6f7f2] text-[#2e9e7a] font-medium'
                : 'text-gray-600 hover:bg-[#e6f7f2] hover:text-[#2e9e7a]'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="px-4 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: '#2e9e7a' }}
          >
            AF
          </div>
          <span className="text-lg font-bold" style={{ color: '#2e9e7a' }}>
            AgentFactory
          </span>
        </div>
      </div>
      <nav className="flex-1 px-2 py-4 overflow-y-auto">
        <NavGroup title="Workspace" items={workspace} />
        <NavGroup title="Shared" items={shared} />
      </nav>
    </aside>
  )
}
