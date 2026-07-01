'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import { Label, Input } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function ShipperRatesPage() {
  const { id } = useParams()
  const [rates, setRates] = useState([])
  const [shipperName, setShipperName] = useState('')
  const [form, setForm] = useState({ cj_base_fee: '', contract_price: '' })
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
      body: JSON.stringify({ cj_base_fee: form.cj_base_fee, contract_price: form.contract_price }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || '등록 실패')
      return
    }
    setForm({ cj_base_fee: '', contract_price: '' })
    load()
  }

  async function remove(rateId) {
    await fetch(`/api/shippers/${id}/rates/${rateId}`, { method: 'DELETE' })
    load()
  }

  return (
    <main>
      <PageHeader
        eyebrow="Settlement Console"
        title={`${shipperName || '화주사'} 구간별 계약 단가표`}
        backHref="/shippers"
        backLabel="화주사 목록으로"
      />

      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        CJ대한통운 원본 내역서의 기본운임 값(구간 식별자)별로 이 화주사에게 청구할 계약 단가를 등록합니다.
        등록되지 않은 구간은 원본 CJ운임(총운임)을 그대로 사용합니다.
      </p>

      <Card className="mb-6 p-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div>
            <Label>CJ 기본운임(구간)</Label>
            <Input
              required
              type="number"
              className="w-40"
              value={form.cj_base_fee}
              onChange={(e) => setForm({ ...form, cj_base_fee: e.target.value })}
            />
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
            <Th>CJ 기본운임(구간)</Th>
            <Th>계약 단가</Th>
            <Th>적용 시작일</Th>
            <Th></Th>
          </THead>
          <TBody>
            {rates.map((r) => (
              <Tr key={r.id}>
                <Td className="tabular">{Number(r.cj_base_fee).toLocaleString()}원</Td>
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
              <EmptyRow colSpan={4}>등록된 구간이 없습니다. 등록 전까지는 원본 CJ운임이 그대로 적용됩니다.</EmptyRow>
            )}
          </TBody>
        </Table>
      )}
    </main>
  )
}
