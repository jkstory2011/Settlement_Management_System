import * as XLSX from 'xlsx'

// invoice_lines에 저장되는 필드 목록. 택배사별 format_config.columns가 이 이름들을 열 번호에 매핑한다.
export const INVOICE_FIELDS = [
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

const DATE_FIELDS = new Set(['pickup_date', 'delivery_date'])

/**
 * 택배사별 format_config(header_rows, sheet_index, columns)를 기준으로 내역서 버퍼를 파싱한다.
 * @param {Buffer} buffer
 * @param {{ sheet_index?: number, header_rows: number, columns: Record<string, number> }} formatConfig
 * @returns {object[]}
 */
export function parseInvoiceBuffer(buffer, formatConfig) {
  if (!formatConfig || !formatConfig.columns || Object.keys(formatConfig.columns).length === 0) {
    throw new Error('이 택배사의 양식(컬럼 매핑)이 아직 등록되지 않았습니다. 택배사 양식 관리에서 먼저 설정하세요.')
  }

  const headerRows = formatConfig.header_rows ?? 2
  const sheetIndex = formatConfig.sheet_index ?? 0
  const columns = formatConfig.columns

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheetName = workbook.SheetNames[sheetIndex]
  if (!sheetName) throw new Error(`시트 ${sheetIndex}번을 찾을 수 없습니다.`)
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

  const dataRows = rows.slice(headerRows)
  const result = []

  for (const row of dataRows) {
    if (!row || row.every((v) => v === null || v === '')) continue

    const record = {}
    for (const field of INVOICE_FIELDS) {
      const colIdx = columns[field]
      record[field] = colIdx == null ? null : (row[colIdx] ?? null)
    }

    record.no = record.no != null ? Number(record.no) : null
    record.qty = record.qty != null ? Number(record.qty) : null
    record.base_fee = Number(record.base_fee) || 0
    record.other_fee = Number(record.other_fee) || 0
    record.total_fee = Number(record.total_fee) || 0
    for (const field of DATE_FIELDS) {
      record[field] = normalizeDate(record[field])
    }

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
