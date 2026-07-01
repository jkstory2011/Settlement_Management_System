'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import KpiCard from '@/components/ui/KpiCard'
import PageHeader from '@/components/ui/PageHeader'
import { Input } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

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
  const [mergingName, setMergingName] = useState(null)
  const [dragOverShipperId, setDragOverShipperId] = useState(null)
  const [shippers, setShippers] = useState([])
  const [expandedShipperId, setExpandedShipperId] = useState(null)
  const [unmergingName, setUnmergingName] = useState(null)
  const pageSize = 50

  async function loadBreakdown() {
    const [breakdownRes, shippersRes] = await Promise.all([
      fetch(`/api/batches/${batchId}/breakdown`),
      fetch('/api/shippers'),
    ])
    const json = await breakdownRes.json()
    const shippersJson = await shippersRes.json()
    setBreakdown(json.breakdown || [])
    setShippers(shippersJson.shippers || [])
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

      const assignRes = await fetch(`/api/batches/${batchId}/assign-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipper_id: json.shipper.id, candidate_name: senderName }),
      })
      const assignJson = await assignRes.json()
      if (!assignRes.ok) throw new Error(assignJson.error || '반영 실패')

      setFilterKey(`s:${json.shipper.id}`)
      setPage(1)
      await Promise.all([loadBreakdown(), loadLines()])
    } catch (err) {
      alert(err.message)
    } finally {
      setRegisteringName(null)
    }
  }

  // 반복 미등록 이름을 이미 등록된 화주사에 드래그 앤 드롭으로 병합
  async function handleMergeCandidate(shipperId, senderName) {
    setMergingName(senderName)
    try {
      const res = await fetch(`/api/batches/${batchId}/merge-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipper_id: shipperId, candidate_name: senderName }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '병합 실패')

      setFilterKey(`s:${shipperId}`)
      setPage(1)
      await Promise.all([loadBreakdown(), loadLines()])
    } catch (err) {
      alert(err.message)
    } finally {
      setMergingName(null)
    }
  }

  // 잘못 병합한 별칭을 해제 -- merge-candidate의 반대 동작
  async function handleUnmergeAlias(shipperId, aliasName) {
    setUnmergingName(aliasName)
    try {
      const res = await fetch(`/api/batches/${batchId}/unmerge-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipper_id: shipperId, candidate_name: aliasName }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '해제 실패')

      await Promise.all([loadBreakdown(), loadLines()])
    } catch (err) {
      alert(err.message)
    } finally {
      setUnmergingName(null)
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
      <PageHeader
        eyebrow="Settlement Console"
        title="월 택배운임 수정"
        backHref="/monthly-fees"
        actions={
          <Button
            variant="secondary"
            onClick={handleRecompute}
            disabled={recomputing}
            title="화주사/구간표를 업로드 이후에 변경했다면 눌러서 적용금액을 다시 계산하세요."
          >
            {recomputing ? '재계산 중...' : '화주사/단가 재계산'}
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="p-3">
          <h2 className="mb-2 px-1 text-sm font-semibold text-slate-600 dark:text-slate-400">화주사별 건수</h2>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto text-sm">
            <li>
              <button
                onClick={() => {
                  setFilterKey('')
                  setPage(1)
                }}
                className={`w-full rounded px-2 py-1 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  filterKey === '' ? 'bg-cyan-50 font-medium text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300' : ''
                }`}
              >
                전체
              </button>
            </li>
            {breakdown.map((b) => {
              const key = b.sender_name ? `n:${b.sender_name}` : b.shipper_id == null ? 'unregistered' : `s:${b.shipper_id}`
              const isUnregisteredRepeat = Boolean(b.sender_name)
              const isRegisteredShipper = b.shipper_id != null
              const isActive = filterKey === key
              const isDragOver = isRegisteredShipper && dragOverShipperId === b.shipper_id
              const shipperAlias = isRegisteredShipper
                ? shippers.find((s) => s.id === b.shipper_id)?.alias || []
                : []
              const isExpanded = isRegisteredShipper && expandedShipperId === b.shipper_id
              return (
                <li key={key}>
                  <div
                    draggable={isUnregisteredRepeat}
                    onDragStart={(e) => {
                      if (!isUnregisteredRepeat) return
                      e.dataTransfer.setData('text/plain', b.sender_name)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      if (!isRegisteredShipper) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDragEnter={() => {
                      if (isRegisteredShipper) setDragOverShipperId(b.shipper_id)
                    }}
                    onDragLeave={() => {
                      if (isRegisteredShipper) setDragOverShipperId((prev) => (prev === b.shipper_id ? null : prev))
                    }}
                    onDrop={(e) => {
                      if (!isRegisteredShipper) return
                      e.preventDefault()
                      setDragOverShipperId(null)
                      const senderName = e.dataTransfer.getData('text/plain')
                      if (senderName) handleMergeCandidate(b.shipper_id, senderName)
                    }}
                    className={`flex w-full items-center gap-1 rounded px-2 py-1 transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      isActive ? 'bg-cyan-50 font-medium text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300' : ''
                    } ${isUnregisteredRepeat ? 'cursor-grab active:cursor-grabbing' : ''} ${
                      isDragOver ? 'ring-2 ring-cyan-400 ring-inset' : ''
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
                      <span className="tabular ml-2 shrink-0 text-xs text-slate-400 dark:text-slate-500">
                        {Number(b.line_count).toLocaleString()}
                      </span>
                    </button>
                    {isUnregisteredRepeat && (
                      <button
                        onClick={() => handleRegisterSender(b.sender_name)}
                        disabled={registeringName === b.sender_name || mergingName === b.sender_name}
                        title="화주사로 등록"
                        className="shrink-0 rounded border border-cyan-200 px-1.5 py-0.5 text-xs text-cyan-700 transition hover:bg-cyan-50 disabled:opacity-50 dark:border-cyan-800 dark:text-cyan-400 dark:hover:bg-cyan-500/10"
                      >
                        {registeringName === b.sender_name ? '등록중' : mergingName === b.sender_name ? '병합중' : '등록'}
                      </button>
                    )}
                    {isRegisteredShipper && shipperAlias.length > 0 && (
                      <button
                        onClick={() => setExpandedShipperId(isExpanded ? null : b.shipper_id)}
                        title="병합된 이름 보기"
                        className="shrink-0 rounded px-1 text-xs text-slate-400 transition hover:bg-slate-200 dark:text-slate-500 dark:hover:bg-slate-700"
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-2 dark:border-slate-800">
                      {shipperAlias.map((alias) => (
                        <div key={alias} className="flex items-center justify-between gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <span className="truncate">{alias}</span>
                          <button
                            onClick={() => handleUnmergeAlias(b.shipper_id, alias)}
                            disabled={unmergingName === alias}
                            title="병합 해제"
                            className="shrink-0 rounded px-1 text-rose-500 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                          >
                            {unmergingName === alias ? '해제중' : '✕'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-2 px-1 text-xs text-slate-400 dark:text-slate-500">
            ● 표시는 화주사 미등록이지만 2건 이상 반복 발송된 송화인입니다. 끌어서 기존 화주사 위에 놓으면 그
            화주사의 별칭으로 병합됩니다.
          </p>
        </Card>

        <section>
          {summary && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard label="건수" value={Number(summary.line_count).toLocaleString()} />
              <KpiCard label="원본(CJ) 합계" value={`${Number(summary.total_original).toLocaleString()}`} unit="원" />
              <KpiCard label="적용 합계" value={`${Number(summary.total_applied).toLocaleString()}`} unit="원" />
              <KpiCard
                label="최종(수정반영) 합계"
                value={`${Number(summary.total_final).toLocaleString()}`}
                unit="원"
                tone="accent"
              />
            </div>
          )}

          <form onSubmit={handleSearch} className="mb-3 flex gap-2">
            <Input
              placeholder="운송장번호 / 송화인 / 받는분 검색"
              className="flex-1"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            <Button type="submit" variant="secondary">
              검색
            </Button>
          </form>

          <Table>
            <THead>
              <Th>집화일자</Th>
              <Th>운송장번호</Th>
              <Th>송화인</Th>
              <Th>받는분</Th>
              <Th className="text-right">원본운임</Th>
              <Th className="text-right">적용금액</Th>
              <Th className="text-right">최종금액</Th>
              <Th></Th>
            </THead>
            <TBody>
              {lines.map((l) => (
                <Tr key={l.id}>
                  <Td className="text-slate-500 dark:text-slate-500">{l.pickup_date}</Td>
                  <Td>{l.tracking_no}</Td>
                  <Td>{l.sender_name}</Td>
                  <Td>{l.receiver_name}</Td>
                  <Td className="tabular text-right text-slate-500 dark:text-slate-500">{Number(l.total_fee).toLocaleString()}</Td>
                  <Td className="tabular text-right">{Number(l.applied_amount).toLocaleString()}</Td>
                  <Td className="tabular text-right font-medium">
                    {editingId === l.id ? (
                      <Input
                        autoFocus
                        type="number"
                        className="w-24 text-right"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                      />
                    ) : (
                      <span className={l.is_manual_edit ? 'text-amber-600 dark:text-amber-400' : ''}>
                        {Number(l.final_amount).toLocaleString()}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    {editingId === l.id ? (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => saveEdit(l)} className="text-xs text-cyan-600 hover:underline dark:text-cyan-400">
                          저장
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs text-slate-400 hover:underline dark:text-slate-500"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(l)}
                        className="text-xs text-slate-500 hover:underline dark:text-slate-400"
                      >
                        수정
                      </button>
                    )}
                  </Td>
                </Tr>
              ))}
              {!loading && lines.length === 0 && <EmptyRow colSpan={8}>조회된 내역이 없습니다.</EmptyRow>}
            </TBody>
          </Table>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <span className="tabular">
              총 {total.toLocaleString()}건 중 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}
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
        </section>
      </div>
    </main>
  )
}
