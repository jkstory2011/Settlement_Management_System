export function Table({ className = '', children }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50">
      <div className="overflow-x-auto">
        <table className={`w-full text-sm ${className}`}>{children}</table>
      </div>
    </div>
  )
}

export function THead({ children }) {
  return (
    <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-500">
      <tr>{children}</tr>
    </thead>
  )
}

export function Th({ className = '', children }) {
  return <th className={`px-4 py-2.5 font-medium ${className}`}>{children}</th>
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">{children}</tbody>
}

export function Tr({ className = '', children, ...props }) {
  return (
    <tr className={`transition hover:bg-slate-50 dark:hover:bg-slate-800/40 ${className}`} {...props}>
      {children}
    </tr>
  )
}

export function Td({ className = '', children, ...props }) {
  return (
    <td className={`px-4 py-2.5 text-slate-700 dark:text-slate-300 ${className}`} {...props}>
      {children}
    </td>
  )
}

export function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
        {children}
      </td>
    </tr>
  )
}
