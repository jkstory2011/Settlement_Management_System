'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">화주사 관리</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          홈으로
        </Link>
      </div>

      <form onSubmit={handleCreate} className="mb-6 grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input
          required
          placeholder="화주사명 (필수, 송화인 표기와 일치)"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          placeholder="별칭 (콤마로 구분, 선택)"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
          value={form.alias}
          onChange={(e) => setForm({ ...form, alias: e.target.value })}
        />
        <input
          placeholder="연락처"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
        />
        <input
          placeholder="메모"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
          value={form.memo}
          onChange={(e) => setForm({ ...form, memo: e.target.value })}
        />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:col-span-2 lg:col-span-1">
          화주사 등록
        </button>
        {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">불러오는 중...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2">화주사명</th>
                <th className="px-4 py-2">별칭</th>
                <th className="px-4 py-2">연락처</th>
                <th className="px-4 py-2">상태</th>
                <th className="px-4 py-2">구간표</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shippers.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-4 py-2 text-gray-500">{(s.alias || []).join(', ')}</td>
                  <td className="px-4 py-2 text-gray-500">{s.contact}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleActive(s)}
                      className={`rounded px-2 py-1 text-xs ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                    >
                      {s.is_active ? '사용중' : '중지'}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/shippers/${s.id}/rates`} className="text-blue-600 hover:underline">
                      구간표 관리
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => remove(s)} className="text-xs text-red-500 hover:underline">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {shippers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    등록된 화주사가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
