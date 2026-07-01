'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function HomePage() {
  const [batches, setBatches] = useState([])
  const [shippers, setShippers] = useState([])
  const [latestSummary, setLatestSummary] = useState(null)
  const [repeatUnregisteredCount, setRepeatUnregisteredCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [batchesRes, shippersRes] = await Promise.all([fetch('/api/batches'), fetch('/api/shippers')])
      const batchesJson = await batchesRes.json()
      const shippersJson = await shippersRes.json()
      const batchList = batchesJson.batches || []
      setBatches(batchList)
      setShippers(shippersJson.shippers || [])

      const latest = batchList[0]
      if (latest) {
        const [summaryRes, breakdownRes] = await Promise.all([
          fetch(`/api/batches/${latest.id}/summary`),
          fetch(`/api/batches/${latest.id}/breakdown`),
        ])
        const summaryJson = await summaryRes.json()
        const breakdownJson = await breakdownRes.json()
        setLatestSummary(summaryJson.summary)
        setRepeatUnregisteredCount((breakdownJson.breakdown || []).filter((b) => b.sender_name).length)
      }
      setLoading(false)
    }
    load()
  }, [])

  const latestBatch = batches[0]
  const activeShipperCount = shippers.filter((s) => s.is_active).length

  return (
    <main>
      <h1 className="mb-6 text-2xl font-bold">정산관리프로그램 대시보드</h1>

      {loading ? (
        <p className="text-sm text-gray-500">불러오는 중...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="등록 화주사" value={`${activeShipperCount}개`} />
            <KpiCard
              label="최근 배치"
              value={latestBatch ? latestBatch.year_month : '없음'}
              sub={latestBatch ? `${latestBatch.carrier?.name} · ${latestBatch.total_rows.toLocaleString()}건` : ''}
              status={latestBatch?.status}
            />
            <KpiCard
              label="최근 배치 정산 합계"
              value={latestSummary ? `${Number(latestSummary.total_final).toLocaleString()}원` : '-'}
              sub={
                latestSummary && Number(latestSummary.total_final) !== Number(latestSummary.total_original)
                  ? `원본 ${Number(latestSummary.total_original).toLocaleString()}원 대비 조정`
                  : ''
              }
              highlight
            />
            <KpiCard
              label="등록 필요 화주사 후보"
              value={`${repeatUnregisteredCount}개`}
              sub="2건 이상 반복 발송된 미등록 송화인/받는분"
              warn={repeatUnregisteredCount > 0}
            />
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <Link
              href="/monthly-fees"
              className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-400 hover:shadow"
            >
              <h2 className="mb-1 text-lg font-semibold">월 택배비 수정</h2>
              <p className="text-sm text-gray-500">CJ대한통운 등 월별 원본 내역서 업로드 및 화주사별 정산 금액 검토/수정</p>
            </Link>
            <Link
              href="/shippers"
              className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-400 hover:shadow"
            >
              <h2 className="mb-1 text-lg font-semibold">화주사 관리</h2>
              <p className="text-sm text-gray-500">정식 계약 화주사 마스터 및 구간별 계약 단가표 관리</p>
            </Link>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-gray-600">최근 업로드 배치</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">대상 월</th>
                  <th className="px-4 py-2">택배사</th>
                  <th className="px-4 py-2">건수</th>
                  <th className="px-4 py-2">상태</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {batches.slice(0, 5).map((b) => (
                  <tr key={b.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium">{b.year_month}</td>
                    <td className="px-4 py-2">{b.carrier?.name}</td>
                    <td className="px-4 py-2">{b.total_rows?.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          b.status === 'done'
                            ? 'bg-green-100 text-green-700'
                            : b.status === 'error'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/monthly-fees/${b.id}`} className="text-blue-600 hover:underline">
                        상세/수정
                      </Link>
                    </td>
                  </tr>
                ))}
                {batches.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                      업로드된 내역서가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}

function KpiCard({ label, value, sub, highlight, warn, status }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        warn ? 'border-amber-200 bg-amber-50' : highlight ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'
      }`}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${highlight ? 'text-blue-700' : warn ? 'text-amber-700' : ''}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-gray-400">{sub}</p>}
      {status && (
        <span
          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${
            status === 'done' ? 'bg-green-100 text-green-700' : status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
          }`}
        >
          {status}
        </span>
      )}
    </div>
  )
}
