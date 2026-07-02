import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)

  const { data: current, error: currentError } = await supabase
    .from('shipper_statements')
    .select('batch_id, shipper_id')
    .eq('id', id)
    .single()
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })

  const { data, error } = await supabase
    .from('shipper_statements')
    .select('id, version, issued_at, line_count, total_final')
    .eq('batch_id', current.batch_id)
    .eq('shipper_id', current.shipper_id)
    .order('version', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ history: data })
}
