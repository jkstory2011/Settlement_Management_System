import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// batch_shipper_summary/batch_shipper_type_summary는 업로드/재계산 시점에 미리 계산해둔 캐시.
// 21만 건을 매번 라이브로 group by 하면 몇 초씩 걸려서, 조회는 이 캐시 테이블만 읽는다.
export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  const [{ data, error }, { data: typeData, error: typeError }] = await Promise.all([
    supabase
      .from('batch_shipper_summary')
      .select('shipper_id, shipper_name, line_count, total_final, sender_name')
      .eq('batch_id', batchId)
      .order('line_count', { ascending: false }),
    supabase
      .from('batch_shipper_type_summary')
      .select('group_key, reservation_type, line_count')
      .eq('batch_id', batchId),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (typeError) return NextResponse.json({ error: typeError.message }, { status: 500 })

  const typeByGroup = new Map()
  for (const row of typeData) {
    const key = row.group_key
    if (!typeByGroup.has(key)) typeByGroup.set(key, { general_count: 0, return_count: 0 })
    const entry = typeByGroup.get(key)
    if (row.reservation_type === '반품') entry.return_count = row.line_count
    else entry.general_count = row.line_count
  }

  const breakdown = data.map((row) => {
    const groupKey = row.sender_name ? `sender:${row.sender_name}` : row.shipper_id == null ? 'unregistered' : `shipper:${row.shipper_id}`
    const counts = typeByGroup.get(groupKey) || { general_count: 0, return_count: 0 }
    return { ...row, ...counts }
  })

  return NextResponse.json({ breakdown })
}
