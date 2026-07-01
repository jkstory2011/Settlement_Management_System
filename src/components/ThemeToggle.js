'use client'

import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    localStorage.setItem('theme', next)
  }

  return (
    <button
      onClick={toggle}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-900 hover:text-slate-200"
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
          <path d="M17 10.5A7 7 0 1 1 9.5 3a5.5 5.5 0 0 0 7.5 7.5Z" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 shrink-0">
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 2v2M10 16v2M3.5 10h-2M18.5 10h-2M5.3 5.3 4 4M16 16l-1.3-1.3M14.7 5.3 16 4M4 16l1.3-1.3" strokeLinecap="round" />
        </svg>
      )}
      {theme === 'dark' ? '다크 모드' : '라이트 모드'}
    </button>
  )
}
