-- 화주사 월 정산서 자동화 - 1단계 스키마
-- Supabase SQL Editor에서 그대로 실행하세요.

create table if not exists carriers (
  id bigint generated always as identity primary key,
  name text not null unique,
  -- { sheet_index, header_rows, columns: { invoice_lines 필드명 -> 원본 엑셀 컬럼 번호(0부터) } }
  -- columns가 비어있으면 아직 양식이 등록되지 않은 것으로 간주하고 업로드를 막는다.
  format_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into carriers (name, format_config)
values (
  'CJ대한통운',
  '{
    "sheet_index": 0,
    "header_rows": 2,
    "columns": {
      "no": 0, "pickup_date": 1, "pickup_branch": 2, "tracking_no": 3,
      "sender_name": 4, "sender_phone": 5, "sender_addr": 6,
      "receiver_name": 7, "receiver_phone": 8, "receiver_addr": 9,
      "item_name": 10, "qty": 11, "reservation_type": 12, "freight_type": 13,
      "base_fee": 14, "other_fee": 15, "total_fee": 16,
      "receiver_signee": 17, "delivery_date": 18, "delivery_branch": 19
    }
  }'::jsonb
)
on conflict (name) do nothing;

insert into carriers (name)
values ('한진택배'), ('롯데택배'), ('경동택배')
on conflict (name) do nothing;

create table if not exists shippers (
  id bigint generated always as identity primary key,
  name text not null unique,
  alias text[] not null default '{}',
  biz_no text,
  contact text,
  memo text,
  is_active boolean not null default true,
  -- 합포장(묶음배송) 판별용 정규식. 화주사마다 품목명에 표시하는 방식이 다름이 확인됨
  -- (예: 기본은 "$" 포함 여부, 비전스토리는 "품목명(수량) +" 패턴). null이면 기본값("\$") 사용.
  bundle_pattern text,
  created_at timestamptz not null default now()
);

-- 화주사와 실제 계약한 타입별(극소/소/중/대1/대2/이형/취급제한) 단가 참고표.
-- 원본 CJ 라인의 기본운임 금액과는 무관하다(같은 금액이 항상 같은 타입을 의미하지는 않음이 확인됨).
-- 자동 매칭에는 쓰이지 않고, 사용자가 원본 내역서를 보고 라인을 직접 수정할 때 참고하는 용도.
create table if not exists shipper_rate_tiers (
  id bigint generated always as identity primary key,
  shipper_id bigint not null references shippers(id) on delete cascade,
  cj_type text not null,
  contract_price numeric not null,
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  unique (shipper_id, cj_type, effective_from)
);

-- 화주사별 (품목명 -> 계약단가) 자동 매칭표. 화주사가 완성해둔 과거 정산 파일(원본 기본운임과
-- 직접 계산한 변경운임이 함께 있는 파일)에서 추출한다. 원본 CJ 기본운임은 같아도 품목명에 따라
-- 실제 계약단가가 달라짐이 확인됐고(예: 3HKOREA 기본운임 1,750원이 품목에 따라 1,950/2,500/4,600원
-- 등으로 다르게 적용됨), 반대로 (화주사, 품목명) 조합은 대부분(94~100%) 하나의 단가로 일관됨을
-- 검증했다. 처음 보는 품목명은 매칭되지 않고 원본 총운임(total_fee) 그대로 적용된다.
create table if not exists shipper_item_prices (
  id bigint generated always as identity primary key,
  shipper_id bigint not null references shippers(id) on delete cascade,
  item_name text not null,
  contract_price numeric not null,
  updated_at timestamptz not null default now(),
  unique (shipper_id, item_name)
);

create index if not exists idx_shipper_item_prices_shipper on shipper_item_prices(shipper_id);

create index if not exists idx_shipper_rate_tiers_shipper on shipper_rate_tiers(shipper_id);

create table if not exists monthly_batches (
  id bigint generated always as identity primary key,
  carrier_id bigint not null references carriers(id),
  year_month text not null, -- '2026-06'
  file_name text,
  uploaded_at timestamptz not null default now(),
  status text not null default 'processing' check (status in ('processing', 'done', 'error')),
  total_rows integer not null default 0,
  error_message text,
  -- 배치 전체 합계 캐시. 21만 건을 매 조회마다 라이브로 집계하면 몇 초씩 걸려서
  -- 업로드/재계산/수동수정 시점에만 갱신하고 조회는 이 컬럼을 읽기만 한다.
  total_original numeric not null default 0,
  total_applied numeric not null default 0,
  total_final numeric not null default 0,
  unique (carrier_id, year_month)
);

