const TONES = {
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20',
  warn: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20',
  danger: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
  accent: 'bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/20',
}

// 배치 상태(done/processing/error) 등을 톤에 자동 매핑
const STATUS_TONE = { done: 'success', processing: 'warn', error: 'danger' }

export default function Badge({ tone, status, className = '', children }) {
  const resolvedTone = tone || STATUS_TONE[status] || 'neutral'
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONES[resolvedTone]} ${className}`}>
      {children ?? status}
    </span>
  )
}
