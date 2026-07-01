'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import { Input } from '@/components/ui/Input'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function CarriersPage() {
  const [carriers, setCarriers] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/carriers')
    const json = await res.json()
    setCarriers(json.carriers || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/carriers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || '등록 실패')
      return
    }
    setName('')
    load()
  }

  return (
    <main>
      <PageHeader eyebrow="Settlement Console" title="택배사 양식 관리" backHref="/" backLabel="홈으로" />

      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        택배사마다 원본 내역서의 컬럼 배치가 다를 수 있습니다. 업로드 전에 각 택배사의 양식(헤더 행 수, 컬럼 번호)을 먼저
        등록해야 합니다.
      </p>

      <Card className="mb-6 p-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <Input required placeholder="새 택배사명" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">택배사 등록</Button>
          {error && <p className="w-full text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      </Card>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">불러오는 중...</p>
      ) : (
        <Table>
          <THead>
            <Th>택배사명</Th>
            <Th>양식 상태</Th>
            <Th></Th>
          </THead>
          <TBody>
            {carriers.map((c) => {
              const configured = c.format_config && Object.keys(c.format_config.columns || {}).length > 0
              return (
                <Tr key={c.id}>
                  <Td className="font-medium text-slate-900 dark:text-slate-200">{c.name}</Td>
                  <Td>
                    <Badge tone={configured ? 'success' : 'warn'}>{configured ? '설정됨' : '미설정'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <Link href={`/carriers/${c.id}`} className="text-cyan-600 hover:underline dark:text-cyan-400">
                      양식 편집
                    </Link>
                  </Td>
                </Tr>
              )
            })}
            {carriers.length === 0 && <EmptyRow colSpan={3}>등록된 택배사가 없습니다.</EmptyRow>}
          </TBody>
        </Table>
      )}
    </main>
  )
}
