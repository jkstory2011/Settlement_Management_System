'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import { Label, Input } from '@/components/ui/Input'

// invoice_lines 필드와 한글 라벨. xlsx-parse.js의 INVOICE_FIELDS와 순서를 맞춘다.
const FIELDS = [
  { key: 'no', label: '번호' },
  { key: 'pickup_date', label: '집화일자' },
  { key: 'pickup_branch', label: '집화점소' },
  { key: 'tracking_no', label: '운송장번호' },
  { key: 'sender_name', label: '송화인명' },
  { key: 'sender_phone', label: '송화인 전화번호' },
  { key: 'sender_addr', label: '송화인 주소' },
  { key: 'receiver_name', label: '받는분명' },
  { key: 'receiver_phone', label: '받는분 전화번호' },
  { key: 'receiver_addr', label: '받는분 주소' },
  { key: 'item_name', label: '품목명' },
  { key: 'qty', label: '수량' },
  { key: 'reservation_type', label: '예약구분 (일반/반품)' },
  { key: 'freight_type', label: '운임구분' },
  { key: 'base_fee', label: '기본운임' },
  { key: 'other_fee', label: '기타운임' },
  { key: 'total_fee', label: '총운임' },
  { key: 'receiver_signee', label: '인수자' },
  { key: 'delivery_date', label: '배송일자' },
  { key: 'delivery_branch', label: '배송점소' },
]

export default function CarrierFormatPage() {
  const { id } = useParams()
  const [carrierName, setCarrierName] = useState('')
  const [headerRows, setHeaderRows] = useState(2)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [columns, setColumns] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch('/api/carriers')
      const json = await res.json()
      const carrier = (json.carriers || []).find((c) => String(c.id) === String(id))
      if (carrier) {
        setCarrierName(carrier.name)
        setHeaderRows(carrier.format_config?.header_rows ?? 2)
        setSheetIndex(carrier.format_config?.sheet_index ?? 0)
        setColumns(carrier.format_config?.columns ?? {})
      }
      setLoading(false)
    }
    load()
  }, [id])

  function setColumn(key, value) {
    setColumns((prev) => ({ ...prev, [key]: value === '' ? undefined : Number(value) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    const cleanColumns = Object.fromEntries(Object.entries(columns).filter(([, v]) => v !== undefined && !Number.isNaN(v)))

    const res = await fetch(`/api/carriers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format_config: {
          header_rows: Number(headerRows),
          sheet_index: Number(sheetIndex),
          columns: cleanColumns,
        },
      }),
    })
    const json = await res.json()
    setSaving(false)
    setMessage(res.ok ? '저장했습니다.' : json.error || '저장 실패')
  }

  if (loading) {
    return (
      <main>
        <p className="text-sm text-slate-500 dark:text-slate-400">불러오는 중...</p>
      </main>
    )
  }

  return (
    <main>
      <PageHeader eyebrow="Settlement Console" title={`${carrierName} 양식 편집`} backHref="/carriers" backLabel="택배사 목록으로" />

      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        원본 내역서에서 각 항목이 몇 번째 컬럼(0부터 시작)에 있는지 입력하세요. 비워두면 해당 항목은 저장하지 않습니다.
      </p>

      <form onSubmit={handleSave}>
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <Label>헤더 행 수 (데이터가 시작되는 행 이전까지)</Label>
              <Input type="number" className="w-40" value={headerRows} onChange={(e) => setHeaderRows(e.target.value)} />
            </div>
            <div>
              <Label>시트 번호 (0부터)</Label>
              <Input type="number" className="w-40" value={sheetIndex} onChange={(e) => setSheetIndex(e.target.value)} />
            </div>
          </div>
        </Card>

        <Card className="mb-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  type="number"
                  placeholder="컬럼 번호"
                  value={columns[f.key] ?? ''}
                  onChange={(e) => setColumn(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? '저장 중...' : '양식 저장'}
          </Button>
          {message && <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>}
        </div>
      </form>
    </main>
  )
}
