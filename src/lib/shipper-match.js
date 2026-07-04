// 송화인/받는분 이름 -> 화주사, (화주사, 품목명) -> 계약단가 매칭 유틸.
//
// shipper_rate_tiers(화주사별 타입 참고표)는 라인 단위로 타입(극소/소/중 등)을 판별할 방법이 없어
// (원본에 타입 정보 없음, 같은 기본운임 금액이 항상 같은 타입을 의미하지도 않음) 자동 매칭에 쓰지 않는다.
// 대신 shipper_item_prices((화주사, 품목명) -> 계약단가, 화주사가 완성해둔 과거 정산 파일에서 추출)로
// 매칭한다. 못 찾는 품목(신상품 등)은 원본 기본운임(baseFee) 그대로 적용된다.
//
// 금액 계산 공식: 적용금액(applied_amount)은 기타운임을 제외한 "보정된 기본운임"이고,
// 최종금액(final_amount, DB 생성 컬럼)은 항상 적용금액 + 기타운임이다. applied_amount에
// 기타운임을 섞어 넣지 않는다(final_amount 계산식과 이중으로 더해지는 걸 방지).

// 예약구분에 따라 화주사가 되는 쪽이 다름: 일반은 송화인, 반품은 받는분이 화주사
export function getShipperNameCandidate({ reservationType, senderName, receiverName }) {
  return reservationType === '반품' ? receiverName : senderName
}

export function buildShipperIndex(shippers) {
  const index = new Map()
  for (const shipper of shippers) {
    if (!shipper.is_active) continue
    index.set(normalizeName(shipper.name), shipper.id)
    for (const alias of shipper.alias || []) {
      index.set(normalizeName(alias), shipper.id)
    }
  }
  return index
}

export function buildItemPriceIndex(itemPrices) {
  const index = new Map()
  for (const row of itemPrices) {
    index.set(`${row.shipper_id}:${normalizeItemName(row.item_name)}`, Number(row.contract_price))
  }
  return index
}

export function resolveShipperId(senderName, shipperIndex) {
  if (!senderName) return null
  return shipperIndex.get(normalizeName(senderName)) ?? null
}

export function buildBundlePatternIndex(shippers) {
  const index = new Map()
  for (const shipper of shippers) {
    if (shipper.bundle_pattern) index.set(shipper.id, shipper.bundle_pattern)
  }
  return index
}

// 합포장(묶음배송) 표시 방식은 화주사마다 다르다(기본은 품목명에 '$' 포함, 비전스토리는
// "품목명(수량) +" 패턴 등). 화주사별 bundle_pattern이 있으면 그걸로, 없으면 기본값('$')으로 판별한다.
const DEFAULT_BUNDLE_REGEX = /\$/

export function isBundled(itemName, bundlePattern) {
  const name = itemName || ''
  if (bundlePattern) {
    try {
      return new RegExp(bundlePattern).test(name)
    } catch {
      // 잘못된 정규식이 저장돼 있으면 기본 규칙으로 폴백
    }
  }
  return DEFAULT_BUNDLE_REGEX.test(name)
}

export function computeAppliedAmount({ shipperId, itemName, baseFee }, itemPriceIndex) {
  if (shipperId != null && itemName) {
    const contractPrice = itemPriceIndex.get(`${shipperId}:${normalizeItemName(itemName)}`)
    if (contractPrice != null) return contractPrice
  }
  return Number(baseFee || 0)
}

function normalizeName(name) {
  return String(name).trim().toLowerCase()
}

function normalizeItemName(name) {
  return String(name).trim()
}
