import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { parseInvoiceBuffer } from '@/lib/xlsx-parse'
import {
  buildShipperIndex,
  buildTierIndex,
  resolveShipperId,
  computeAppliedAmount,
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

    const [{ data: shippers, error: shipperError }, { data: tiers, error: tierError }] = await Promise.all([
      supabase.from('shippers').select('id, name, alias, is_active'),
      supabase.from('shipper_rate_tiers').select('shipper_id, cj_base_fee, contract_price, effective_from'),
    ])
    if (shipperError) throw shipperError
    if (tierError) throw tierError

    const shipperIndex = buildShipperIndex(shippers)
    const tierIndex = buildTierIndex(tiers)

    const rows = records.map((r) => {
      const candidateName = getShipperNameCandidate({
        reservationType: r.reservation_type,
        senderName: r.sender_name,
        receiverName: r.receiver_name,
      })
      const shipperId = resolveShipperId(candidateName, shipperIndex)
      const appliedAmount = computeAppliedAmount(
        { shipperId, baseFee: r.base_fee, otherFee: r.other_fee, totalFee: r.total_fee, pickupDate: r.pickup_date },
        tierIndex
      )
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
        receiver_signee: r.receiver_signee,
        delivery_date: r.delivery_date,
        delivery_branch: r.delivery_branch,
        // 품목명에 '$'로 여러 품목이 이어져 있으면 합포장(한 박스에 여러 품목을 묶어 보낸 건)
        is_bundled: (r.item_name || '').includes('$'),
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
