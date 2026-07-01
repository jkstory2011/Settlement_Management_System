import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_PAGE_SIZE = 50
const ALLOWED_PAGE_SIZES = [50, 100, 500, 1000]

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('page') || '1')
  const requestedPageSize = Number(searchParams.get('pageSize'))
  const PAGE_SIZE = ALLOWED_PAGE_SIZES.includes(requestedPageSize) ? requestedPageSize : DEFAULT_PAGE_SIZE
  const shipperParam = searchParams.get('shipper_id') // 'unregistered' | shipper id | null(전체)
  const senderName = searchParams.get('sender_name') // 반복 발송된 미등록 화주사 후보 그룹 필터 (shipper_name_candidate 기준)
  const type = searchParams.get('type') // '일반' | '반품' | null(전체)
  const packageType = searchParams.get('package') // '단품' | '합포장' | null(전체)
  const q = searchParams.get('q')?.trim()

  // 합포장은 배치 전체에서도 극소수라 count:'exact'를 요청해도 빠르다 (인덱스로 바로 걸러짐).
  // 반대로 '단품'(대다수)까지 포함해서 정확한 개수를 셀 필요는 없으므로, 그 경우는 기존 캐시 값을 그대로 쓴다.
  const needsLiveCount = Boolean(q) || packageType === '합포장'

  let query = supabase
    .from('invoice_lines')
    .select(
      'id, no, pickup_date, tracking_no, sender_name, receiver_name, item_name, qty, base_fee, other_fee, total_fee, applied_amount, manual_amount, final_amount, is_manual_edit, shipper_id, reservation_type, is_bundled',
      needsLiveCount ? { count: 'exact' } : {}
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

  if (packageType) {
    query = query.eq('is_bundled', packageType === '합포장')
  }

  if (q) {
    query = query.or(`tracking_no.ilike.%${q}%,sender_name.ilike.%${q}%,receiver_name.ilike.%${q}%`)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, error, count } = await query.order('no', { ascending: true }).range(from, to)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let total = count
  if (!needsLiveCount) {
    let baseTotal
    if (type) {
      if (groupKey) {
        const { data: cached } = await supabase
          .from('batch_shipper_type_summary')
          .select('line_count')
          .eq('batch_id', batchId)
          .eq('group_key', groupKey)
          .eq('reservation_type', type)
          .maybeSingle()
        baseTotal = cached?.line_count ?? 0
      } else {
        const { data: rows } = await supabase
          .from('batch_shipper_type_summary')
          .select('line_count, group_key')
          .eq('batch_id', batchId)
          .eq('reservation_type', type)
        baseTotal = (rows || []).filter((r) => !r.group_key.startsWith('sender:')).reduce((sum, r) => sum + Number(r.line_count), 0)
      }
    } else if (groupKey) {
      const { data: cached } = await supabase
        .from('batch_shipper_summary')
        .select('line_count')
        .eq('batch_id', batchId)
        .eq('group_key', groupKey)
        .maybeSingle()
      baseTotal = cached?.line_count ?? 0
    } else {
      const { data: batch } = await supabase.from('monthly_batches').select('total_rows').eq('id', batchId).single()
      baseTotal = batch?.total_rows ?? 0
    }

    if (packageType === '단품') {
      // 단품 = 기준값 - 합포장(라이브, 항상 소수라 빠름)
      let bundledQuery = supabase
        .from('invoice_lines')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('is_bundled', true)
      if (senderName) bundledQuery = bundledQuery.is('shipper_id', null).eq('shipper_name_candidate', senderName)
      else if (shipperParam === 'unregistered') bundledQuery = bundledQuery.is('shipper_id', null)
      else if (shipperParam) bundledQuery = bundledQuery.eq('shipper_id', Number(shipperParam))
      if (type) bundledQuery = bundledQuery.eq('reservation_type', type)

      const { count: bundledCount } = await bundledQuery
      total = baseTotal - (bundledCount ?? 0)
    } else {
      total = baseTotal
    }
  }

  return NextResponse.json({ lines: data, total, page, pageSize: PAGE_SIZE })
}
