import Link from 'next/link'

const menu = [
  { href: '/monthly-fees', title: '월 택배비 수정', desc: 'CJ대한통운 등 월별 원본 내역서 업로드 및 화주사별 정산 금액 검토/수정' },
  { href: '/shippers', title: '화주사 관리', desc: '정식 계약 화주사 마스터 및 구간별 계약 단가표 관리' },
]

export default function HomePage() {
  return (
    <main>
      <h1 className="mb-6 text-2xl font-bold">정산관리프로그램</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {menu.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-400 hover:shadow"
          >
            <h2 className="mb-1 text-lg font-semibold">{m.title}</h2>
            <p className="text-sm text-gray-500">{m.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  )
}
