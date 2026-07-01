import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('shipper_rate_tiers').delete().eq('id', Number(params.rateId))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
