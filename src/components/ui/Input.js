const baseClass =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500'

export function Input({ className = '', ...props }) {
  return <input className={`${baseClass} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`${baseClass} ${className}`} {...props}>
      {children}
    </select>
  )
}

export function Label({ className = '', children }) {
  return <label className={`mb-1 block text-xs text-slate-500 dark:text-slate-400 ${className}`}>{children}</label>
}
