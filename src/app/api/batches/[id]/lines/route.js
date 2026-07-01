import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('page') || '1')
  const shipperParam = searchParams.get('shipper_id') // 'unregistered' | shipper id | null(전체)
  const senderName = searchParams.get('sender_name') // 반복 발송된 미등록 화주사 후보 그룹 필터 (shipper_name_candidate 기준)
  const type = searchParams.get('type') // '일반' | '반품' | null(전체)
  const q = searchParams.get('q')?.trim()

  let query = supabase
    .from('invoice_lines')
    .select(
      'id, no, pickup_date, tracking_no, sender_name, receiver_name, item_name, base_fee, other_fee, total_fee, applied_amount, manual_amount, final_amount, is_manual_edit, shipper_id, reservation_type',
      // 검색어가 없으면 count:'exact'를 요청하지 않는다 -- 21만 건짜리 배치에서 매번 COUNT(*)를 다시 하면
      // 몇 초씩 걸려서, 검색이 없을 때는 미리 계산해둔 캐시(batch_shipper_summary/monthly_batches)의
      // 건수를 대신 사용한다. 검색어가 있을 때만 그 하위집합에 대해 정확한 개수를 새로 센다.
      q ? { count: 'exact' } : {}
    )
    .eq('batch_id', batchId)

  const groupKey = senderName ? `sender:${senderName}` : shipperParam === 'unregistered' ? 'unregistered' : shipperParam ? `shipper:${shipperParam}` : null

  if (senderName) {
    query = query.is('shipper_id', null).eq('shipper_name_candidate', senderName)
  } else if (shipperParam === 'unregistered') {
    query = query.is('shipper_id', null)
  } else if (shipperParam) {
    query = query.eq('shipper_id', Number(shipperParam))
  }

  if (type) {
    query = query.eq('reservation_type', type)
  }

  if (q) {
    query = query.or(`tracking_no.ilike.%${q}%,sender_name.ilike.%${q}%,receiver_name.ilike.%${q}%`)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, error, count } = await query.order('no', { ascending: true }).range(from, to)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let total = count
  if (!q) {
    if (type) {
      if (groupKey) {
        const { data: cached } = await supabase
          .from('batch_shipper_type_summary')
          .select('line_count')
          .eq('batch_id', batchId)
          .eq('group_key', groupKey)
          .eq('reservation_type', type)
          .maybeSingle()
        total = cached?.line_count ?? 0
      } else {
        const { data: rows } = await supabase
          .from('batch_shipper_type_summary')
          .select('line_count, group_key')
          .eq('batch_id', batchId)
          .eq('reservation_type', type)
        total = (rows || []).filter((r) => !r.group_key.startsWith('sender:')).reduce((sum, r) => sum + Number(r.line_count), 0)
      }
    } else if (groupKey) {
      const { data: cached } = await supabase
        .from('batch_shipper_summary')
        .select('line_count')
        .eq('batch_id', batchId)
        .eq('group_key', groupKey)
        .maybeSingle()
      total = cached?.line_count ?? 0
    } else {
      const { data: batch } = await supabase.from('monthly_batches').select('total_rows').eq('id', batchId).single()
      total = batch?.total_rows ?? 0
    }
  }

  return NextResponse.json({ lines: data, total, page, pageSize: PAGE_SIZE })
}
