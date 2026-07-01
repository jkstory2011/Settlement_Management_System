import './globals.css'

export const metadata = {
  title: '정산관리프로그램',
  description: '화주사 월 정산서 자동화',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </body>
    </html>
  )
}
