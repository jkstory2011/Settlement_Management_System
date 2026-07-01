import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "화주사로 등록" 버튼 전용: 방금 등록한 화주사에 해당하는 행만 이관한다 (전체 재계산 대신 범위를 좁힌 버전).
export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const body = await request.json()

  const { data, error } = await supabase.rpc('assign_shipper_to_candidate', {
    p_batch_id: batchId,
    p_shipper_id: body.shipper_id,
    p_candidate_name: body.candidate_name,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ updated: data })
}
