import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 반복 미등록 이름(예: 정성우)을 이미 등록된 화주사(예: 디미트리블랙)에 병합한다.
// 1) 그 이름을 화주사의 alias에 추가해 앞으로도 자동 매칭되게 하고
// 2) assign_shipper_to_candidate로 해당 이름의 행만 그 화주사로 즉시 이관한다.
export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const body = await request.json()
  const shipperId = Number(body.shipper_id)
  const candidateName = body.candidate_name

  if (!shipperId || !candidateName) {
    return NextResponse.json({ error: 'shipper_id, candidate_name은 필수입니다.' }, { status: 400 })
  }

  const { data: shipper, error: shipperError } = await supabase
    .from('shippers')
    .select('alias')
    .eq('id', shipperId)
    .single()
  if (shipperError) return NextResponse.json({ error: shipperError.message }, { status: 500 })

  if (!(shipper.alias || []).includes(candidateName)) {
    const { error: updateError } = await supabase
      .from('shippers')
      .update({ alias: [...(shipper.alias || []), candidateName] })
      .eq('id', shipperId)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const { data, error } = await supabase.rpc('assign_shipper_to_candidate', {
    p_batch_id: batchId,
    p_shipper_id: shipperId,
    p_candidate_name: candidateName,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ updated: data })
}
