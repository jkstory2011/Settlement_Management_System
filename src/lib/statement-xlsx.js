import * as XLSX from 'xlsx'

export function buildStatementXlsxBuffer(snapshot) {
  const wb = XLSX.utils.book_new()

  const s = snapshot.summary
  const summaryRows = [
    ['화주사', snapshot.shipper.name],
    ['사업자번호', snapshot.shipper.biz_no || ''],
    ['연락처', snapshot.shipper.contact || ''],
    ['택배사', snapshot.carrier.name || ''],
    ['대상월', snapshot.batch.year_month],
    [],
    ['구분', '건수', '원본운임', '적용운임', '최종금액'],
    ['일반', s.일반.line_count, s.일반.total_original, s.일반.total_applied, s.일반.total_final],
    ['반품', s.반품.line_count, s.반품.total_original, s.반품.total_applied, s.반품.total_final],
    ['합계', s.합계.line_count, s.합계.total_original, s.합계.total_applied, s.합계.total_final],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), '요약')

  const detailHeader = ['송장번호', '집화일', '구분', '송화인', '수화인', '품목', '수량', '원본운임', '최종금액']
  const detailRows = snapshot.lines.map((l) => [
    l.tracking_no,
    l.pickup_date,
    l.reservation_type,
    l.sender_name,
    l.receiver_name,
    l.item_name,
    l.qty,
    l.total_fee,
    l.final_amount,
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]), '명세')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
