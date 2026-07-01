import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const supabase = getSupabaseAdmin()
  const lineId = Number(params.id)
  const body = await request.json()

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
