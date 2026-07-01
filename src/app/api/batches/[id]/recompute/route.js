import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { refreshBatchAggregates } from '@/lib/refresh-aggregates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CHUNK_SIZE = 20000

// 화주사/구간표가 업로드 이후에 바뀐 경우, 해당 배치의 shipper_id/applied_amount를 다시 계산한다.
// 수동 수정(manual_amount)은 건드리지 않는다. DB statement_timeout을 피하기 위해 청크 단위로 여러 번 호출한다.
export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  let afterId = 0
  let total = 0

  for (;;) {
    const { data, error } = await supabase.rpc('recompute_batch_applied_amounts_chunk', {
      p_batch_id: batchId,
      p_after_id: afterId,
      p_limit: CHUNK_SIZE,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const row = data?.[0]
    if (!row || row.scanned_count === 0) break

    total += row.updated_count
    afterId = row.last_id
    if (row.scanned_count < CHUNK_SIZE) break
  }

  try {
    await refreshBatchAggregates(supabase, batchId)
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 })
  }

  return NextResponse.json({ updated: total })
}
