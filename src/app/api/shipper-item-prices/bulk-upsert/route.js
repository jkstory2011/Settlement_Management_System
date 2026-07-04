import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 화주사가 완성해둔 참조 파일(품목명별 계약단가)을 일괄 저장할 때 쓰는 1회성 임포트 엔드포인트.
// 화면 UI는 없고, scratch 임포트 스크립트에서만 호출한다.
export async function POST(request) {
  const supabase = getSupabaseAdmin()
  const rows = await request.json()

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows 배열이 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('shipper_item_prices')
    .upsert(
      rows.map((r) => ({
        shipper_id: r.shipper_id,
        item_name: r.item_name,
        contract_price: r.contract_price,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'shipper_id,item_name' }
    )
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ upserted: data.length })
}
