// src/app/api/batches/[id]/statements/bulk/route.js
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { issueStatement } from '@/lib/statement-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  const { data: summaryRows, error } = await supabase
    .from('batch_shipper_summary')
    .select('shipper_id, line_count')
    .eq('batch_id', batchId)
    .not('shipper_id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const shipperIds = summaryRows.filter((r) => Number(r.line_count) > 0).map((r) => r.shipper_id)

  const results = []
  for (const shipperId of shipperIds) {
    try {
      const statement = await issueStatement(supabase, batchId, shipperId)
      results.push({ shipperId, ok: true, statement })
    } catch (err) {
      results.push({ shipperId, ok: false, error: String(err.message || err) })
    }
  }

  return NextResponse.json({ results })
}
