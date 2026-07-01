export default function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
