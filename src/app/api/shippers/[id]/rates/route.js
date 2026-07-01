import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const shipperId = Number(params.id)
  const { data, error } = await supabase
    .from('shipper_rate_tiers')
    .select('id, cj_base_fee, contract_price, effective_from')
    .eq('shipper_id', shipperId)
    .order('cj_base_fee', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rates: data })
}

export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const shipperId = Number(params.id)
  const body = await request.json()

  if (body.cj_base_fee == null || body.contract_price == null) {
    return NextResponse.json({ error: 'cj_base_fee, contract_price는 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('shipper_rate_tiers')
    .upsert(
      {
        shipper_id: shipperId,
        cj_base_fee: Number(body.cj_base_fee),
        contract_price: Number(body.contract_price),
        effective_from: body.effective_from || new Date().toISOString().slice(0, 10),
      },
      { onConflict: 'shipper_id,cj_base_fee,effective_from' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rate: data })
}
