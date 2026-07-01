'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import { Label, Select, Input } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function MonthlyFeesPage() {
  const [carriers, setCarriers] = useState([])
  const [batches, setBatches] = useState([])
  const [carrierId, setCarrierId] = useState('')
  const [yearMonth, setYearMonth] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  async function load() {
    const [carrierRes, batchRes] = await Promise.all([fetch('/api/carriers'), fetch('/api/batches')])
    const carrierJson = await carrierRes.json()
    const batchJson = await batchRes.json()
    setCarriers(carrierJson.carriers || [])
    setBatches(batchJson.batches || [])
    if (!carrierId && carrierJson.carriers?.[0]) setCarrierId(String(carrierJson.carriers[0].id))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleUpload(e) {
    e.preventDefault()
    setError('')
    if (!file || !carrierId || !yearMonth) {
      setError('택배사, 대상 월, 파일을 모두 선택하세요.')
      return
    }

    setUploading(true)
    setProgress('업로드 및 처리 중... (대용량 파일은 수 분 소요될 수 있습니다)')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('carrier_id', carrierId)
      formData.append('year_month', yearMonth)

      const res = await fetch('/api/batches/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '업로드 실패')

      setProgress(`처리 완료: ${json.totalRows.toLocaleString()}건 적재됨`)
      setFile(null)
      load()
    } catch (err) {
      setError(err.message)
      setProgress('')
    } finally {
      setUploading(false)
    }
  }

  return (
    <main>
      <PageHeader eyebrow="Settlement Console" title="월 택배운임 수정" backHref="/" backLabel="홈으로" />

      <Card className="mb-6 p-4">
        <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3">
          <div>
            <Label>택배사</Label>
            <Select className="w-44" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>대상 월</Label>
            <Input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} />
          </div>
          <div>
            <Label>원본 내역서 (xlsx)</Label>
            <input
              type="file"
              accept=".xlsx"
              className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-300 dark:hover:file:bg-slate-700"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? '처리 중...' : '업로드'}
          </Button>
          {progress && <p className="w-full text-sm text-slate-500 dark:text-slate-400">{progress}</p>}
          {error && <p className="w-full text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      </Card>

      <Table>
        <THead>
          <Th>대상 월</Th>
          <Th>택배사</Th>
          <Th>파일명</Th>
          <Th className="text-right">건수</Th>
          <Th>상태</Th>
          <Th></Th>
        </THead>
        <TBody>
          {batches.map((b) => (
            <Tr key={b.id}>
              <Td className="font-medium text-slate-900 dark:text-slate-200">{b.year_month}</Td>
              <Td>{b.carrier?.name}</Td>
              <Td className="text-slate-500 dark:text-slate-500">{b.file_name}</Td>
              <Td className="tabular text-right">{b.total_rows?.toLocaleString()}</Td>
              <Td>
                <Badge status={b.status} />
              </Td>
              <Td className="text-right">
                <Link href={`/monthly-fees/${b.id}`} className="text-cyan-600 hover:underline dark:text-cyan-400">
                  상세/수정
                </Link>
              </Td>
            </Tr>
          ))}
          {batches.length === 0 && <EmptyRow colSpan={6}>업로드된 내역서가 없습니다.</EmptyRow>}
        </TBody>
      </Table>
    </main>
  )
}
