import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { refreshBatchAggregates } from '@/lib/refresh-aggregates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// shipper_item_prices에 완전히 같은 문자열로는 없지만(품질보증 문구 등 사소한 차이), 접두어가
// 서로 겹치는 후보가 있는 품목만 조회한다. 배치 전체를 훑으면 느려서 화주사 단위로 스코프를 좁힌다.
export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const { searchParams } = new URL(request.url)
  const shipperId = Number(searchParams.get('shipperId'))
  if (!shipperId) return NextResponse.json({ error: 'shipperId는 필수입니다.' }, { status: 400 })

  const { data, error } = await supabase.rpc('batch_unmatched_item_candidates', {
    p_batch_id: batchId,
    p_shipper_id: shipperId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ candidates: data })
}

// 사람이 "이 품목이 맞다"고 승인하면: 1) 그 품목명 그대로 shipper_item_prices에 새로 등록해서
// 다음부터는 자동 매칭되게 하고, 2) 지금 배치의 해당 라인들만 즉시 반영한다.
export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const body = await request.json()
  const { shipperId, itemName, contractPrice } = body

  if (!shipperId || !itemName || contractPrice == null) {
    return NextResponse.json({ error: 'shipperId, itemName, contractPrice는 필수입니다.' }, { status: 400 })
  }

  const { error: upsertError } = await supabase
    .from('shipper_item_prices')
    .upsert(
      { shipper_id: shipperId, item_name: itemName, contract_price: Number(contractPrice), updated_at: new Date().toISOString() },
      { onConflict: 'shipper_id,item_name' }
    )
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

  const { data: lines, error: linesError } = await supabase
    .from('invoice_lines')
    .select('id, other_fee, manual_amount')
    .eq('batch_id', batchId)
    .eq('shipper_id', shipperId)
    .eq('item_name', itemName)
  if (linesError) return NextResponse.json({ error: linesError.message }, { status: 500 })

  // final_amount는 생성 컬럼이 아니라 일반 컬럼이라 여기서도 직접 계산해서 같이 넣는다.
  // 수동 수정(manual_amount)이 이미 걸려있는 라인은 그 값이 우선이므로 건드리지 않는다.
  for (const line of lines) {
    const finalAmount = (line.manual_amount ?? Number(contractPrice)) + Number(line.other_fee || 0)
    const { error: updateError } = await supabase
      .from('invoice_lines')
      .update({ applied_amount: Number(contractPrice), final_amount: finalAmount })
      .eq('id', line.id)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  try {
    await refreshBatchAggregates(supabase, batchId)
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 })
  }

  return NextResponse.json({ updated: lines.length })
}
