import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// batch_shipper_summary는 업로드/재계산 시점에 미리 계산해둔 캐시. 21만 건을 매번 라이브로
// group by 하면 몇 초씩 걸려서, 조회는 이 캐시 테이블만 읽는다.
export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  const { data, error } = await supabase
    .from('batch_shipper_summary')
    .select('shipper_id, shipper_name, line_count, total_final, sender_name')
    .eq('batch_id', batchId)
    .order('line_count', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ breakdown: data })
}
