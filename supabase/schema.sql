-- 화주사 월 정산서 자동화 - 1단계 스키마
-- Supabase SQL Editor에서 그대로 실행하세요.

create table if not exists carriers (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into carriers (name)
values ('CJ대한통운')
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
  ) stored
);

create index if not exists idx_invoice_lines_batch on invoice_lines(batch_id);
create index if not exists idx_invoice_lines_batch_shipper on invoice_lines(batch_id, shipper_id);
create index if not exists idx_invoice_lines_batch_tracking on invoice_lines(batch_id, tracking_no);
create index if not exists idx_invoice_lines_batch_candidate on invoice_lines(batch_id, shipper_name_candidate);