create table if not exists invoice_lines (
  id bigint generated always as identity primary key,
  batch_id bigint not null references monthly_batches(id) on delete cascade,
  no integer,
  pickup_date date,
  pickup_branch text,
  tracking_no text,
  sender_name text,
  sender_phone text,
  sender_addr text,
  receiver_name text,
  receiver_phone text,
  receiver_addr text,
  item_name text,
  qty integer,
  reservation_type text,
  freight_type text,
  base_fee numeric not null default 0,
  other_fee numeric not null default 0,
  total_fee numeric not null default 0,
  -- 화주사가 삭제되면 해당 운송장은 미등록 상태로 되돌아감
  shipper_id bigint references shippers(id) on delete set null,
  applied_amount numeric not null default 0,
  -- assign_shipper_to_candidate/match_return_candidates_to_general 등으로 화주사가 수동 확정된 건(예:
  -- 반품 품목명 매칭으로 예외 배정)에는 true. 재계산이 shipper_name_candidate 이름매칭으로 shipper_id를
  -- 덮어쓰지 않도록 막는 용도. 병합 해제(unassign_shipper_candidate) 시 반드시 false로 되돌려야 한다 --
  -- 안 그러면 그 라인은 이후 이름매칭 대상에서 영구히 제외된다.
  shipper_manual boolean not null default false,
  is_manual_edit boolean not null default false,
  manual_amount numeric,
  -- 적용금액(applied_amount)은 기타운임을 뺀 "보정된 기본운임"이므로, 최종금액은 항상
  -- 적용금액 + 기타운임이다(수동 수정된 경우도 manual_amount가 적용금액 자리를 대신할 뿐 동일 공식).
  final_amount numeric generated always as (coalesce(manual_amount, applied_amount) + other_fee) stored,
  receiver_signee text,
  delivery_date date,
  delivery_branch text,
  -- 예약구분에 따라 화주사가 되는 쪽이 다름: 일반은 송화인, 반품은 받는분이 화주사
  shipper_name_candidate text generated always as (
    case when reservation_type = '반품' then receiver_name else sender_name end
  ) stored,
  -- 품목명에 '$'로 여러 품목이 이어져 있으면 합포장(여러 품목을 한 박스에 묶어 보낸 건).
  -- generated column이 아니라 평범한 컬럼이다: 업로드 API가 매번 이 규칙으로 직접 계산해서 넣는다
  -- (기존 행은 backfill_is_bundled_chunk로 한 번 채웠음. functions.sql 참고).
  is_bundled boolean not null default false
);

create index if not exists idx_invoice_lines_batch on invoice_lines(batch_id);
create index if not exists idx_invoice_lines_batch_shipper on invoice_lines(batch_id, shipper_id);
create index if not exists idx_invoice_lines_batch_tracking on invoice_lines(batch_id, tracking_no);
create index if not exists idx_invoice_lines_batch_candidate on invoice_lines(batch_id, shipper_name_candidate);
-- 목록 조회가 batch_id로 필터 후 no로 정렬하는데, 이 인덱스가 없으면 21만 건을 매번 통째로 정렬해야 해서 느려짐
create index if not exists idx_invoice_lines_batch_no on invoice_lines(batch_id, no);
-- 합포장은 전체 대비 극소수라 이 인덱스로 필터링하면 라이브 집계도 빠름
create index if not exists idx_invoice_lines_batch_bundled on invoice_lines(batch_id, is_bundled);
-- 일반/반품 필터 + 정렬을 위한 인덱스 (화주사 필터와 조합될 때도 정렬 성능 확보)
create index if not exists idx_invoice_lines_batch_shipper_no on invoice_lines(batch_id, shipper_id, no);
create index if not exists idx_invoice_lines_batch_type_no on invoice_lines(batch_id, reservation_type, no);

-- 화주사별/미등록 그룹별 건수·합계 캐시 (월 택배비 수정 화면 사이드바 + 필터별 요약이 여기서 읽음)
create table if not exists batch_shipper_summary (
  batch_id bigint not null references monthly_batches(id) on delete cascade,
  group_key text not null, -- 'shipper:<id>' | 'unregistered' | 'sender:<name>'
  shipper_id bigint references shippers(id) on delete set null,
  shipper_name text not null,
  sender_name text, -- 반복 발송된 미등록 화주사 후보 그룹에서만 값이 채워짐
  line_count bigint not null default 0,
  total_original numeric not null default 0,
  total_applied numeric not null default 0,
  total_final numeric not null default 0,
  primary key (batch_id, group_key)
);

-- batch_shipper_summary와 동일한 그룹을 예약구분(일반/반품)별로 한 번 더 쪼갠 캐시.
-- 일반/반품 필터, 화주사별 일반/반품 세부 건수 표시에 사용.
create table if not exists batch_shipper_type_summary (
  batch_id bigint not null references monthly_batches(id) on delete cascade,
  group_key text not null,
  reservation_type text not null, -- '일반' | '반품'
  line_count bigint not null default 0,
  total_original numeric not null default 0,
  total_applied numeric not null default 0,
  total_final numeric not null default 0,
  primary key (batch_id, group_key, reservation_type)
);

-- 화주사 정산서 발행 이력. 발행 시점 데이터를 snapshot(jsonb)에 통째로 얼려서 저장한다.
-- 이후 invoice_lines/shippers가 바뀌어도 이미 발행된 정산서는 그대로 유지되고,
-- 재발행하면 새 version이 추가된다 (기존 버전은 삭제하지 않음).
create table if not exists shipper_statements (
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

create index if not exists idx_shipper_statements_batch_shipper
  on shipper_statements(batch_id, shipper_id, version desc);
