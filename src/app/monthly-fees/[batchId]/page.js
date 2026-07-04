'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import KpiCard from '@/components/ui/KpiCard'
import PageHeader from '@/components/ui/PageHeader'
import { Input } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'
import StatementsTab from './StatementsTab'
import UnmatchedItemsTab from './UnmatchedItemsTab'

const LINES_COL_STORAGE_KEY = 'monthly-fees-lines-col-widths'
const PAGE_SIZE_STORAGE_KEY = 'monthly-fees-lines-page-size'
const PAGE_SIZE_OPTIONS = [50, 100, 500, 1000]
const DEFAULT_COL_WIDTHS = {
  select: 36,
  pickup_date: 100,
  tracking_no: 130,
  type: 64,
  sender: 120,
  receiver: 120,
  item: 320,
  qty: 64,
  base_fee: 90,
  applied: 90,
  other_fee: 90,
  final: 90,
  actions: 56,
}

// 헤더 우측 경계를 드래그하면 그 칸의 폭을 바꾼다 (colWidths는 localStorage에 저장돼 다음에도 유지됨)
function ResizeHandle({ onResize }) {
  const startXRef = useRef(0)

  function handleMouseDown(e) {
    e.preventDefault()
    e.stopPropagation()
    startXRef.current = e.clientX

    function handleMouseMove(moveEvent) {
      const delta = moveEvent.clientX - startXRef.current
      startXRef.current = moveEvent.clientX
      onResize(delta)
    }
    function handleMouseUp() {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-cyan-400/60"
    />
  )
}

// item_name은 $로 합쳐진 상품명들이며(가끔 한 구간 안에서 ，로 상품이 한 번 더 묶임),
// 각 상품명 끝의 *숫자 / *숫자개 가 그 상품의 실제 수량을 뜻한다(없으면 1개).
// "made*" 같은 장식용 *는 끝에 숫자가 오지 않으므로 걸러진다.
// 상품 종류 수와 실제 총 수량이 다를 수 있어 둘 다 계산한다.
// 합포장 표시 방식이 화주사마다 달라(기본은 품목명을 '$'로 이어붙임, 비전스토리는 "품목명(수량) +"로
// 이어붙임) bundlePattern이 기본값이 아니면 "(수량)" 표기를 직접 세는 방식으로 계산한다.
function bundleLabel(itemName, bundlePattern) {
  if (bundlePattern) {
    const matches = [...itemName.matchAll(/\((\d+)\s*개?\)/g)]
    if (matches.length > 0) {
      const qty = matches.reduce((sum, m) => sum + Number(m[1]), 0)
      return matches.length === qty ? `${qty}개` : `${matches.length}종 · ${qty}개`
    }
  }

  const segments = itemName.split('$').flatMap((seg) => seg.split('，'))
  let qty = 0
  for (const seg of segments) {
    const m = seg.trim().match(/\*(\d+)\s*개?\)?$/)
    qty += m ? Number(m[1]) : 1
  }
  return segments.length === qty ? `${segments.length}개` : `${segments.length}종 · ${qty}개`
}

