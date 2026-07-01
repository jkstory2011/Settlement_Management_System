import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// merge-candidate의 반대: 화주사 별칭에서 이 이름을 빼고, 이 배치에서 그 이름에 해당하는 행을 다시 미등록으로 되돌린다.
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

  const nextAlias = (shipper.alias || []).filter((a) => a !== candidateName)
  if (nextAlias.length !== (shipper.alias || []).length) {
    const { error: updateError } = await supabase.from('shippers').update({ alias: nextAlias }).eq('id', shipperId)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const { data, error } = await supabase.rpc('unassign_shipper_candidate', {
    p_batch_id: batchId,
    p_shipper_id: shipperId,
    p_candidate_name: candidateName,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ updated: data })
}
