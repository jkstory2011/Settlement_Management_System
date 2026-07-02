'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'
import StatementDetailView from './StatementDetailView'

export default function StatementsTab({ batchId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [issuingId, setIssuingId] = useState(null)
  const [bulkIssuing, setBulkIssuing] = useState(false)
  const [openStatementId, setOpenStatementId] = useState(null)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/batches/${batchId}/statements`)
    const json = await res.json()
    setRows(json.shippers || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [batchId])

  async function handleIssue(shipperId) {
    setIssuingId(shipperId)
    try {
      const res = await fetch(`/api/batches/${batchId}/statements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipperId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '발행 실패')
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setIssuingId(null)
    }
  }

  async function handleBulkIssue() {
    setBulkIssuing(true)
    try {
      const res = await fetch(`/api/batches/${batchId}/statements/bulk`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '일괄 발행 실패')
      const failed = (json.results || []).filter((r) => !r.ok)
      await load()
      if (failed.length > 0) {
        alert(`${failed.length}건 발행 실패:\n${failed.map((f) => `- ${f.shipperId}: ${f.error}`).join('\n')}`)
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setBulkIssuing(false)
    }
  }

  if (openStatementId) {
    return <StatementDetailView statementId={openStatementId} onBack={() => setOpenStatementId(null)} />
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400">화주사별 정산서</h2>
        <Button variant="secondary" onClick={handleBulkIssue} disabled={bulkIssuing || rows.length === 0}>
          {bulkIssuing ? '일괄 발행 중...' : '전체 일괄 발행'}
        </Button>
      </div>
      <Table>
        <THead>
          <Th>화주사</Th>
          <Th className="text-right">현재 건수</Th>
          <Th className="text-right">현재 합계</Th>
          <Th>최근 발행</Th>
          <Th className="text-right">발행 금액</Th>
          <Th></Th>
        </THead>
        <TBody>
          {loading && <EmptyRow colSpan={6}>불러오는 중...</EmptyRow>}
          {!loading && rows.length === 0 && <EmptyRow colSpan={6}>등록된 화주사 라인이 없습니다.</EmptyRow>}
          {!loading &&
            rows.map((r) => (
              <Tr key={r.shipper_id}>
                <Td className="font-medium text-slate-900 dark:text-slate-200">{r.shipper_name}</Td>
                <Td className="tabular text-right">{r.current_line_count.toLocaleString()}</Td>
                <Td className="tabular text-right">{r.current_total_final.toLocaleString()}원</Td>
                <Td>
                  {r.latest_statement
                    ? `v${r.latest_statement.version} · ${new Date(r.latest_statement.issued_at).toLocaleString('ko-KR')}`
                    : '미발행'}
                </Td>
                <Td className="tabular text-right">
                  {r.latest_statement ? `${Number(r.latest_statement.total_final).toLocaleString()}원` : '-'}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {r.latest_statement && (
                      <Button variant="ghost" onClick={() => setOpenStatementId(r.latest_statement.id)}>
                        보기
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => handleIssue(r.shipper_id)}
                      disabled={issuingId === r.shipper_id}
                    >
                      {issuingId === r.shipper_id ? '발행 중...' : r.latest_statement ? '재발행' : '발행'}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
        </TBody>
      </Table>
    </Card>
  )
}
