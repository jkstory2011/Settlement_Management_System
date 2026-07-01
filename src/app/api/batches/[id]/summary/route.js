import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 21만 건짜리 배치를 매 조회마다 라이브로 집계하면 몇 초씩 걸리므로, 업로드/재계산/수동수정 시점에
// 미리 계산해둔 monthly_batches / batch_shipper_summary 캐시를 읽기만 한다.
export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const { searchParams } = new URL(request.url)
  const shipperParam = searchParams.get('shipper_id')
  const senderName = searchParams.get('sender_name')

  const groupKey = senderName
    ? `sender:${senderName}`
    : shipperParam === 'unregistered'
      ? 'unregistered'
      : shipperParam
        ? `shipper:${shipperParam}`
        : null

  if (!groupKey) {
    const { data, error } = await supabase
      .from('monthly_batches')
      .select('total_rows, total_original, total_applied, total_final')
      .eq('id', batchId)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      summary: {
        line_count: data.total_rows,
        total_original: data.total_original,
        total_applied: data.total_applied,
        total_final: data.total_final,
      },
    })
  }

  const { data, error } = await supabase
    .from('batch_shipper_summary')
    .select('line_count, total_original, total_applied, total_final')
    .eq('batch_id', batchId)
    .eq('group_key', groupKey)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    summary: data || { line_count: 0, total_original: 0, total_applied: 0, total_final: 0 },
  })
}
