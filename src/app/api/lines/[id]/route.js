import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { refreshBatchAggregates } from '@/lib/refresh-aggregates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function PATCH(request, { params }) {
  const supabase = getSupabaseAdmin()
  const lineId = Number(params.id)
  const body = await request.json()

  // 송화인/받는분 수정: 이름이 바뀌면 shipper_name_candidate(생성컬럼)도 바뀌므로,
  // 등록된 화주사명/별칭과 다시 매칭해서 화주사 배정도 함께 갱신한다.
  if (body.sender_name !== undefined || body.receiver_name !== undefined) {
    const { data, error } = await supabase.rpc('update_lines_and_reassign', {
      p_line_ids: [lineId],
      p_sender_name: body.sender_name ?? null,
      p_receiver_name: body.receiver_name ?? null,
      p_update_sender: body.sender_name !== undefined,
      p_update_receiver: body.receiver_name !== undefined,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    try {
      await refreshBatchAggregates(supabase, Number(body.batch_id))
    } catch (err) {
      return NextResponse.json({ error: String(err.message || err) }, { status: 500 })
    }

    const row = data?.[0] || { updated_count: 0, matched_count: 0 }
    return NextResponse.json({ updated: row.updated_count, matched: row.matched_count })
  }

  // manual_amount: null이면 수동 수정 해제(원본/적용금액으로 복귀), 값이 있으면 수동 수정
  const manualAmount = body.manual_amount === null || body.manual_amount === '' ? null : Number(body.manual_amount)

  // set_line_manual_amount RPC가 invoice_lines 수정과 동시에 monthly_batches/batch_shipper_summary
  // 캐시도 델타만큼 같이 갱신한다 (전체 재집계 없이 즉시 반영).
  const { data, error } = await supabase.rpc('set_line_manual_amount', {
    p_line_id: lineId,
    p_manual_amount: manualAmount,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ line: data?.[0] })
}
