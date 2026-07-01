import Link from 'next/link'

export default function PageHeader({ eyebrow, title, backHref, backLabel = '목록으로', actions }) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        {eyebrow && <p className="text-xs font-medium uppercase tracking-widest text-cyan-600 dark:text-cyan-500">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {actions}
        {backHref && (
          <Link href={backHref} className="text-sm text-cyan-600 hover:underline dark:text-cyan-400">
            {backLabel}
          </Link>
        )}
      </div>
    </div>
  )
}
