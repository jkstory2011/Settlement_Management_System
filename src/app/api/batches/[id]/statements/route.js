// src/app/api/batches/[id]/statements/route.js
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { issueStatement } from '@/lib/statement-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  const { data: summaryRows, error: summaryError } = await supabase
    .from('batch_shipper_summary')
    .select('shipper_id, shipper_name, line_count, total_final')
    .eq('batch_id', batchId)
    .not('shipper_id', 'is', null)
  if (summaryError) return NextResponse.json({ error: summaryError.message }, { status: 500 })

  const { data: statements, error: stError } = await supabase
    .from('shipper_statements')
    .select('id, shipper_id, version, issued_at, line_count, total_final')
    .eq('batch_id', batchId)
    .order('version', { ascending: false })
  if (stError) return NextResponse.json({ error: stError.message }, { status: 500 })

  const latestByShipper = new Map()
  for (const s of statements) {
    if (!latestByShipper.has(s.shipper_id)) latestByShipper.set(s.shipper_id, s)
  }

  const rows = summaryRows
    .filter((r) => Number(r.line_count) > 0)
    .map((r) => {
      const latest = latestByShipper.get(r.shipper_id)
      return {
        shipper_id: r.shipper_id,
        shipper_name: r.shipper_name,
        current_line_count: Number(r.line_count),
        current_total_final: Number(r.total_final),
        latest_statement: latest
          ? {
              id: latest.id,
              version: latest.version,
              issued_at: latest.issued_at,
              line_count: latest.line_count,
              total_final: latest.total_final,
            }
          : null,
      }
    })
    .sort((a, b) => a.shipper_name.localeCompare(b.shipper_name, 'ko'))

  return NextResponse.json({ shippers: rows })
}

export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const body = await request.json()
  const shipperId = Number(body.shipperId)
  if (!shipperId) return NextResponse.json({ error: 'shipperId는 필수입니다.' }, { status: 400 })

  try {
    const statement = await issueStatement(supabase, batchId, shipperId)
    return NextResponse.json({ statement })
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 })
  }
}
