// 송화인/받는분 이름 -> 화주사 매칭 유틸.
//
// shipper_rate_tiers(화주사별 타입/계약단가 참고표)는 라인 단위로 타입(극소/소/중 등)을 판별할 방법이
// 아직 없어(원본에 타입 정보 없음, 같은 기본운임 금액이 항상 같은 타입을 의미하지도 않음) 자동 매칭에는
// 쓰지 않는다. computeAppliedAmount는 그래서 항상 원본 총운임(totalFee)을 그대로 적용한다.
// 품목명 기반 자동 매칭(별도 설계 예정)이 만들어지면 이 자리를 대체한다.

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

export function resolveShipperId(senderName, shipperIndex) {
  if (!senderName) return null
  return shipperIndex.get(normalizeName(senderName)) ?? null
}

export function computeAppliedAmount({ totalFee }) {
  return Number(totalFee || 0)
}

function normalizeName(name) {
  return String(name).trim().toLowerCase()
}
