'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import KpiCard from '@/components/ui/KpiCard'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

const PAGE_SIZE = 200

export default function StatementDetailView({ statementId, onBack }) {
  const [statement, setStatement] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [stRes, histRes] = await Promise.all([
        fetch(`/api/statements/${statementId}`),
        fetch(`/api/statements/${statementId}/history`),
      ])
      const stJson = await stRes.json()
      const histJson = await histRes.json()
      if (!stRes.ok) throw new Error(stJson.error || '정산서를 불러오지 못했습니다.')
      if (!histRes.ok) throw new Error(histJson.error || '이력을 불러오지 못했습니다.')
      setStatement(stJson.statement)
      setHistory(histJson.history || [])
    } catch (err) {
      setError(err.message || '데이터 로드에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
    load()
  }, [statementId])

  if (error) {
    return (
      <Card className="p-4">
        <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>
        <Button variant="secondary" onClick={load}>다시 시도</Button>
      </Card>
    )
  }

  if (loading || !statement) {
    return (
      <Card className="p-4">
        <p className="text-sm text-slate-500">불러오는 중...</p>
      </Card>
    )
  }

  const snapshot = statement.snapshot
  const totalPages = Math.max(1, Math.ceil(snapshot.lines.length / PAGE_SIZE))
  const pagedLines = snapshot.lines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← 목록으로
        </Button>
        <div className="flex gap-2">
          <a href={`/api/statements/${statementId}/export?format=xlsx`}>
            <Button variant="secondary">Excel 다운로드</Button>
          </a>
          <a href={`/api/statements/${statementId}/export?format=pdf`}>
            <Button variant="secondary">PDF 다운로드</Button>
          </a>
        </div>
      </div>

      <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
        {snapshot.shipper.name} 정산서 · {snapshot.batch.year_month}
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        {snapshot.carrier.name} · v{statement.version} · {new Date(statement.issued_at).toLocaleString('ko-KR')} 발행
      </p>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <KpiCard
          label="일반"
          value={snapshot.summary.일반.line_count.toLocaleString()}
          unit="건"
          sub={`${snapshot.summary.일반.total_final.toLocaleString()}원`}
        />
        <KpiCard
          label="반품"
          value={snapshot.summary.반품.line_count.toLocaleString()}
          unit="건"
          sub={`${snapshot.summary.반품.total_final.toLocaleString()}원`}
        />
        <KpiCard
          label="합계"
          value={snapshot.summary.합계.line_count.toLocaleString()}
          unit="건"
          sub={`${snapshot.summary.합계.total_final.toLocaleString()}원`}
          tone="accent"
        />
      </div>

      {history.length > 1 && (
        <Card className="mb-4 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-500">발행 이력</p>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <span
                key={h.id}
                className={`rounded px-2 py-1 text-xs ${
                  h.id === statement.id ? 'bg-cyan-600 text-white' : 'bg-slate-100 dark:bg-slate-800'
                }`}
              >
                v{h.version} · {new Date(h.issued_at).toLocaleDateString('ko-KR')}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Table>
        <THead>
          <Th>송장번호</Th>
          <Th>집화일</Th>
          <Th>구분</Th>
          <Th>송화인</Th>
          <Th>수화인</Th>
          <Th>품목</Th>
          <Th className="text-right">수량</Th>
          <Th className="text-right">원본운임</Th>
          <Th className="text-right">최종금액</Th>
        </THead>
        <TBody>
          {snapshot.lines.length === 0 && <EmptyRow colSpan={9}>명세가 없습니다.</EmptyRow>}
          {pagedLines.map((l, i) => (
            <Tr key={(page - 1) * PAGE_SIZE + i}>
              <Td>{l.tracking_no}</Td>
              <Td>{l.pickup_date}</Td>
              <Td>{l.reservation_type}</Td>
              <Td>{l.sender_name}</Td>
              <Td>{l.receiver_name}</Td>
              <Td className="max-w-xs truncate">{l.item_name}</Td>
              <Td className="tabular text-right">{l.qty}</Td>
              <Td className="tabular text-right">{Number(l.total_fee).toLocaleString()}</Td>
              <Td className="tabular text-right">{Number(l.final_amount).toLocaleString()}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {snapshot.lines.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span className="tabular">
            총 {snapshot.lines.length.toLocaleString()}건 중{' '}
            {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, snapshot.lines.length)}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1">
              이전
            </Button>
            <span className="tabular">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1"
            >
              다음
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
