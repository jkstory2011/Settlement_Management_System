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
  created_at timestamptz not null default now()
);

create table if not exists shipper_rate_tiers (
  id bigint generated always as identity primary key,
  shipper_id bigint not null references shippers(id) on delete cascade,
  cj_base_fee numeric not null,
  contract_price numeric not null,
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  unique (shipper_id, cj_base_fee, effective_from)
);

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
  shipper_id bigint references shippers(id),
  applied_amount numeric not null default 0,
  is_manual_edit boolean not null default false,
  manual_amount numeric,
  final_amount numeric generated always as (coalesce(manual_amount, applied_amount)) stored,
  receiver_signee text,
  delivery_date date,
  delivery_branch text,
  -- 예약구분에 따라 화주사가 되는 쪽이 다름: 일반은 송화인, 반품은 받는분이 화주사
  shipper_name_candidate text generated always as (
    case when reservation_type = '반품' then receiver_name else sender_name end
  ) stored,
  -- 품목명에 '$'로 여러 품목이 이어져 있으면 합포장(여러 품목을 한 박스에 묶어 보낸 건)
  is_bundled boolean generated always as (item_name like '%$%') stored
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
  shipper_id bigint references shippers(id),
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
