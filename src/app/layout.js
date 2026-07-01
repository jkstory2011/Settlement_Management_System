import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata = {
  title: '정산관리프로그램',
  description: '화주사 월 정산서 자동화',
}

// localStorage에 저장된 테마를 hydration 전에 반영해 다크/라이트 전환 시 깜빡임 방지
const themeInitScript = `
(function () {
  var stored = localStorage.getItem('theme');
  var isDark = stored ? stored === 'dark' : true;
  document.documentElement.classList.toggle('dark', isDark);
})();
`

export default function RootLayout({ children }) {
  return (
    <html lang="ko" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1600px] px-6 py-8">{children}</div>
          </div>
        </div>
      </body>
    </html>
  )
}
