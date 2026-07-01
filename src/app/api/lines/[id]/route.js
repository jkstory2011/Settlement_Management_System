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

  const { data, error } = await supabase
    .from('invoice_lines')
    .update({ manual_amount: manualAmount, is_manual_edit: manualAmount !== null })
    .eq('id', lineId)
    .select('id, manual_amount, is_manual_edit, final_amount')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ line: data })
}
