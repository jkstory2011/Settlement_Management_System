'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Label, Select } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function UnmatchedItemsTab({ batchId }) {
  const [shippers, setShippers] = useState([])
  const [shipperId, setShipperId] = useState('')
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(false)
  const [applyingKey, setApplyingKey] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/batches/${batchId}/breakdown`)
      .then((res) => res.json())
      .then((json) => {
        const rows = (json.breakdown || []).filter((r) => r.shipper_id != null)
        setShippers(rows)
        if (rows[0]) setShipperId(String(rows[0].shipper_id))
      })
  }, [batchId])

  async function loadCandidates(id) {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/batches/${batchId}/unmatched-items?shipperId=${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '조회 실패')
      setCandidates(json.candidates || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCandidates(shipperId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipperId])

  async function apply(candidate) {
    const key = candidate.item_name
    setApplyingKey(key)
    try {
      const res = await fetch(`/api/batches/${batchId}/unmatched-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipperId: Number(shipperId),
          itemName: candidate.item_name,
          contractPrice: candidate.candidate_contract_price,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '적용 실패')
      await loadCandidates(shipperId)
    } catch (err) {
      alert(err.message)
    } finally {
      setApplyingKey(null)
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-400">미확인 후보</h2>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        참조표에 완전히 똑같은 품목명은 없지만, 문구가 살짝 다른(품질보증 문구 추가 등) 비슷한 품목이 있는 경우만 보여줍니다.
        같은 상품이 맞으면 "적용"을 눌러 이번 배치에 반영하고, 다음부터는 자동으로 매칭되도록 등록합니다.
      </p>

      <div className="mb-4 w-64">
        <Label>화주사</Label>
        <Select value={shipperId} onChange={(e) => setShipperId(e.target.value)}>
          {shippers.map((s) => (
            <option key={s.shipper_id} value={s.shipper_id}>
              {s.shipper_name} ({s.line_count.toLocaleString()}건)
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="mb-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <Table>
        <THead>
          <Th>이번 배치 품목명</Th>
          <Th className="text-right">건수</Th>
          <Th>참조표 후보 품목명</Th>
          <Th className="text-right">계약단가</Th>
          <Th></Th>
        </THead>
        <TBody>
          {loading && <EmptyRow colSpan={5}>불러오는 중...</EmptyRow>}
          {!loading && candidates.length === 0 && <EmptyRow colSpan={5}>미확인 후보가 없습니다.</EmptyRow>}
          {!loading &&
            candidates.map((c) => (
              <Tr key={c.item_name}>
                <Td className="max-w-xs truncate" title={c.item_name}>
                  {c.item_name}
                </Td>
                <Td className="tabular text-right">{c.line_count.toLocaleString()}</Td>
                <Td className="max-w-xs truncate text-slate-500 dark:text-slate-500" title={c.candidate_item_name}>
                  {c.candidate_item_name}
                </Td>
                <Td className="tabular text-right">{Number(c.candidate_contract_price).toLocaleString()}원</Td>
                <Td className="text-right">
                  <Button
                    variant="secondary"
                    onClick={() => apply(c)}
                    disabled={applyingKey === c.item_name}
                  >
                    {applyingKey === c.item_name ? '적용 중...' : '적용'}
                  </Button>
                </Td>
              </Tr>
            ))}
        </TBody>
      </Table>
    </Card>
  )
}