export default function BatchDetailPage() {
  const { batchId } = useParams()
  const [breakdown, setBreakdown] = useState([])
  // '' 전체 | 'unregistered' 미등록 전체 | `s:${shipperId}` 등록 화주사 | `n:${senderName}` 반복 발송된 미등록 송화인
  const [filterKey, setFilterKey] = useState('')
  const [typeFilter, setTypeFilter] = useState('') // '' 전체 | '일반' | '반품'
  const [packageFilter, setPackageFilter] = useState('') // '' 전체 | '단품' | '합포장'
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
  const [activeTab, setActiveTab] = useState('lines') // 'lines' | 'shippers'
  const [matchNamesInput, setMatchNamesInput] = useState('')
  const [matching, setMatching] = useState(false)
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [editingNameCell, setEditingNameCell] = useState(null) // { id, field: 'sender_name' | 'receiver_name' }
  const [nameEditValue, setNameEditValue] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [bulkSenderInput, setBulkSenderInput] = useState('')
  const [bulkReceiverInput, setBulkReceiverInput] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [pageSize, setPageSize] = useState(50)

  useEffect(() => {
    const saved = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY))
    if (PAGE_SIZE_OPTIONS.includes(saved)) setPageSize(saved)
  }, [])

  function handlePageSizeChange(size) {
    setPageSize(size)
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size))
    setPage(1)
  }

  useEffect(() => {
    const saved = localStorage.getItem(LINES_COL_STORAGE_KEY)
    if (!saved) return
    try {
      setColWidths((prev) => ({ ...prev, ...JSON.parse(saved) }))
    } catch {
      // 저장된 값이 손상됐으면 기본값 유지
    }
  }, [])

  function handleColResize(key, delta) {
    setColWidths((prev) => {
      const next = { ...prev, [key]: Math.max(40, prev[key] + delta) }
      localStorage.setItem(LINES_COL_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === lines.length ? new Set() : new Set(lines.map((l) => l.id))))
  }

  function toggleSelectOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startEditName(line, field) {
    setEditingNameCell({ id: line.id, field })
    setNameEditValue(line[field] || '')
  }

  async function saveEditName(line) {
    const field = editingNameCell.field
    setSavingName(true)
    try {
      const res = await fetch(`/api/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: Number(batchId), [field]: nameEditValue }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '수정 실패')
      setEditingNameCell(null)
      await Promise.all([loadBreakdown(), loadLines()])
      alert(json.matched > 0 ? '수정 완료: 화주사로 이동됐습니다' : '수정 완료: 매칭되는 화주사가 없어 미등록으로 남았습니다')
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingName(false)
    }
  }

  async function handleBulkEdit() {
    if (selectedIds.size === 0) {
      alert('먼저 라인을 선택하세요')
      return
    }
    const senderValue = bulkSenderInput.trim()
    const receiverValue = bulkReceiverInput.trim()
    if (!senderValue && !receiverValue) {
      alert('새 송화인 또는 받는분 중 하나는 입력하세요')
      return
    }
    setBulkSaving(true)
    try {
      const body = { ids: Array.from(selectedIds) }
      if (senderValue) body.sender_name = senderValue
      if (receiverValue) body.receiver_name = receiverValue
      const res = await fetch(`/api/batches/${batchId}/lines/bulk-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '일괄 수정 실패')
      alert(`일괄 수정 완료: ${json.updated}건 변경, ${json.matched}건 화주사로 이동`)
      setSelectedIds(new Set())
      setBulkSenderInput('')
      setBulkReceiverInput('')
      await Promise.all([loadBreakdown(), loadLines()])
    } catch (err) {
      alert(err.message)
    } finally {
      setBulkSaving(false)
    }
  }

  async function handleMatchReturns() {
    const names = matchNamesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (names.length === 0) {
      alert('화주사명을 1개 이상 입력하세요 (쉼표로 구분)')
      return
    }
    setMatching(true)
    try {
      const res = await fetch(`/api/batches/${batchId}/match-returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '매칭 실패')
      alert(`매칭 완료: ${json.matched}건 이동, ${json.unmatched}건은 미등록으로 남음`)
      await Promise.all([loadBreakdown(), loadLines()])
    } catch (err) {
      alert(err.message)
    } finally {
      setMatching(false)
    }
  }

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
    const base =
      filterKey === 'unregistered'
        ? { shipper_id: 'unregistered' }
        : filterKey.startsWith('s:')
          ? { shipper_id: filterKey.slice(2) }
          : filterKey.startsWith('n:')
            ? { sender_name: filterKey.slice(2) }
            : {}
    if (typeFilter) base.type = typeFilter
    if (packageFilter) base.package = packageFilter
    return base
  }

  async function loadLines() {
    setLoading(true)
    const fParams = filterParams()
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...fParams })
    if (q) params.set('q', q)

    const [linesRes] = await Promise.all([fetch(`/api/batches/${batchId}/lines?${params.toString()}`), refreshSummary()])
    const linesJson = await linesRes.json()
    setLines(linesJson.lines || [])
    setTotal(linesJson.total || 0)
    setLoading(false)
  }

  // 라인 목록(최대 1000건)까지 다시 안 불러오고 합계 KPI만 가볍게 갱신할 때 쓴다
  // (건별 수정처럼 이미 화면에 반영된 값을 굳이 다시 통째로 불러올 필요가 없는 경우).
  async function refreshSummary() {
    const fParams = filterParams()
    const summaryQuery = new URLSearchParams(fParams).toString()
    const summaryRes = await fetch(`/api/batches/${batchId}/summary${summaryQuery ? `?${summaryQuery}` : ''}`)
    const summaryJson = await summaryRes.json()
    setSummary(summaryJson.summary)
  }

  useEffect(() => {
    loadBreakdown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId])

  useEffect(() => {
    loadLines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, filterKey, typeFilter, packageFilter, q, page, pageSize])

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
      refreshSummary()
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

  // '미등록(전체)' 카드는 건수 순위와 무관하게 항상 '전체' 바로 다음(맨 앞)에 고정
  const sortedBreakdown = (() => {
    const idx = breakdown.findIndex((b) => b.shipper_id == null && !b.sender_name)
    if (idx <= 0) return breakdown
    const copy = [...breakdown]
    const [unregistered] = copy.splice(idx, 1)
    copy.unshift(unregistered)
    return copy
  })()

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

      <div className="mb-4 inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
        {[
          { value: 'lines', label: '라인 조회' },
          { value: 'shippers', label: '화주사별 건수' },
          { value: 'statements', label: '정산서 발행' },
          { value: 'unmatched', label: '미확인 후보' },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`rounded px-4 py-1.5 text-sm transition ${
              activeTab === tab.value
                ? 'bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'shippers' && (
        <Card className="mb-4 p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-400">반품 화주사 매칭</h2>
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
            반품 건의 받는분에 실제 화주사가 아닌 이름(물류대행사 등)이 찍혀 미등록으로 잡힌 경우, 그 이름을
            입력하면 반품의 송화인+품목명을 일반 건의 받는분+품목명과 매칭해 원래 화주사로 이동시킵니다. 매칭되는
            화주사가 하나로 좁혀지지 않으면 건드리지 않고 미등록으로 남겨둡니다.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="미등록 화주사명 입력, 쉼표로 구분 (예: JKLOGISTIC, JK로지스, 제이케이)"
              className="flex-1"
              value={matchNamesInput}
              onChange={(e) => setMatchNamesInput(e.target.value)}
            />
            <Button variant="secondary" onClick={handleMatchReturns} disabled={matching}>
              {matching ? '매칭 중...' : '매칭 실행'}
            </Button>
          </div>
        </Card>
      )}

      {activeTab === 'shippers' && (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-400">화주사별 건수</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <button
              onClick={() => {
                setFilterKey('')
                setPage(1)
                setActiveTab('lines')
              }}
              className={`rounded-lg border px-3 py-2 text-left text-sm font-medium transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
                filterKey === ''
                  ? 'border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300'
                  : 'border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-200'
              }`}
            >
              전체
            </button>
            {sortedBreakdown.map((b) => {
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
                <div
                  key={key}
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
                  className={`rounded-lg border p-3 text-sm transition ${
                    isActive
                      ? 'border-cyan-300 bg-cyan-50 dark:border-cyan-700 dark:bg-cyan-500/10'
                      : 'border-slate-200 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800'
                  } ${isUnregisteredRepeat ? 'cursor-grab active:cursor-grabbing' : ''} ${
                    isDragOver ? 'ring-2 ring-cyan-400 ring-inset' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <button
                      onClick={() => {
                        setFilterKey(key)
                        setPage(1)
                        setActiveTab('lines')
                      }}
                      title={`일반 ${Number(b.general_count || 0).toLocaleString()} / 반품 ${Number(b.return_count || 0).toLocaleString()}`}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div
                        className={`truncate font-medium ${
                          isActive ? 'text-cyan-700 dark:text-cyan-300' : 'text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {isUnregisteredRepeat && <span className="mr-1 text-amber-500">●</span>}
                        {b.shipper_name}
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="tabular text-xs text-slate-400 dark:text-slate-500">
                          {Number(b.line_count).toLocaleString()}
                        </span>
                        {Number(b.return_count) > 0 && (
                          <span className="tabular text-[10px] text-rose-400 dark:text-rose-500">
                            (반품 {Number(b.return_count).toLocaleString()})
                          </span>
                        )}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
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
                  </div>
                  {isExpanded && (
                    <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-800">
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
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            ● 표시는 화주사 미등록이지만 2건 이상 반복 발송된 송화인입니다. 끌어서 기존 화주사 위에 놓으면 그
            화주사의 별칭으로 병합됩니다.
          </p>
        </Card>
      )}

      {activeTab === 'statements' && <StatementsTab batchId={batchId} />}

      {activeTab === 'unmatched' && <UnmatchedItemsTab batchId={batchId} />}

      {activeTab === 'lines' && (
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

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
              {[
                { value: '', label: '전체' },
                { value: '일반', label: '일반' },
                { value: '반품', label: '반품' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setTypeFilter(opt.value)
                    setPage(1)
                  }}
                  className={`rounded px-3 py-1 text-sm transition ${
                    typeFilter === opt.value
                      ? 'bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
              {[
                { value: '', label: '전체' },
                { value: '단품', label: '단품' },
                { value: '합포장', label: '합포장' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setPackageFilter(opt.value)
                    setPage(1)
                  }}
                  className={`rounded px-3 py-1 text-sm transition ${
                    packageFilter === opt.value
                      ? 'bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <form onSubmit={handleSearch} className="flex flex-1 gap-2">
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
          </div>

          {selectedIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 p-2 dark:border-cyan-800 dark:bg-cyan-500/10">
              <span className="whitespace-nowrap px-1 text-sm text-cyan-700 dark:text-cyan-300">
                {selectedIds.size}건 선택됨
              </span>
              <Input
                placeholder="새 송화인 (선택 안 하면 유지)"
                className="w-48"
                value={bulkSenderInput}
                onChange={(e) => setBulkSenderInput(e.target.value)}
              />
              <Input
                placeholder="새 받는분 (선택 안 하면 유지)"
                className="w-48"
                value={bulkReceiverInput}
                onChange={(e) => setBulkReceiverInput(e.target.value)}
              />
              <Button variant="secondary" onClick={handleBulkEdit} disabled={bulkSaving}>
                {bulkSaving ? '적용 중...' : '일괄 적용'}
              </Button>
              <Button variant="secondary" onClick={() => setSelectedIds(new Set())} disabled={bulkSaving}>
                선택 해제
              </Button>
            </div>
          )}

          <Table className="table-fixed">
            <colgroup>
              <col style={{ width: colWidths.select }} />
              <col style={{ width: colWidths.pickup_date }} />
              <col style={{ width: colWidths.tracking_no }} />
              <col style={{ width: colWidths.type }} />
              <col style={{ width: colWidths.sender }} />
              <col style={{ width: colWidths.receiver }} />
              <col style={{ width: colWidths.item }} />
              <col style={{ width: colWidths.qty }} />
              <col style={{ width: colWidths.base_fee }} />
              <col style={{ width: colWidths.applied }} />
              <col style={{ width: colWidths.other_fee }} />
              <col style={{ width: colWidths.final }} />
              <col style={{ width: colWidths.actions }} />
            </colgroup>
            <THead>
              <Th className="relative">
                <input
                  type="checkbox"
                  checked={lines.length > 0 && selectedIds.size === lines.length}
                  onChange={toggleSelectAll}
                  className="align-middle"
                />
              </Th>
              <Th className="relative">
                집화일자
                <ResizeHandle onResize={(d) => handleColResize('pickup_date', d)} />
              </Th>
              <Th className="relative">
                운송장번호
                <ResizeHandle onResize={(d) => handleColResize('tracking_no', d)} />
              </Th>
              <Th className="relative">
                구분
                <ResizeHandle onResize={(d) => handleColResize('type', d)} />
              </Th>
              <Th className="relative">
                송화인
                <ResizeHandle onResize={(d) => handleColResize('sender', d)} />
              </Th>
              <Th className="relative">
                받는분
                <ResizeHandle onResize={(d) => handleColResize('receiver', d)} />
              </Th>
              <Th className="relative">
                품목명
                <ResizeHandle onResize={(d) => handleColResize('item', d)} />
              </Th>
              <Th className="relative text-right">
                수량
                <ResizeHandle onResize={(d) => handleColResize('qty', d)} />
              </Th>
              <Th className="relative text-right">
                원본운임
                <ResizeHandle onResize={(d) => handleColResize('base_fee', d)} />
              </Th>
              <Th className="relative text-right">
                적용금액
                <ResizeHandle onResize={(d) => handleColResize('applied', d)} />
              </Th>
              <Th className="relative text-right">
                기타운임
                <ResizeHandle onResize={(d) => handleColResize('other_fee', d)} />
              </Th>
              <Th className="relative text-right">
                최종금액
                <ResizeHandle onResize={(d) => handleColResize('final', d)} />
              </Th>
              <Th></Th>
            </THead>
            <TBody>
              {lines.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(l.id)}
                      onChange={() => toggleSelectOne(l.id)}
                      className="align-middle"
                    />
                  </Td>
                  <Td className="text-slate-500 dark:text-slate-500">{l.pickup_date}</Td>
                  <Td>{l.tracking_no}</Td>
                  <Td className="whitespace-nowrap">
                    <span
                      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${
                        l.reservation_type === '반품'
                          ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {l.reservation_type}
                    </span>
                  </Td>
                  <Td>
                    {editingNameCell?.id === l.id && editingNameCell.field === 'sender_name' ? (
                      <div className="flex items-center gap-1">
                        <Input
                          autoFocus
                          className="h-7 text-xs"
                          value={nameEditValue}
                          onChange={(e) => setNameEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditName(l)
                            if (e.key === 'Escape') setEditingNameCell(null)
                          }}
                        />
                        <button
                          onClick={() => saveEditName(l)}
                          disabled={savingName}
                          className="shrink-0 text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => setEditingNameCell(null)}
                          className="shrink-0 text-xs text-slate-400 hover:underline dark:text-slate-500"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditName(l, 'sender_name')}
                        title="클릭해서 수정"
                        className="w-full truncate text-left hover:underline hover:decoration-dotted"
                      >
                        {l.sender_name}
                      </button>
                    )}
                  </Td>
                  <Td>
                    {editingNameCell?.id === l.id && editingNameCell.field === 'receiver_name' ? (
                      <div className="flex items-center gap-1">
                        <Input
                          autoFocus
                          className="h-7 text-xs"
                          value={nameEditValue}
                          onChange={(e) => setNameEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditName(l)
                            if (e.key === 'Escape') setEditingNameCell(null)
                          }}
                        />
                        <button
                          onClick={() => saveEditName(l)}
                          disabled={savingName}
                          className="shrink-0 text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => setEditingNameCell(null)}
                          className="shrink-0 text-xs text-slate-400 hover:underline dark:text-slate-500"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditName(l, 'receiver_name')}
                        title="클릭해서 수정"
                        className="w-full truncate text-left hover:underline hover:decoration-dotted"
                      >
                        {l.receiver_name}
                      </button>
                    )}
                  </Td>
                  <Td className="overflow-hidden text-ellipsis" title={l.item_name}>
                    {l.is_bundled && (
                      <span className="mr-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                        합포장 {bundleLabel(l.item_name, shippers.find((s) => s.id === l.shipper_id)?.bundle_pattern)}
                      </span>
                    )}
                    {l.item_name}
                  </Td>
                  <Td className="tabular text-right">{l.qty}</Td>
                  <Td className="tabular text-right text-slate-500 dark:text-slate-500">{Number(l.total_fee).toLocaleString()}</Td>
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
                        {Number(l.manual_amount ?? l.applied_amount).toLocaleString()}
                      </span>
                    )}
                  </Td>
                  <Td className="tabular text-right text-slate-500 dark:text-slate-500">{Number(l.other_fee).toLocaleString()}</Td>
                  <Td className="tabular text-right text-slate-500 dark:text-slate-500">
                    {Number(l.final_amount).toLocaleString()}
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
              {!loading && lines.length === 0 && <EmptyRow colSpan={13}>조회된 내역이 없습니다.</EmptyRow>}
            </TBody>
          </Table>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span className="tabular">
                총 {total.toLocaleString()}건 중 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}
              </span>
              <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    onClick={() => handlePageSizeChange(size)}
                    className={`rounded px-2.5 py-1 text-xs transition ${
                      pageSize === size
                        ? 'bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950'
                        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {size}건
                  </button>
                ))}
              </div>
            </div>
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
      )}
    </main>
  )
}
