import Card from './Card'
import Badge from './Badge'

const VALUE_TONE = {
  accent: 'text-cyan-600 dark:text-cyan-400',
  warn: 'text-amber-600 dark:text-amber-400',
  default: 'text-slate-900 dark:text-slate-100',
}

export default function KpiCard({ label, value, unit, sub, tone = 'default', status }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-500">{label}</p>
      <p className={`tabular mt-1.5 text-xl font-semibold ${VALUE_TONE[tone]}`}>
        {value}
        {unit && <span className="ml-0.5 text-sm font-normal text-slate-400 dark:text-slate-500">{unit}</span>}
      </p>
      {sub && <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-500">{sub}</p>}
      {status && (
        <div className="mt-1.5">
          <Badge status={status} />
        </div>
      )}
    </Card>
  )
}
