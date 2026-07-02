# 화주사 정산서 발행 기능 설계

## 배경

현재 앱은 택배사 월별 원본 내역서를 업로드하고(`monthly_batches` + `invoice_lines`), 화주사별 계약 단가를 적용해 라인 단위로 정산 금액을 확정/수정하는 기능까지 구현되어 있다(`/monthly-fees/[batchId]`). 하지만 이 결과를 화주사에게 실제로 전달할 "정산서" 형태로 산출하는 기능은 아직 없다. 이 문서는 그 기능의 설계를 다룬다.

## 요구사항 요약

- 정산서는 화면 조회와 파일 다운로드(Excel, PDF) 모두 지원한다.
- 내용은 월 합계 요약 + 개별 운송장 명세를 모두 포함한다.
- 집계 단위는 배치(택배사+월) 단위. 한 화주사가 같은 달 여러 택배사를 이용했다면 택배사별로 별도 정산서가 나온다.
- 발행은 스냅샷 방식이다: 발행 시점 데이터를 고정 저장하고, 이후 라인이 수정돼도 이미 발행된 정산서는 그대로 유지한다. 재발행하면 새 버전이 생기고 기존 발행 이력은 남는다.
- 발행 화면은 `/monthly-fees/[batchId]` 배치 상세 화면에 새 탭으로 추가한다.
- 화주사별 개별 발행과 배치 전체 화주사 일괄 발행을 모두 지원한다.

## 데이터 모델

새 테이블 `shipper_statements`를 추가한다. 매 조회마다 살아있는 `invoice_lines`를 다시 계산하지 않고, 발행 시점에 필요한 모든 데이터를 `snapshot jsonb` 컬럼에 통째로 얼려서 저장한다. 화주사 마스터 정보(상호/사업자번호/연락처)나 라인 데이터가 나중에 바뀌어도 이미 발행된 정산서는 완전히 독립적으로 남는다.

```sql
create table shipper_statements (
  id bigint generated always as identity primary key,
  batch_id bigint not null references monthly_batches(id) on delete cascade,
  shipper_id bigint not null references shippers(id),
  version integer not null default 1,
  issued_at timestamptz not null default now(),
  line_count integer not null,
  total_final numeric not null,
  snapshot jsonb not null,
  unique (batch_id, shipper_id, version)
);

create index idx_shipper_statements_batch_shipper on shipper_statements(batch_id, shipper_id, version desc);
```

`snapshot` 구조:

```jsonc
{
  "shipper": { "id": 1, "name": "...", "biz_no": "...", "contact": "..." },
  "carrier": { "id": 1, "name": "CJ대한통운" },
  "batch": { "id": 1, "year_month": "2026-06" },
  "summary": {
    "일반": { "line_count": 0, "total_original": 0, "total_applied": 0, "total_final": 0 },
    "반품": { "line_count": 0, "total_original": 0, "total_applied": 0, "total_final": 0 },
    "합계": { "line_count": 0, "total_original": 0, "total_applied": 0, "total_final": 0 }
  },
  "lines": [
    {
      "tracking_no": "...", "pickup_date": "2026-06-01", "reservation_type": "일반",
      "sender_name": "...", "receiver_name": "...", "item_name": "...", "qty": 1,
      "is_bundled": false, "base_fee": 0, "other_fee": 0, "total_fee": 0,
      "applied_amount": 0, "final_amount": 0
    }
  ]
}
```

발행(생성) 시점에 `batch_shipper_summary`/`batch_shipper_type_summary` 캐시 값과 신규 집계한 합계가 일치하는지 검증한 뒤 저장한다(불일치 시 발행을 막고 "배치 재계산 후 다시 시도" 오류를 반환 — 캐시 드리프트를 발행 문서에 반영하지 않기 위함).

## API

- `POST /api/batches/[id]/statements` — body `{ shipperId }`. 해당 화주사의 현재 라인 데이터로 스냅샷을 만들어 새 버전(`version = 기존 최대값 + 1`)으로 저장.
- `POST /api/batches/[id]/statements/bulk` — 배치 내 라인이 1건 이상 있는 등록 화주사 전원에 대해 위 로직을 반복.
- `GET /api/batches/[id]/statements` — 배치 내 등록 화주사별 최신 발행 현황(최근 버전/발행일시/금액/미발행 여부) 목록. 화면 탭의 메인 목록에 사용.
- `GET /api/statements/[id]` — 특정 정산서 스냅샷 상세 조회(화면 표시용).
- `GET /api/statements/[id]/history` — 같은 `(batch_id, shipper_id)`의 전체 버전 이력.
- `GET /api/statements/[id]/export?format=xlsx|pdf` — 저장된 스냅샷으로부터 즉석에서 파일 생성 후 반환(파일 자체를 스토리지에 저장하지 않음).

## UI

`src/app/monthly-fees/[batchId]/page.js`의 `activeTab` 상태에 `'statements'`를 추가한다.

**정산서 탭 (목록):**
- 상단에 "전체 일괄 발행" 버튼.
- 화주사별 표: 화주사명 | 최근 버전 | 최근 발행일시 | 발행 금액 | 상태(미발행/발행됨) | [보기] [발행/재발행] [이력]
- 라인이 없는(0건) 화주사, 미등록 그룹은 목록에서 제외.

**정산서 상세 (보기):**
- 요약 카드: 일반/반품/합계 건수·금액 (기존 `KpiCard` 컴포넌트 재사용).
- 명세 테이블: 송장번호/집화일/송화인·수화인/품목/수량/원본운임/최종금액.
- "Excel 다운로드" / "PDF 다운로드" 버튼.

**이력:**
- 같은 화주사의 과거 발행 버전 목록(버전/발행일시/금액), 각 항목에서 과거 버전도 조회/다운로드 가능.

## 파일 생성

- **Excel**: 기존 의존성 `xlsx`(SheetJS)로 생성. 시트 2개 — "요약", "명세".
- **PDF**: 신규 의존성으로 `@react-pdf/renderer`를 추가한다. Next.js API route(서버리스 환경)에서 헤드리스 브라우저(puppeteer) 없이 순수 JS로 PDF를 렌더링할 수 있어 배포 복잡도가 낮다.
- 두 형식 모두 저장된 `snapshot` jsonb를 유일한 입력으로 사용하며, 요청마다 즉석 생성한다(파일을 별도 스토리지에 보관하지 않음).

## 검증 방식

이 프로젝트에는 자동화 테스트가 구성되어 있지 않다. 구현 후 다음을 개발 서버에서 수동으로 확인한다:
- 화주사 1건 발행 → 화면 요약 숫자가 해당 화주사의 배치 상세 화면(`lines` 탭) 필터 결과와 일치하는지.
- 발행 후 라인 금액을 수정 → 기존 발행 정산서는 그대로, 재발행 시에만 새 금액 반영되는지.
- 전체 일괄 발행 → 등록 화주사 수만큼 정산서 생성되는지, 미등록/0건 화주사는 제외되는지.
- Excel/PDF 다운로드 파일을 열어 요약·명세 숫자가 화면과 일치하는지.

## 범위 밖

- 정산서 이메일 발송/전달 자동화.
- 정산서 승인/전자서명 워크플로.
- 여러 배치(택배사)를 하나로 합친 통합 정산서.
