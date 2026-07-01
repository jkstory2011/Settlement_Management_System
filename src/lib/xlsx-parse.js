import * as XLSX from 'xlsx'

// CJ대한통운 월별 내역서 포맷
// 1~2행: 2단 헤더, 3행부터 데이터
// No, 집화일자, 집화점소, 운송장번호, 송화인(고객명/전화번호/주소), 받는분(고객명/전화번호/주소),
// 품목명, 수량, 예약구분, 운임구분, 기본운임, 기타운임, 총운임, 인수자, 배송일자, 배송점소
const COLUMNS = [
  'no',
  'pickup_date',
  'pickup_branch',
  'tracking_no',
  'sender_name',
  'sender_phone',
  'sender_addr',
  'receiver_name',
  'receiver_phone',
  'receiver_addr',
  'item_name',
  'qty',
  'reservation_type',
  'freight_type',
  'base_fee',
  'other_fee',
  'total_fee',
  'receiver_signee',
  'delivery_date',
  'delivery_branch',
]

/**
 * CJ대한통운 내역서 버퍼를 파싱해 행 객체 배열로 반환한다.
 * @param {Buffer} buffer
 * @returns {object[]}
 */
export function parseCjInvoiceBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

  const dataRows = rows.slice(2) // 1~2행(헤더) 제외
  const result = []

  for (const row of dataRows) {
    if (!row || row.every((v) => v === null || v === '')) continue

    const record = {}
    COLUMNS.forEach((key, idx) => {
      record[key] = row[idx] ?? null
    })

    record.no = record.no != null ? Number(record.no) : null
    record.qty = record.qty != null ? Number(record.qty) : null
    record.base_fee = Number(record.base_fee) || 0
    record.other_fee = Number(record.other_fee) || 0
    record.total_fee = Number(record.total_fee) || 0
    record.pickup_date = normalizeDate(record.pickup_date)
    record.delivery_date = normalizeDate(record.delivery_date)

    result.push(record)
  }

  return result
}

function normalizeDate(value) {
  if (!value) return null
  if (typeof value === 'string') return value.trim() || null
  // 드물게 엑셀 시리얼 날짜로 들어오는 경우 보정
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    const mm = String(parsed.m).padStart(2, '0')
    const dd = String(parsed.d).padStart(2, '0')
    return `${parsed.y}-${mm}-${dd}`
  }
  return null
}
