'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import { Label, Input } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function UploadPage() {
  const [carriers, setCarriers] = useState([])
  const [batches, setBatches] = useState([])
  const [activeCarrierId, setActiveCarrierId] = useState('')
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
    setActiveCarrierId((prev) => prev || String(carrierJson.carriers?.[0]?.id || ''))
  }

  useEffect(() => {
    load()
  }, [])

  const activeCarrier = carriers.find((c) => String(c.id) === activeCarrierId)
  const isConfigured = activeCarrier && Object.keys(activeCarrier.format_config?.columns || {}).length > 0
  const carrierBatches = batches.filter((b) => String(b.carrier?.id) === activeCarrierId)

  function selectCarrier(id) {
    setActiveCarrierId(id)
    setFile(null)
    setYearMonth('')
    setError('')
    setProgress('')
  }

  async function handleUpload(e) {
    e.preventDefault()
    setError('')
    if (!file || !activeCarrierId || !yearMonth) {
      setError('대상 월과 파일을 모두 선택하세요.')
      return
    }

    setUploading(true)
    setProgress('업로드 및 처리 중... (대용량 파일은 수 분 소요될 수 있습니다)')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('carrier_id', activeCarrierId)
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
      <PageHeader eyebrow="Settlement Console" title="데이터 업로드" backHref="/" backLabel="홈으로" />

      <div className="mb-6 flex flex-wrap gap-2">
        {carriers.map((c) => (
          <button
            key={c.id}
            onClick={() => selectCarrier(String(c.id))}
            className={`rounded-md px-3.5 py-2 text-sm transition ${
              String(c.id) === activeCarrierId
                ? 'bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950'
                : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {c.name}
          </button>
        ))}
        {carriers.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">등록된 택배사가 없습니다.</p>}
      </div>

      {activeCarrier && (
        <>
          <Card className="mb-6 p-4">
            <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3">
              {!isConfigured && (
                <p className="w-full text-sm text-amber-600 dark:text-amber-400">
                  {activeCarrier.name}의 양식이 아직 등록되지 않았습니다.{' '}
                  <Link href={`/carriers/${activeCarrier.id}`} className="underline">
                    여기서 먼저 설정하세요
                  </Link>
                  .
                </p>
              )}
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
              <Button type="submit" disabled={uploading || !isConfigured}>
                {uploading ? '처리 중...' : `${activeCarrier.name} 업로드`}
              </Button>
              {progress && <p className="w-full text-sm text-slate-500 dark:text-slate-400">{progress}</p>}
              {error && <p className="w-full text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            </form>
          </Card>

          <Table>
            <THead>
              <Th>대상 월</Th>
              <Th>파일명</Th>
              <Th className="text-right">건수</Th>
              <Th>상태</Th>
              <Th></Th>
            </THead>
            <TBody>
              {carrierBatches.map((b) => (
                <Tr key={b.id}>
                  <Td className="font-medium text-slate-900 dark:text-slate-200">{b.year_month}</Td>
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
              {carrierBatches.length === 0 && (
                <EmptyRow colSpan={5}>{activeCarrier.name}으로 업로드된 내역서가 없습니다.</EmptyRow>
              )}
            </TBody>
          </Table>
        </>
      )}
    </main>
  )
}
