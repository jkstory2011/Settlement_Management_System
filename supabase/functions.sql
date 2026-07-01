-- 월 택배비 수정 화면에서 쓰는 집계 함수
-- schema.sql 실행 후 Supabase SQL Editor에서 추가로 실행하세요.

create or replace function batch_line_summary(
  p_batch_id bigint,
  p_shipper_id bigint default null,
  p_unregistered boolean default false,
  p_sender_name text default null
)
returns table (
  line_count bigint,
  total_original numeric,
  total_applied numeric,
  total_final numeric
)
language sql
stable
as $$
  select
    count(*),
    coalesce(sum(total_fee), 0),
    coalesce(sum(applied_amount), 0),
    coalesce(sum(final_amount), 0)
  from invoice_lines
  where batch_id = p_batch_id
    and (
      (p_sender_name is not null and shipper_id is null and shipper_name_candidate = p_sender_name)
      or (
        p_sender_name is null and (
          (p_unregistered and shipper_id is null)
          or (not p_unregistered and (p_shipper_id is null or shipper_id = p_shipper_id))
        )
      )
    )
$$;

-- shipper_id: 등록된 화주사 그룹은 그 id, 미등록 전체 묶음은 null, 반복 발송된 미등록 송화인 그룹도 null
-- sender_name: 반복 발송된 미등록 송화인 그룹에서만 값이 채워짐 (해당 이름으로 추가 필터링할 때 사용)
create or replace function batch_shipper_breakdown(p_batch_id bigint)
returns table (
  shipper_id bigint,
  shipper_name text,
  line_count bigint,
  total_final numeric,
  sender_name text
)
language sql
stable
as $$
  select
    il.shipper_id,
    coalesce(s.name, '미등록(전체)'),
    count(*),
    coalesce(sum(il.final_amount), 0),
    null::text
  from invoice_lines il
  left join shippers s on s.id = il.shipper_id
  where il.batch_id = p_batch_id
  group by il.shipper_id, s.name

  union all

  select null::bigint, r.shipper_name_candidate, r.line_count, r.total_final, r.shipper_name_candidate
  from (
    select
      il.shipper_name_candidate,
      count(*) as line_count,
      coalesce(sum(il.final_amount), 0) as total_final
    from invoice_lines il
    where il.batch_id = p_batch_id
      and il.shipper_id is null
    group by il.shipper_name_candidate
    having count(*) > 1
    order by count(*) desc
    limit 200
  ) r

  order by 3 desc
$$;

-- 업로드 이후 화주사 마스터/구간표가 바뀐 경우, 해당 배치의 shipper_id/applied_amount를 서버에서 일괄 재계산
-- (수동 수정된 manual_amount는 건드리지 않음)
-- 21만 건을 한 statement로 처리하면 statement_timeout(약 8초)에 걸리므로 청크 단위로 처리한다.
-- p_after_id 이후 id 기준으로 p_limit개만 처리하고, 다음 호출에 쓸 last_id와 처리 건수를 반환한다.
create or replace function recompute_batch_applied_amounts_chunk(p_batch_id bigint, p_after_id bigint, p_limit integer default 20000)
returns table (last_id bigint, updated_count integer)
language plpgsql
as $$
begin
  create temporary table if not exists tmp_shipper_names (
    shipper_id bigint,
    norm_name text
  ) on commit drop;

  if not exists (select 1 from tmp_shipper_names limit 1) then
    insert into tmp_shipper_names
    select s.id, lower(trim(s.name))
    from shippers s
    where s.is_active
    union
    select s.id, lower(trim(a))
    from shippers s, unnest(s.alias) a
    where s.is_active;
  end if;

  return query
  with chunk as (
    select il.id, il.base_fee, il.other_fee, il.total_fee, il.shipper_name_candidate
    from invoice_lines il
    where il.batch_id = p_batch_id
      and il.id > p_after_id
    order by il.id
    limit p_limit
  ),
  computed as (
    select
      c.id as line_id,
      sn.shipper_id,
      coalesce(t.contract_price + c.other_fee, c.total_fee) as new_applied_amount
    from chunk c
    left join tmp_shipper_names sn on sn.norm_name = lower(trim(c.shipper_name_candidate))
    left join lateral (
      select srt.contract_price
      from shipper_rate_tiers srt
      where srt.shipper_id = sn.shipper_id
        and srt.cj_base_fee = c.base_fee
      order by srt.effective_from desc
      limit 1
    ) t on sn.shipper_id is not null
  ),
  upd as (
    update invoice_lines il
    set shipper_id = comp.shipper_id,
        applied_amount = comp.new_applied_amount
    from computed comp
    where il.id = comp.line_id
    returning il.id
  )
  select max(upd.id), count(*)::integer from upd;
end;
$$;
