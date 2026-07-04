'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function MonthlyFeesPage() {
  const [batches, setBatches] = useState([])

  useEffect(() => {
    fetch('/api/batches')
      .then((res) => res.json())
      .then((json) => setBatches(json.batches || []))
  }, [])

  return (
    <main>
      <PageHeader eyebrow="Settlement Console" title="월 택배운임 수정" backHref="/" backLabel="홈으로" />

      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        업로드된 내역서를 선택해서 라인을 조회/수정합니다. 새 내역서 업로드는{' '}
        <Link href="/upload" className="text-cyan-600 underline dark:text-cyan-400">
          데이터 업로드
        </Link>
        에서 합니다.
      </p>

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
