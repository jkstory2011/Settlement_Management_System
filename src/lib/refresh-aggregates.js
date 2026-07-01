const CHUNK_SIZE = 20000

// monthly_batches.total_*, batch_shipper_summary 캐시를 처음부터 다시 계산한다.
// 업로드/재계산이 끝난 직후에만 호출한다 (조회 API에서는 절대 호출하지 않음 -- 캐시를 만드는 이유 자체가
// 페이지 조회 시 21만 건짜리 라이브 집계를 피하기 위함).
export async function refreshBatchAggregates(supabase, batchId) {
  const { error: resetError } = await supabase.rpc('reset_batch_aggregates', { p_batch_id: batchId })
  if (resetError) throw resetError

  let afterId = 0
  for (;;) {
    const { data, error } = await supabase.rpc('refresh_batch_aggregates_chunk', {
      p_batch_id: batchId,
      p_after_id: afterId,
      p_limit: CHUNK_SIZE,
    })
    if (error) throw error

    const row = data?.[0]
    if (!row || row.processed_count === 0) break
    afterId = row.last_id
    if (row.processed_count < CHUNK_SIZE) break
  }

  const { error: finalizeError } = await supabase.rpc('finalize_batch_aggregates', { p_batch_id: batchId })
  if (finalizeError) throw finalizeError
}
