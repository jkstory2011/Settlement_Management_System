'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">월 택배비 수정</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          홈으로
        </Link>
      </div>

      <form onSubmit={handleUpload} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">택배사</label>
          <select
            className="w-44 rounded border border-gray-300 px-3 py-2 text-sm"
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
          >
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">대상 월</label>
          <input
            type="month"
            className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">원본 내역서 (xlsx)</label>
          <input
            type="file"
            accept=".xlsx"
            className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? '처리 중...' : '업로드'}
        </button>
        {progress && <p className="w-full text-sm text-gray-600">{progress}</p>}
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">대상 월</th>
              <th className="px-4 py-2">택배사</th>
              <th className="px-4 py-2">파일명</th>
              <th className="px-4 py-2">건수</th>
              <th className="px-4 py-2">상태</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{b.year_month}</td>
                <td className="px-4 py-2">{b.carrier?.name}</td>
                <td className="px-4 py-2 text-gray-500">{b.file_name}</td>
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
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  업로드된 내역서가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
