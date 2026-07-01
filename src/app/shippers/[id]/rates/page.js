'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function ShipperRatesPage() {
  const { id } = useParams()
  const [rates, setRates] = useState([])
  const [shipperName, setShipperName] = useState('')
  const [form, setForm] = useState({ cj_base_fee: '', contract_price: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [ratesRes, shipperRes] = await Promise.all([
      fetch(`/api/shippers/${id}/rates`),
      fetch('/api/shippers'),
    ])
    const ratesJson = await ratesRes.json()
    const shippersJson = await shipperRes.json()
    setRates(ratesJson.rates || [])
    setShipperName(shippersJson.shippers?.find((s) => String(s.id) === String(id))?.name || '')
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [id])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    const res = await fetch(`/api/shippers/${id}/rates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cj_base_fee: form.cj_base_fee, contract_price: form.contract_price }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || '등록 실패')
      return
    }
    setForm({ cj_base_fee: '', contract_price: '' })
    load()
  }

  async function remove(rateId) {
    await fetch(`/api/shippers/${id}/rates/${rateId}`, { method: 'DELETE' })
    load()
  }

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{shipperName || '화주사'} 구간별 계약 단가표</h1>
        <Link href="/shippers" className="text-sm text-blue-600 hover:underline">
          화주사 목록으로
        </Link>
      </div>

      <p className="mb-4 text-sm text-gray-500">
        CJ대한통운 원본 내역서의 기본운임 값(구간 식별자)별로 이 화주사에게 청구할 계약 단가를 등록합니다.
        등록되지 않은 구간은 원본 CJ운임(총운임)을 그대로 사용합니다.
      </p>

      <form onSubmit={handleCreate} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">CJ 기본운임(구간)</label>
          <input
            required
            type="number"
            className="w-40 rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.cj_base_fee}
            onChange={(e) => setForm({ ...form, cj_base_fee: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">계약 단가</label>
          <input
            required
            type="number"
            className="w-40 rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.contract_price}
            onChange={(e) => setForm({ ...form, contract_price: e.target.value })}
          />
        </div>
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          구간 등록/수정
        </button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">불러오는 중...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2">CJ 기본운임(구간)</th>
                <th className="px-4 py-2">계약 단가</th>
                <th className="px-4 py-2">적용 시작일</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{Number(r.cj_base_fee).toLocaleString()}원</td>
                  <td className="px-4 py-2 font-medium">{Number(r.contract_price).toLocaleString()}원</td>
                  <td className="px-4 py-2 text-gray-500">{r.effective_from}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => remove(r.id)} className="text-xs text-red-500 hover:underline">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                    등록된 구간이 없습니다. 등록 전까지는 원본 CJ운임이 그대로 적용됩니다.
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
