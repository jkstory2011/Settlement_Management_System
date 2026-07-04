'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function HomePage() {
  const [batches, setBatches] = useState([])
  const [shippers, setShippers] = useState([])
  const [latestSummary, setLatestSummary] = useState(null)
  const [repeatUnregisteredCount, setRepeatUnregisteredCount] = useState(0)
  const [baseFeeBreakdowns, setBaseFeeBreakdowns] = useState({})
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

      const recent = batchList.slice(0, 5)
      const baseFeeResults = await Promise.all(
        recent.map((b) => fetch(`/api/batches/${b.id}/base-fee-breakdown`).then((res) => res.json()))
      )
      setBaseFeeBreakdowns(
        Object.fromEntries(recent.map((b, i) => [b.id, baseFeeResults[i].breakdown || []]))
      )

      setLoading(false)
    }
    load()
  }, [])

  const latestBatch = batches[0]
  const activeShipperCount = shippers.filter((s) => s.is_active).length

  return (
    <main>
      <PageHeader eyebrow="Settlement Console" title="정산관리 대시보드" />

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="등록 화주사" value={`${activeShipperCount}`} unit="개" />
            <KpiCard
              label="최근 배치"
              value={latestBatch ? latestBatch.year_month : '없음'}
              sub={latestBatch ? `${latestBatch.carrier?.name} · ${latestBatch.total_rows.toLocaleString()}건` : ''}
              status={latestBatch?.status}
            />
            <KpiCard
              label="최근 배치 정산 합계"
              value={latestSummary ? `${Number(latestSummary.total_final).toLocaleString()}` : '-'}
              unit={latestSummary ? '원' : ''}
              sub={
                latestSummary && Number(latestSummary.total_final) !== Number(latestSummary.total_original)
                  ? `원본 ${Number(latestSummary.total_original).toLocaleString()}원 대비 조정`
                  : ''
              }
              tone="accent"
            />
            <KpiCard
              label="등록 필요 화주사 후보"
              value={`${repeatUnregisteredCount}`}
              unit="개"
              sub="2건 이상 반복 발송된 미등록 송화인/받는분"
              tone={repeatUnregisteredCount > 0 ? 'warn' : 'default'}
            />
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <NavCard
              href="/monthly-fees"
              title="월 택배운임 수정"
              desc="CJ대한통운 등 월별 원본 내역서 업로드 및 화주사별 정산 금액 검토/수정"
            />
            <NavCard href="/shippers" title="화주사 관리" desc="정식 계약 화주사 마스터 및 구간별 계약 단가표 관리" />
          </div>

          <h2 className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">최근 업로드 배치</h2>
          <Table>
            <THead>
              <Th>대상 월</Th>
              <Th>택배사</Th>
              <Th className="text-right">건수</Th>
              <Th>금액대별 수량</Th>
              <Th>상태</Th>
            </THead>
            <TBody>
              {batches.slice(0, 5).map((b) => (
                <Tr key={b.id}>
                  <Td className="font-medium text-slate-900 dark:text-slate-200">{b.year_month}</Td>
                  <Td>{b.carrier?.name}</Td>
                  <Td className="tabular text-right">{b.total_rows?.toLocaleString()}</Td>
                  <Td>
                    <BaseFeeBreakdown rows={baseFeeBreakdowns[b.id] || []} />
                  </Td>
                  <Td>
                    <Badge status={b.status} />
                  </Td>
                </Tr>
              ))}
              {batches.length === 0 && <EmptyRow colSpan={5}>업로드된 내역서가 없습니다.</EmptyRow>}
            </TBody>
          </Table>
        </>
      )}
    </main>
  )
}

// 배치 하나에 보통 압도적 다수를 차지하는 표준 금액대 하나와, 소수의 예외적인 금액대들이 섞여 있다.
// 전부 같은 크기로 늘어놓으면(11종 전부 칩으로) 정작 어떤 게 중요한지 안 보여서, 가장 큰 금액대는
// 굵게/꽉 찬 막대로 강조하고 나머지는 그에 상대적인 막대로 보여준다. 개수가 많아도 자르지 않고
// 한 목록 안에서 같이 스크롤해서 전부 볼 수 있게 한다(VISIBLE_ROWS는 스크롤 영역 높이 기준).
const VISIBLE_ROWS = 5

function BaseFeeBreakdown({ rows }) {
  if (rows.length === 0) return <span className="text-xs text-slate-400 dark:text-slate-600">-</span>

  const sorted = [...rows].sort((a, b) => Number(b.line_count) - Number(a.line_count))
  const total = sorted.reduce((sum, r) => sum + Number(r.line_count), 0)
  const maxMinor = sorted.length > 1 ? Number(sorted[1].line_count) : Number(sorted[0].line_count)

  return (
    <div
      className="thin-scroll min-w-[220px] overflow-y-auto pr-1"
      style={{ maxHeight: `${VISIBLE_ROWS * 22}px` }}
    >
      <div className="flex flex-col gap-1">
        {sorted.map((r, i) => {
          const isDominant = i === 0
          const pct = Math.round((Number(r.line_count) / total) * 100)
          return (
            <div key={r.base_fee} className="flex items-center gap-2">
              <span
                className={`tabular w-16 shrink-0 text-right text-xs ${
                  isDominant ? 'font-medium text-slate-600 dark:text-slate-300' : 'text-slate-500 dark:text-slate-500'
                }`}
              >
                {Number(r.base_fee).toLocaleString()}원
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  className={`block h-full rounded-full ${
                    isDominant ? 'bg-cyan-500 dark:bg-cyan-400' : 'bg-cyan-500/70 dark:bg-cyan-500/60'
                  }`}
                  style={{ width: isDominant ? '100%' : `${Math.max(4, (Number(r.line_count) / maxMinor) * 100)}%` }}
                />
              </span>
              <span
                className={`tabular shrink-0 whitespace-nowrap text-xs ${
                  isDominant ? 'font-medium text-slate-600 dark:text-slate-300' : 'text-slate-500 dark:text-slate-500'
                }`}
              >
                {Number(r.line_count).toLocaleString()}건{' '}
                {isDominant && <span className="font-normal text-slate-400 dark:text-slate-500">· {pct}%</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NavCard({ href, title, desc }) {
  return (
    <Link href={href}>
      <Card className="group p-5 transition hover:border-cyan-300 dark:hover:border-cyan-800 dark:hover:bg-slate-900">
        <h2 className="mb-1 text-base font-semibold text-slate-900 group-hover:text-cyan-600 dark:text-slate-100 dark:group-hover:text-cyan-300">
          {title}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-500">{desc}</p>
      </Card>
    </Link>
  )
}
