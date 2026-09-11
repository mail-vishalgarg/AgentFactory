interface Props {
  level: 'read' | 'write' | 'destructive' | string
}

const styles: Record<string, string> = {
  read: 'bg-gray-100 text-gray-600',
  write: 'bg-amber-100 text-amber-800',
  destructive: 'bg-red-100 text-red-800',
}

export default function ToolPermissionBadge({ level }: Props) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[level] ?? styles.read}`}>
      {level}
    </span>
  )
}
