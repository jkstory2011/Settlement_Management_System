'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function BatchDetailPage() {
  const { batchId } = useParams()
  const [breakdown, setBreakdown] = useState([])
  // '' 전체 | 'unregistered' 미등록 전체 | `s:${shipperId}` 등록 화주사 | `n:${senderName}` 반복 발송된 미등록 송화인
  const [filterKey, setFilterKey] = useState('')
  const [registeringName, setRegisteringName] = useState(null)
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [lines, setLines] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [recomputing, setRecomputing] = useState(false)
  const pageSize = 50

  async function loadBreakdown() {
    const res = await fetch(`/api/batches/${batchId}/breakdown`)
    const json = await res.json()
    setBreakdown(json.breakdown || [])
  }

  // filterKey를 lines/summary API에 쓸 쿼리 파라미터로 변환
  function filterParams() {
    if (filterKey === 'unregistered') return { shipper_id: 'unregistered' }
    if (filterKey.startsWith('s:')) return { shipper_id: filterKey.slice(2) }
    if (filterKey.startsWith('n:')) return { sender_name: filterKey.slice(2) }
    return {}
  }

  async function loadLines() {
    setLoading(true)
    const fParams = filterParams()
    const params = new URLSearchParams({ page: String(page), ...fParams })
    if (q) params.set('q', q)

    const summaryQuery = new URLSearchParams(fParams).toString()

    const [linesRes, summaryRes] = await Promise.all([
      fetch(`/api/batches/${batchId}/lines?${params.toString()}`),
      fetch(`/api/batches/${batchId}/summary${summaryQuery ? `?${summaryQuery}` : ''}`),
    ])
    const linesJson = await linesRes.json()
    const summaryJson = await summaryRes.json()
    setLines(linesJson.lines || [])
    setTotal(linesJson.total || 0)
    setSummary(summaryJson.summary)
    setLoading(false)
  }

  useEffect(() => {
    loadBreakdown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId])

  useEffect(() => {
    loadLines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, filterKey, q, page])

  async function handleRegisterSender(senderName) {
    setRegisteringName(senderName)
    try {
      const res = await fetch('/api/shippers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: senderName }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '화주사 등록 실패')

      const recomputeRes = await fetch(`/api/batches/${batchId}/recompute`, { method: 'POST' })
      const recomputeJson = await recomputeRes.json()
      if (!recomputeRes.ok) throw new Error(recomputeJson.error || '재계산 실패')

      setFilterKey(`s:${json.shipper.id}`)
      setPage(1)
      await Promise.all([loadBreakdown(), loadLines()])
    } catch (err) {
      alert(err.message)
    } finally {
      setRegisteringName(null)
    }
  }

  function handleSearch(e) {
    e.preventDefault()
    setPage(1)
    setQ(qInput.trim())
  }

  function startEdit(line) {
    setEditingId(line.id)
    setEditValue(line.manual_amount ?? line.applied_amount ?? '')
  }

  async function saveEdit(line) {
    const value = editValue === '' ? null : Number(editValue)
    const res = await fetch(`/api/lines/${line.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual_amount: value }),
    })
    const json = await res.json()
    if (res.ok) {
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...json.line } : l)))
      setEditingId(null)
      loadLines()
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  async function handleRecompute() {
    setRecomputing(true)
    try {
      const res = await fetch(`/api/batches/${batchId}/recompute`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '재계산 실패')
      await Promise.all([loadBreakdown(), loadLines()])
      alert(`재계산 완료: ${json.updated.toLocaleString()}건`)
    } catch (err) {
      alert(err.message)
    } finally {
      setRecomputing(false)
    }
  }

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">월 택배비 수정</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRecompute}
            disabled={recomputing}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
            title="화주사/구간표를 업로드 이후에 변경했다면 눌러서 적용금액을 다시 계산하세요."
          >
            {recomputing ? '재계산 중...' : '화주사/단가 재계산'}
          </button>
          <Link href="/monthly-fees" className="text-sm text-blue-600 hover:underline">
            목록으로
          </Link>
        </div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-600">화주사별 건수</h2>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto text-sm">
            <li>
              <button
                onClick={() => {
                  setFilterKey('')
                  setPage(1)
                }}
                className={`w-full rounded px-2 py-1 text-left hover:bg-gray-100 ${filterKey === '' ? 'bg-blue-50 font-medium text-blue-700' : ''}`}
              >
                전체
              </button>
            </li>
            {breakdown.map((b) => {
              const key = b.sender_name ? `n:${b.sender_name}` : b.shipper_id == null ? 'unregistered' : `s:${b.shipper_id}`
              const isUnregisteredRepeat = Boolean(b.sender_name)
              return (
                <li key={key}>
                  <div
                    className={`flex w-full items-center gap-1 rounded px-2 py-1 hover:bg-gray-100 ${
                      filterKey === key ? 'bg-blue-50 font-medium text-blue-700' : ''
                    }`}
                  >
                    <button
                      onClick={() => {
                        setFilterKey(key)
                        setPage(1)
                      }}
                      className="flex flex-1 items-center justify-between overflow-hidden text-left"
                    >
                      <span className="truncate">
                        {isUnregisteredRepeat && <span className="mr-1 text-amber-500">●</span>}
                        {b.shipper_name}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-gray-400">{Number(b.line_count).toLocaleString()}</span>
                    </button>
                    {isUnregisteredRepeat && (
                      <button
                        onClick={() => handleRegisterSender(b.sender_name)}
                        disabled={registeringName === b.sender_name}
                        title="화주사로 등록"
                        className="shrink-0 rounded border border-blue-200 px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {registeringName === b.sender_name ? '등록중' : '등록'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-xs text-gray-400">● 표시는 화주사 미등록이지만 2건 이상 반복 발송된 송화인입니다.</p>
        </aside>

        <section>
          {summary && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard label="건수" value={Number(summary.line_count).toLocaleString()} />
              <SummaryCard label="원본(CJ) 합계" value={`${Number(summary.total_original).toLocaleString()}원`} />
              <SummaryCard label="적용 합계" value={`${Number(summary.total_applied).toLocaleString()}원`} />
              <SummaryCard label="최종(수정반영) 합계" value={`${Number(summary.total_final).toLocaleString()}원`} highlight />
            </div>
          )}

          <form onSubmit={handleSearch} className="mb-3 flex gap-2">
            <input
              placeholder="운송장번호 / 송화인 / 받는분 검색"
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            <button type="submit" className="rounded bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-900">
              검색
            </button>
          </form>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2">집화일자</th>
                  <th className="px-3 py-2">운송장번호</th>
                  <th className="px-3 py-2">송화인</th>
                  <th className="px-3 py-2">받는분</th>
                  <th className="px-3 py-2 text-right">원본운임</th>
                  <th className="px-3 py-2 text-right">적용금액</th>
                  <th className="px-3 py-2 text-right">최종금액</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-500">{l.pickup_date}</td>
                    <td className="px-3 py-2">{l.tracking_no}</td>
                    <td className="px-3 py-2">{l.sender_name}</td>
                    <td className="px-3 py-2">{l.receiver_name}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{Number(l.total_fee).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{Number(l.applied_amount).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {editingId === l.id ? (
                        <input
                          autoFocus
                          type="number"
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                        />
                      ) : (
                        <span className={l.is_manual_edit ? 'text-orange-600' : ''}>{Number(l.final_amount).toLocaleString()}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editingId === l.id ? (
                        <div className="flex justify-end gap-2">
                          <button onClick={() => saveEdit(l)} className="text-xs text-blue-600 hover:underline">
                            저장
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">
                            취소
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(l)} className="text-xs text-gray-500 hover:underline">
                          수정
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                      조회된 내역이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
            <span>
              총 {total.toLocaleString()}건 중 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
              >
                이전
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function SummaryCard({ label, value, highlight }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${highlight ? 'text-blue-700' : ''}`}>{value}</p>
    </div>
  )
}
