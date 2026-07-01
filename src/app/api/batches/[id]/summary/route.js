import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMPTY_SUMMARY = { line_count: 0, total_original: 0, total_applied: 0, total_final: 0 }

// 21만 건짜리 배치를 매 조회마다 라이브로 집계하면 몇 초씩 걸리므로, 업로드/재계산/수동수정 시점에
// 미리 계산해둔 monthly_batches / batch_shipper_summary / batch_shipper_type_summary 캐시를 읽기만 한다.
// 합포장(품목명에 '$' 포함)은 배치 전체에서도 극소수(보통 0.x%)라, 인덱스로 라이브 집계해도 빠르다.
// 단품 합계는 캐시된 기준값에서 합포장 라이브 합계를 빼서 구한다 (별도 캐시 불필요).
export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const { searchParams } = new URL(request.url)
  const shipperParam = searchParams.get('shipper_id')
  const senderName = searchParams.get('sender_name')
  const type = searchParams.get('type') // '일반' | '반품' | null(전체)
  const packageType = searchParams.get('package') // '단품' | '합포장' | null(전체)

  const groupKey = senderName
    ? `sender:${senderName}`
    : shipperParam === 'unregistered'
      ? 'unregistered'
      : shipperParam
        ? `shipper:${shipperParam}`
        : null

  const baseline = await getBaselineSummary(supabase, batchId, groupKey, type)
  if (baseline.error) return NextResponse.json({ error: baseline.error }, { status: 500 })
  if (!packageType) return NextResponse.json({ summary: baseline.summary })

  const bundled = await getBundledSummary(supabase, batchId, groupKey, type)
  if (bundled.error) return NextResponse.json({ error: bundled.error }, { status: 500 })

  if (packageType === '합포장') return NextResponse.json({ summary: bundled.summary })

  // '단품' = 기준값 - 합포장
  const summary = {
    line_count: baseline.summary.line_count - bundled.summary.line_count,
    total_original: baseline.summary.total_original - bundled.summary.total_original,
    total_applied: baseline.summary.total_applied - bundled.summary.total_applied,
    total_final: baseline.summary.total_final - bundled.summary.total_final,
  }
  return NextResponse.json({ summary })
}

async function getBaselineSummary(supabase, batchId, groupKey, type) {
  if (type) {
    if (groupKey) {
      const { data, error } = await supabase
        .from('batch_shipper_type_summary')
        .select('line_count, total_original, total_applied, total_final')
        .eq('batch_id', batchId)
        .eq('group_key', groupKey)
        .eq('reservation_type', type)
        .maybeSingle()
      if (error) return { error: error.message }
      return { summary: data || EMPTY_SUMMARY }
    }

    // 전체 화주사 + 특정 타입: sender:* 는 unregistered와 중복 집계라 제외하고 합산
    const { data, error } = await supabase
      .from('batch_shipper_type_summary')
      .select('line_count, total_original, total_applied, total_final, group_key')
      .eq('batch_id', batchId)
      .eq('reservation_type', type)
    if (error) return { error: error.message }

    const summary = data
      .filter((r) => !r.group_key.startsWith('sender:'))
      .reduce(
        (acc, r) => ({
          line_count: acc.line_count + Number(r.line_count),
          total_original: acc.total_original + Number(r.total_original),
          total_applied: acc.total_applied + Number(r.total_applied),
          total_final: acc.total_final + Number(r.total_final),
        }),
        { line_count: 0, total_original: 0, total_applied: 0, total_final: 0 }
      )
    return { summary }
  }

  if (!groupKey) {
    const { data, error } = await supabase
      .from('monthly_batches')
      .select('total_rows, total_original, total_applied, total_final')
      .eq('id', batchId)
      .single()
    if (error) return { error: error.message }
    return {
      summary: {
        line_count: data.total_rows,
        total_original: data.total_original,
        total_applied: data.total_applied,
        total_final: data.total_final,
      },
    }
  }

  const { data, error } = await supabase
    .from('batch_shipper_summary')
    .select('line_count, total_original, total_applied, total_final')
    .eq('batch_id', batchId)
    .eq('group_key', groupKey)
    .maybeSingle()
  if (error) return { error: error.message }
  return { summary: data || EMPTY_SUMMARY }
}

async function getBundledSummary(supabase, batchId, groupKey, type) {
  let query = supabase
    .from('invoice_lines')
    .select('total_fee, applied_amount, final_amount')
    .eq('batch_id', batchId)
    .eq('is_bundled', true)

  if (groupKey === 'unregistered') {
    query = query.is('shipper_id', null)
  } else if (groupKey?.startsWith('shipper:')) {
    query = query.eq('shipper_id', Number(groupKey.slice('shipper:'.length)))
  } else if (groupKey?.startsWith('sender:')) {
    query = query.is('shipper_id', null).eq('shipper_name_candidate', groupKey.slice('sender:'.length))
  }
  if (type) query = query.eq('reservation_type', type)

  const { data, error } = await query
  if (error) return { error: error.message }

  const summary = (data || []).reduce(
    (acc, r) => ({
      line_count: acc.line_count + 1,
      total_original: acc.total_original + Number(r.total_fee),
      total_applied: acc.total_applied + Number(r.applied_amount),
      total_final: acc.total_final + Number(r.final_amount),
    }),
    { line_count: 0, total_original: 0, total_applied: 0, total_final: 0 }
  )
  return { summary }
}
