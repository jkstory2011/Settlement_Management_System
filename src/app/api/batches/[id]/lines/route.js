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
  const q = searchParams.get('q')?.trim()

  let query = supabase
    .from('invoice_lines')
    .select(
      'id, no, pickup_date, tracking_no, sender_name, receiver_name, item_name, base_fee, other_fee, total_fee, applied_amount, manual_amount, final_amount, is_manual_edit, shipper_id',
      { count: 'exact' }
    )
    .eq('batch_id', batchId)

  if (senderName) {
    query = query.is('shipper_id', null).eq('shipper_name_candidate', senderName)
  } else if (shipperParam === 'unregistered') {
    query = query.is('shipper_id', null)
  } else if (shipperParam) {
    query = query.eq('shipper_id', Number(shipperParam))
  }

  if (q) {
    query = query.or(`tracking_no.ilike.%${q}%,sender_name.ilike.%${q}%,receiver_name.ilike.%${q}%`)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, error, count } = await query.order('no', { ascending: true }).range(from, to)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ lines: data, total: count, page, pageSize: PAGE_SIZE })
}
