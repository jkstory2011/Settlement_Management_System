import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { refreshBatchAggregates } from '@/lib/refresh-aggregates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 선택한 여러 라인의 송화인/받는분을 한 번에 같은 값으로 바꾼다.
// 이름이 바뀌면 등록된 화주사명/별칭과 다시 매칭해서 화주사 배정도 함께 갱신한다.
export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const body = await request.json()

  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: '선택된 라인이 없습니다' }, { status: 400 })
  }
  const updateSender = body.sender_name !== undefined
  const updateReceiver = body.receiver_name !== undefined
  if (!updateSender && !updateReceiver) {
    return NextResponse.json({ error: '송화인 또는 받는분 중 하나는 입력해야 합니다' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('update_lines_and_reassign', {
    p_line_ids: ids,
    p_sender_name: body.sender_name ?? null,
    p_receiver_name: body.receiver_name ?? null,
    p_update_sender: updateSender,
    p_update_receiver: updateReceiver,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await refreshBatchAggregates(supabase, batchId)
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 })
  }

  const row = data?.[0] || { updated_count: 0, matched_count: 0 }
  return NextResponse.json({ updated: row.updated_count, matched: row.matched_count })
}
