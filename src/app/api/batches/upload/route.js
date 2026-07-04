import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { parseInvoiceBuffer } from '@/lib/xlsx-parse'
import {
  buildShipperIndex,
  buildItemPriceIndex,
  buildBundlePatternIndex,
  resolveShipperId,
  computeAppliedAmount,
  isBundled,
  getShipperNameCandidate,
} from '@/lib/shipper-match'
import { refreshBatchAggregates } from '@/lib/refresh-aggregates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const INSERT_CHUNK_SIZE = 1000

export async function POST(request) {
  const supabase = getSupabaseAdmin()
  let batchId = null

  try {
    const form = await request.formData()
    const file = form.get('file')
    const carrierId = Number(form.get('carrier_id'))
    const yearMonth = form.get('year_month')

    if (!file || !carrierId || !yearMonth) {
      return NextResponse.json({ error: 'file, carrier_id, year_month은 필수입니다.' }, { status: 400 })
    }

    const { data: batch, error: batchError } = await supabase
      .from('monthly_batches')
      .upsert(
        {
          carrier_id: carrierId,
          year_month: yearMonth,
          file_name: file.name,
          status: 'processing',
          total_rows: 0,
          uploaded_at: new Date().toISOString(),
          error_message: null,
        },
        { onConflict: 'carrier_id,year_month' }
      )
      .select('id')
      .single()

    if (batchError) throw batchError
    batchId = batch.id

    const { data: carrier, error: carrierError } = await supabase
      .from('carriers')
      .select('format_config')
      .eq('id', carrierId)
      .single()
    if (carrierError) throw carrierError

    // 재업로드 대비 기존 라인 삭제
    const { error: deleteError } = await supabase.from('invoice_lines').delete().eq('batch_id', batchId)
    if (deleteError) throw deleteError

    const buffer = Buffer.from(await file.arrayBuffer())
    const records = parseInvoiceBuffer(buffer, carrier.format_config)

    const [{ data: shippers, error: shipperError }, { data: itemPrices, error: itemPriceError }] = await Promise.all([
      supabase.from('shippers').select('id, name, alias, is_active, bundle_pattern'),
      supabase.from('shipper_item_prices').select('shipper_id, item_name, contract_price'),
    ])
    if (shipperError) throw shipperError
    if (itemPriceError) throw itemPriceError

    const shipperIndex = buildShipperIndex(shippers)
    const itemPriceIndex = buildItemPriceIndex(itemPrices)
    const bundlePatternIndex = buildBundlePatternIndex(shippers)

    const rows = records.map((r) => {
      const candidateName = getShipperNameCandidate({
        reservationType: r.reservation_type,
        senderName: r.sender_name,
        receiverName: r.receiver_name,
      })
      const shipperId = resolveShipperId(candidateName, shipperIndex)
      const appliedAmount = computeAppliedAmount({ shipperId, itemName: r.item_name, baseFee: r.base_fee }, itemPriceIndex)
      return {
        batch_id: batchId,
        no: r.no,
        pickup_date: r.pickup_date,
        pickup_branch: r.pickup_branch,
        tracking_no: r.tracking_no,
        sender_name: r.sender_name,
        sender_phone: r.sender_phone,
        sender_addr: r.sender_addr,
        receiver_name: r.receiver_name,
        receiver_phone: r.receiver_phone,
        receiver_addr: r.receiver_addr,
        item_name: r.item_name,
        qty: r.qty,
        reservation_type: r.reservation_type,
        freight_type: r.freight_type,
        base_fee: r.base_fee,
        other_fee: r.other_fee,
        total_fee: r.total_fee,
        shipper_id: shipperId,
        applied_amount: appliedAmount,
        // final_amount는 생성 컬럼이 아니라 일반 컬럼이라(전체 테이블 재작성 없이 공식을 바꾸려고
        // 전환함) 여기서 직접 계산해서 넣는다: 최종금액 = 적용금액(기타운임 제외) + 기타운임.
        final_amount: appliedAmount + Number(r.other_fee || 0),
        receiver_signee: r.receiver_signee,
        delivery_date: r.delivery_date,
        delivery_branch: r.delivery_branch,
        // 합포장(한 박스에 여러 품목을 묶어 보낸 건) 판별 방식은 화주사마다 다르다.
        is_bundled: isBundled(r.item_name, bundlePatternIndex.get(shipperId)),
      }
    })

    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE)
      const { error: insertError } = await supabase.from('invoice_lines').insert(chunk)
      if (insertError) throw insertError
    }

    await supabase
      .from('monthly_batches')
      .update({ status: 'done', total_rows: rows.length })
      .eq('id', batchId)

    await refreshBatchAggregates(supabase, batchId)

    return NextResponse.json({ batchId, totalRows: rows.length })
  } catch (error) {
    if (batchId) {
      await supabase
        .from('monthly_batches')
        .update({ status: 'error', error_message: String(error.message || error) })
        .eq('id', batchId)
      // 실패 직전에 기존 라인을 이미 지웠을 수 있으므로(재업로드 케이스), 캐시/합계를 현재 실제 라인
      // 상태(0건 또는 일부만 삽입된 상태)로 다시 맞춰준다. 안 그러면 대시보드에 실패 이전의 옛 합계가
      // 그대로 남아 이 배치가 정상인 것처럼 보인다.
      try {
        await refreshBatchAggregates(supabase, batchId)
      } catch {
        // 재집계 자체가 실패해도 원래 에러를 그대로 응답한다
      }
    }
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 })
  }
}
