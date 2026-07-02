// src/lib/statement-snapshot.js
// 화주사 정산서 스냅샷 생성 + 발행(버전 저장). API 라우트에서만 호출한다.

export async function buildStatementSnapshot(supabase, { batchId, shipperId }) {
  const [{ data: shipper, error: shipperError }, { data: batch, error: batchError }] = await Promise.all([
    supabase.from('shippers').select('id, name, biz_no, contact').eq('id', shipperId).single(),
    supabase.from('monthly_batches').select('id, year_month, carrier_id, carriers(name)').eq('id', batchId).single(),
  ])
  if (shipperError) throw new Error(shipperError.message)
  if (batchError) throw new Error(batchError.message)

  const PAGE_SIZE = 1000
  const lines = []
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data: pageLines, error: linesError } = await supabase
      .from('invoice_lines')
      .select(
        'tracking_no, pickup_date, reservation_type, sender_name, receiver_name, item_name, qty, is_bundled, base_fee, other_fee, total_fee, applied_amount, final_amount'
      )
      .eq('batch_id', batchId)
      .eq('shipper_id', shipperId)
      .order('no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (linesError) throw new Error(linesError.message)
    lines.push(...pageLines)
    if (pageLines.length < PAGE_SIZE) break
  }

  const summary = buildSummary(lines)

  const { data: cached, error: cacheError } = await supabase
    .from('batch_shipper_summary')
    .select('line_count, total_final')
    .eq('batch_id', batchId)
    .eq('group_key', `shipper:${shipperId}`)
    .maybeSingle()
  if (cacheError) throw new Error(cacheError.message)

  assertMatchesCache(summary.합계, cached)

  return {
    shipper: { id: shipper.id, name: shipper.name, biz_no: shipper.biz_no, contact: shipper.contact },
    carrier: { id: batch.carrier_id, name: batch.carriers?.name || null },
    batch: { id: batch.id, year_month: batch.year_month },
    summary,
    lines: lines.map((l) => ({
      tracking_no: l.tracking_no,
      pickup_date: l.pickup_date,
      reservation_type: l.reservation_type,
      sender_name: l.sender_name,
      receiver_name: l.receiver_name,
      item_name: l.item_name,
      qty: l.qty,
      is_bundled: l.is_bundled,
      base_fee: Number(l.base_fee),
      other_fee: Number(l.other_fee),
      total_fee: Number(l.total_fee),
      applied_amount: Number(l.applied_amount),
      final_amount: Number(l.final_amount),
    })),
  }
}

export async function issueStatement(supabase, batchId, shipperId) {
  const snapshot = await buildStatementSnapshot(supabase, { batchId, shipperId })

  const { data: maxRow, error: maxError } = await supabase
    .from('shipper_statements')
    .select('version')
    .eq('batch_id', batchId)
    .eq('shipper_id', shipperId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxError) throw new Error(maxError.message)
  const version = (maxRow?.version || 0) + 1

  const { data: inserted, error: insertError } = await supabase
    .from('shipper_statements')
    .insert({
      batch_id: batchId,
      shipper_id: shipperId,
      version,
      line_count: snapshot.summary.합계.line_count,
      total_final: snapshot.summary.합계.total_final,
      snapshot,
    })
    .select('id, version, issued_at, line_count, total_final')
    .single()
  if (insertError) throw new Error(insertError.message)

  return inserted
}

function buildSummary(lines) {
  const empty = () => ({ line_count: 0, total_original: 0, total_applied: 0, total_final: 0 })
  const acc = { 일반: empty(), 반품: empty(), 합계: empty() }
  for (const l of lines) {
    const bucket = l.reservation_type === '반품' ? '반품' : '일반'
    for (const key of [bucket, '합계']) {
      acc[key].line_count += 1
      acc[key].total_original += Number(l.total_fee)
      acc[key].total_applied += Number(l.applied_amount)
      acc[key].total_final += Number(l.final_amount)
    }
  }
  return acc
}

function assertMatchesCache(liveTotal, cached) {
  if (!cached) {
    if (liveTotal.line_count === 0) return
    throw new Error('배치 캐시가 없습니다. "화주사/단가 재계산"을 실행한 뒤 다시 시도하세요.')
  }
  const mismatch =
    Number(cached.line_count) !== liveTotal.line_count || Number(cached.total_final) !== liveTotal.total_final
  if (mismatch) {
    throw new Error('배치 캐시와 실제 라인 합계가 일치하지 않습니다. "화주사/단가 재계산"을 실행한 뒤 다시 시도하세요.')
  }
}
