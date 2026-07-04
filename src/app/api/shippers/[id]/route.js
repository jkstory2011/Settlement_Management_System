import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { refreshBatchAggregates } from '@/lib/refresh-aggregates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)
  const body = await request.json()

  const update = {}
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.alias !== undefined) update.alias = Array.isArray(body.alias) ? body.alias.filter(Boolean) : []
  if (body.biz_no !== undefined) update.biz_no = body.biz_no || null
  if (body.contact !== undefined) update.contact = body.contact || null
  if (body.memo !== undefined) update.memo = body.memo || null
  if (body.is_active !== undefined) update.is_active = Boolean(body.is_active)
  if (body.bundle_pattern !== undefined) {
    const pattern = body.bundle_pattern?.trim() || null
    if (pattern) {
      try {
        new RegExp(pattern)
      } catch {
        return NextResponse.json({ error: '합포장 판별 정규식이 올바르지 않습니다.' }, { status: 400 })
      }
    }
    update.bundle_pattern = pattern
  }

  const { data, error } = await supabase.from('shippers').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shipper: data })
}

export async function DELETE(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)

  // 삭제 전에 이 화주사 캐시 행이 걸려있는 배치들을 미리 찾아둔다 (삭제 후에는 group_key로 못 찾음).
  const { data: affected, error: affectedError } = await supabase
    .from('batch_shipper_summary')
    .select('batch_id')
    .eq('group_key', `shipper:${id}`)
  if (affectedError) return NextResponse.json({ error: affectedError.message }, { status: 500 })

  const { error } = await supabase.from('shippers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // FK가 invoice_lines.shipper_id는 null로 되돌려주지만 캐시 테이블은 그대로 남으므로,
  // 영향받은 배치들의 캐시/합계를 다시 계산해서 고아 데이터가 남지 않게 한다.
  for (const row of affected || []) {
    try {
      await refreshBatchAggregates(supabase, row.batch_id)
    } catch (err) {
      return NextResponse.json(
        { ok: true, warning: `화주사는 삭제됐지만 배치 ${row.batch_id} 캐시 재계산에 실패했습니다: ${String(err.message || err)}` },
        { status: 200 }
      )
    }
  }

  return NextResponse.json({ ok: true })
}
