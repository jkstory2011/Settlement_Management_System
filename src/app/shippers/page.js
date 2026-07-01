'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import { Input } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function ShippersPage() {
  const [shippers, setShippers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', alias: '', contact: '', memo: '' })
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/shippers')
    const json = await res.json()
    setShippers(json.shippers || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/shippers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        alias: form.alias.split(',').map((s) => s.trim()).filter(Boolean),
        contact: form.contact,
        memo: form.memo,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || '등록 실패')
      return
    }
    setForm({ name: '', alias: '', contact: '', memo: '' })
    load()
  }

  async function toggleActive(shipper) {
    await fetch(`/api/shippers/${shipper.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !shipper.is_active }),
    })
    load()
  }

  async function remove(shipper) {
    if (!confirm(`${shipper.name} 화주사를 삭제할까요? 등록된 구간표도 함께 삭제됩니다.`)) return
    await fetch(`/api/shippers/${shipper.id}`, { method: 'DELETE' })
    load()
  }

  return (
    <main>
      <PageHeader eyebrow="Settlement Console" title="화주사 관리" backHref="/" backLabel="홈으로" />

      <Card className="mb-6 p-4">
        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            required
            placeholder="화주사명 (필수, 송화인 표기와 일치)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder="별칭 (콤마로 구분, 선택)"
            value={form.alias}
            onChange={(e) => setForm({ ...form, alias: e.target.value })}
          />
          <Input placeholder="연락처" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <Input placeholder="메모" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          <Button type="submit" className="sm:col-span-2 lg:col-span-1">
            화주사 등록
          </Button>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-4">{error}</p>}
        </form>
      </Card>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">불러오는 중...</p>
      ) : (
        <Table>
          <THead>
            <Th>화주사명</Th>
            <Th>별칭</Th>
            <Th>연락처</Th>
            <Th>상태</Th>
            <Th>구간표</Th>
            <Th></Th>
          </THead>
          <TBody>
            {shippers.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium text-slate-900 dark:text-slate-200">{s.name}</Td>
                <Td className="text-slate-500 dark:text-slate-500">{(s.alias || []).join(', ')}</Td>
                <Td className="text-slate-500 dark:text-slate-500">{s.contact}</Td>
                <Td>
                  <button
                    onClick={() => toggleActive(s)}
                    className={`rounded px-2 py-1 text-xs font-medium transition ${
                      s.is_active
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                    }`}
                  >
                    {s.is_active ? '사용중' : '중지'}
                  </button>
                </Td>
                <Td>
                  <Link href={`/shippers/${s.id}/rates`} className="text-cyan-600 hover:underline dark:text-cyan-400">
                    구간표 관리
                  </Link>
                </Td>
                <Td className="text-right">
                  <button onClick={() => remove(s)} className="text-xs text-rose-500 hover:underline dark:text-rose-400">
                    삭제
                  </button>
                </Td>
              </Tr>
            ))}
            {shippers.length === 0 && <EmptyRow colSpan={6}>등록된 화주사가 없습니다.</EmptyRow>}
          </TBody>
        </Table>
      )}
    </main>
  )
}
