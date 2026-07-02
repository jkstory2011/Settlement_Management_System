// 송화인/받는분 이름 -> 화주사, (화주사, 기본운임구간) -> 계약단가 매칭 유틸

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

export function buildTierIndex(tiers) {
  // shipperId:cjBaseFee -> [effective_from 오름차순으로 정렬된 tier들]
  // (라인마다 픽업일이 다르므로 "가장 최근 단가" 하나로는 못 고르고, 매칭 시점에 픽업일 기준으로 골라야 함)
  const index = new Map()
  for (const tier of tiers) {
    const key = `${tier.shipper_id}:${Number(tier.cj_base_fee)}`
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(tier)
  }
  for (const list of index.values()) {
    list.sort((a, b) => toTime(a.effective_from) - toTime(b.effective_from))
  }
  return index
}

export function resolveShipperId(senderName, shipperIndex) {
  if (!senderName) return null
  return shipperIndex.get(normalizeName(senderName)) ?? null
}

export function computeAppliedAmount({ shipperId, baseFee, otherFee, totalFee, pickupDate }, tierIndex) {
  if (shipperId != null) {
    const tiers = tierIndex.get(`${shipperId}:${Number(baseFee)}`)
    const tier = pickEffectiveTier(tiers, pickupDate)
    if (tier) return Number(tier.contract_price) + Number(otherFee || 0)
  }
  return Number(totalFee || 0)
}

// pickupDate 이전(또는 당일)에 등록된 단가 중 가장 최근 것을 고른다.
// pickupDate가 없으면(픽업일 누락) 과거 동작대로 가장 최근 단가로 폴백한다.
function pickEffectiveTier(tiers, pickupDate) {
  if (!tiers || tiers.length === 0) return null
  if (!pickupDate) return tiers[tiers.length - 1]
  const pickupTime = toTime(pickupDate)
  let picked = null
  for (const tier of tiers) {
    if (toTime(tier.effective_from) <= pickupTime) picked = tier
    else break
  }
  return picked
}

// 원본 날짜값이 항상 'YYYY-MM-DD' 형식이라는 보장이 없어(원본 엑셀 문자열을 그대로 쓰는 경로가 있음)
// 문자열 비교 대신 실제 시각으로 변환해서 비교한다.
function toTime(dateValue) {
  const t = new Date(dateValue).getTime()
  return Number.isNaN(t) ? 0 : t
}

function normalizeName(name) {
  return String(name).trim().toLowerCase()
}
