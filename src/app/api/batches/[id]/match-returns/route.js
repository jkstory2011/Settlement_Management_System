import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { refreshBatchAggregates } from '@/lib/refresh-aggregates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 반품 건의 받는분에 물류대행사 이름 등 화주사가 아닌 값이 찍혀 미등록으로 잡힌 경우를 위한 도구.
// 반품의 (송화인+품목명)을 일반 건의 (받는분+품목명 접두어)와 매칭해 원래 화주사를 찾아 이관하고,
// 매칭되는 화주사가 하나로 좁혀지지 않으면 건드리지 않고 미등록으로 남긴다.
export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const body = await request.json()

  const names = Array.isArray(body.names) ? body.names.map((n) => n.trim()).filter(Boolean) : []
  if (names.length === 0) {
    return NextResponse.json({ error: '화주사명을 1개 이상 입력하세요' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('match_return_candidates_to_general', {
    p_batch_id: batchId,
    p_candidate_names: names,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await refreshBatchAggregates(supabase, batchId)
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 })
  }

  const row = data?.[0] || { matched_count: 0, unmatched_count: 0 }
  return NextResponse.json({ matched: row.matched_count, unmatched: row.unmatched_count })
}
