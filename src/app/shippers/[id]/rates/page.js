'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import { Label, Input, Select } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

// CJ대한통운이 실제로 쓰는 타입 구분. 원본 내역서에는 이 정보가 없어(운임구분 컬럼은 신용/착불 여부이고,
// 같은 기본운임 금액이 항상 같은 타입을 의미하지도 않음) 화주사와 계약한 금액을 참고용으로만 기록해둔다.
const CJ_TYPES = ['극소', '소', '중', '대1', '대2', '이형', '취급제한']

export default function ShipperRatesPage() {
  const { id } = useParams()
  const [rates, setRates] = useState([])
  const [shipperName, setShipperName] = useState('')
  const [form, setForm] = useState({ cj_type: '', contract_price: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [ratesRes, shipperRes] = await Promise.all([
      fetch(`/api/shippers/${id}/rates`),
      fetch('/api/shippers'),
    ])
    const ratesJson = await ratesRes.json()
    const shippersJson = await shipperRes.json()
    setRates(ratesJson.rates || [])
    setShipperName(shippersJson.shippers?.find((s) => String(s.id) === String(id))?.name || '')
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [id])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    const res = await fetch(`/api/shippers/${id}/rates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cj_type: form.cj_type, contract_price: form.contract_price }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || '등록 실패')
      return
    }
    setForm({ cj_type: '', contract_price: '' })
    load()
  }

  async function remove(rateId) {
    await fetch(`/api/shippers/${id}/rates/${rateId}`, { method: 'DELETE' })
    load()
  }

  const registeredTypes = new Set(rates.map((r) => r.cj_type))
  const sortedRates = [...rates].sort((a, b) => CJ_TYPES.indexOf(a.cj_type) - CJ_TYPES.indexOf(b.cj_type))

  return (
    <main>
      <PageHeader
        eyebrow="Settlement Console"
        title={`${shipperName || '화주사'} 구간별 계약 단가표`}
        backHref="/shippers"
        backLabel="화주사 목록으로"
      />

      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        CJ대한통운 타입(극소/소/중/대1/대2/이형/취급제한)별로 이 화주사와 실제 계약한 단가를 기록해둡니다.
        택배사 청구 금액과는 무관하며, 원본 내역서를 계약단가로 수정할 때 참고용으로 확인하는 표입니다.
      </p>

      <Card className="mb-6 p-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div>
            <Label>CJ대한통운 타입(구간)</Label>
            <Select
              required
              className="w-40"
              value={form.cj_type}
              onChange={(e) => setForm({ ...form, cj_type: e.target.value })}
            >
              <option value="">선택하세요</option>
              {CJ_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                  {registeredTypes.has(t) ? ' (등록됨)' : ''}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>계약 단가</Label>
            <Input
              required
              type="number"
              className="w-40"
              value={form.contract_price}
              onChange={(e) => setForm({ ...form, contract_price: e.target.value })}
            />
          </div>
          <Button type="submit">구간 등록/수정</Button>
          {error && <p className="w-full text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      </Card>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">불러오는 중...</p>
      ) : (
        <Table>
          <THead>
            <Th>CJ대한통운 타입(구간)</Th>
            <Th>계약 단가</Th>
            <Th>적용 시작일</Th>
            <Th></Th>
          </THead>
          <TBody>
            {sortedRates.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium text-slate-900 dark:text-slate-100">{r.cj_type}</Td>
                <Td className="tabular font-medium text-slate-900 dark:text-slate-100">
                  {Number(r.contract_price).toLocaleString()}원
                </Td>
                <Td className="text-slate-500 dark:text-slate-500">{r.effective_from}</Td>
                <Td className="text-right">
                  <button onClick={() => remove(r.id)} className="text-xs text-rose-500 hover:underline dark:text-rose-400">
                    삭제
                  </button>
                </Td>
              </Tr>
            ))}
            {rates.length === 0 && (
              <EmptyRow colSpan={4}>등록된 타입이 없습니다. 화주사와 계약한 타입별 단가를 등록해두세요.</EmptyRow>
            )}
          </TBody>
        </Table>
      )}
    </main>
  )
}
