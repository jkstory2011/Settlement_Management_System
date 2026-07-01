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
  // shipperId:cjBaseFee -> 가장 최근(effective_from desc) contract_price
  const index = new Map()
  for (const tier of tiers) {
    const key = `${tier.shipper_id}:${Number(tier.cj_base_fee)}`
    const existing = index.get(key)
    if (!existing || tier.effective_from > existing.effective_from) {
      index.set(key, tier)
    }
  }
  return index
}

export function resolveShipperId(senderName, shipperIndex) {
  if (!senderName) return null
  return shipperIndex.get(normalizeName(senderName)) ?? null
}

export function computeAppliedAmount({ shipperId, baseFee, otherFee, totalFee }, tierIndex) {
  if (shipperId != null) {
    const tier = tierIndex.get(`${shipperId}:${Number(baseFee)}`)
    if (tier) return Number(tier.contract_price) + Number(otherFee || 0)
  }
  return Number(totalFee || 0)
}

function normalizeName(name) {
  return String(name).trim().toLowerCase()
}
