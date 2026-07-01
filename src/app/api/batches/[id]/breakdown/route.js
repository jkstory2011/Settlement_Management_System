import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  const { data, error } = await supabase.rpc('batch_shipper_breakdown', { p_batch_id: batchId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ breakdown: data })
}
