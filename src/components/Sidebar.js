'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ThemeToggle from './ThemeToggle'

const NAV_ITEMS = [
  { href: '/', label: '대시보드', icon: DashboardIcon },
  { href: '/upload', label: '데이터 업로드', icon: UploadIcon },
  { href: '/monthly-fees', label: '월 택배운임 수정', icon: TruckIcon },
  { href: '/carriers', label: '택배사 정산양식 관리', icon: SlidersIcon },
  { href: '/shippers', label: '화주사 관리', icon: BuildingIcon },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
      <div className="px-5 py-6">
        <p className="text-xs font-medium uppercase tracking-widest text-cyan-500">Settlement</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-100">정산관리프로그램</p>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                isActive ? 'bg-cyan-500/10 font-medium text-cyan-300' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-slate-800 px-3 py-4">
        <ThemeToggle />
      </div>
    </aside>
  )
}

function DashboardIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  )
}

function UploadIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M10 13V3M10 3l-3.5 3.5M10 3l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13v2.5A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5V13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TruckIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M2 5h9v8H2z" strokeLinejoin="round" />
      <path d="M11 8h4l3 3v2h-7z" strokeLinejoin="round" />
      <circle cx="6" cy="15" r="1.6" />
      <circle cx="15" cy="15" r="1.6" />
    </svg>
  )
}

function SlidersIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 5h12M4 10h12M4 15h12" strokeLinecap="round" />
      <circle cx="8" cy="5" r="1.6" />
      <circle cx="14" cy="10" r="1.6" />
      <circle cx="7" cy="15" r="1.6" />
    </svg>
  )
}

function BuildingIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="4" y="2" width="9" height="16" strokeLinejoin="round" />
      <path d="M13 8h3v10h-3" strokeLinejoin="round" />
      <path d="M7 5.5h1M9.5 5.5h1M7 8.5h1M9.5 8.5h1M7 11.5h1M9.5 11.5h1" strokeLinecap="round" />
    </svg>
  )
}
