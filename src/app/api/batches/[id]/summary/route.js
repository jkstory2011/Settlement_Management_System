import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const { searchParams } = new URL(request.url)
  const shipperParam = searchParams.get('shipper_id')
  const senderName = searchParams.get('sender_name')

  const { data, error } = await supabase.rpc('batch_line_summary', {
    p_batch_id: batchId,
    p_shipper_id: shipperParam && shipperParam !== 'unregistered' ? Number(shipperParam) : null,
    p_unregistered: shipperParam === 'unregistered',
    p_sender_name: senderName || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ summary: data?.[0] || null })
}
