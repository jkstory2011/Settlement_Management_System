-- 월 택배운임 수정 화면에서 쓰는 집계 함수
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

-- monthly_batches.total_*, batch_shipper_summary 캐시를 처음부터 다시 계산한다.
-- 업로드/재계산 완료 직후에만 호출한다 (페이지 조회 시에는 절대 호출하지 않음 -- 이게 이 함수가 존재하는 이유).
-- 21만 건을 한 statement로 집계하면 8초 넘게 걸려 timeout에 걸리므로(SET LOCAL statement_timeout으로도
-- 우회 불가함을 확인함) recompute와 동일하게 청크 단위 누적 방식으로 처리한다.
-- 사용 순서: reset_batch_aggregates -> refresh_batch_aggregates_chunk 반복 -> finalize_batch_aggregates
create or replace function reset_batch_aggregates(p_batch_id bigint)
returns void
language sql
as $$
  update monthly_batches set total_original = 0, total_applied = 0, total_final = 0 where id = p_batch_id;
  delete from batch_shipper_summary where batch_id = p_batch_id;
$$;

create or replace function refresh_batch_aggregates_chunk(p_batch_id bigint, p_after_id bigint, p_limit integer default 20000)
returns table (last_id bigint, processed_count integer)
language plpgsql
as $$
begin
  create temporary table if not exists tmp_agg_chunk (
    id bigint,
    shipper_id bigint,
    shipper_name_candidate text,
    total_fee numeric,
    applied_amount numeric,
    final_amount numeric
  ) on commit drop;

  truncate tmp_agg_chunk;

  insert into tmp_agg_chunk
  select il.id, il.shipper_id, il.shipper_name_candidate, il.total_fee, il.applied_amount, il.final_amount
  from invoice_lines il
  where il.batch_id = p_batch_id
    and il.id > p_after_id
  order by il.id
  limit p_limit;

  insert into batch_shipper_summary
    (batch_id, group_key, shipper_id, shipper_name, sender_name, line_count, total_original, total_applied, total_final)
  select
    p_batch_id,
    case when c.shipper_id is null then 'unregistered' else 'shipper:' || c.shipper_id::text end,
    c.shipper_id,
    coalesce(s.name, '미등록(전체)'),
    null,
    count(*),
    coalesce(sum(c.total_fee), 0),
    coalesce(sum(c.applied_amount), 0),
    coalesce(sum(c.final_amount), 0)
  from tmp_agg_chunk c
  left join shippers s on s.id = c.shipper_id
  group by c.shipper_id, s.name
  on conflict (batch_id, group_key) do update set
    line_count = batch_shipper_summary.line_count + excluded.line_count,
    total_original = batch_shipper_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_summary.total_final + excluded.total_final;

  insert into batch_shipper_summary
    (batch_id, group_key, shipper_id, shipper_name, sender_name, line_count, total_original, total_applied, total_final)
  select
    p_batch_id,
    'sender:' || c.shipper_name_candidate,
    null,
    c.shipper_name_candidate,
    c.shipper_name_candidate,
    count(*),
    coalesce(sum(c.total_fee), 0),
    coalesce(sum(c.applied_amount), 0),
    coalesce(sum(c.final_amount), 0)
  from tmp_agg_chunk c
  where c.shipper_id is null
  group by c.shipper_name_candidate
  on conflict (batch_id, group_key) do update set
    line_count = batch_shipper_summary.line_count + excluded.line_count,
    total_original = batch_shipper_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_summary.total_final + excluded.total_final;

  update monthly_batches mb
  set total_original = mb.total_original + coalesce((select sum(total_fee) from tmp_agg_chunk), 0),
      total_applied = mb.total_applied + coalesce((select sum(applied_amount) from tmp_agg_chunk), 0),
      total_final = mb.total_final + coalesce((select sum(final_amount) from tmp_agg_chunk), 0)
  where mb.id = p_batch_id;

  return query select max(tmp_agg_chunk.id), count(*)::integer from tmp_agg_chunk;
end;
$$;

-- 청크 누적이 끝난 뒤, 반복 미등록(sender:*) 그룹 중 1건짜리를 지우고 건수 상위 200개만 남긴다.
create or replace function finalize_batch_aggregates(p_batch_id bigint)
returns void
language sql
as $$
  delete from batch_shipper_summary
  where batch_id = p_batch_id
    and group_key like 'sender:%'
    and group_key not in (
      select group_key from batch_shipper_summary
      where batch_id = p_batch_id and group_key like 'sender:%' and line_count > 1
      order by line_count desc
      limit 200
    );
$$;

-- 건별 수동 수정을 반영하면서 monthly_batches/batch_shipper_summary 캐시도 델타만큼 같이 갱신한다.
-- (전체 재집계 대신 델타 갱신이라 21만 건짜리 배치에서도 즉시 처리됨)
create or replace function set_line_manual_amount(p_line_id bigint, p_manual_amount numeric)
returns table (id bigint, manual_amount numeric, is_manual_edit boolean, final_amount numeric)
language plpgsql
as $$
declare
  v_batch_id bigint;
  v_shipper_id bigint;
  v_candidate text;
  v_old_final numeric;
  v_new_final numeric;
  v_delta numeric;
begin
  select il.batch_id, il.shipper_id, il.shipper_name_candidate, il.final_amount
  into v_batch_id, v_shipper_id, v_candidate, v_old_final
  from invoice_lines il where il.id = p_line_id;

  update invoice_lines il
  set manual_amount = p_manual_amount,
      is_manual_edit = (p_manual_amount is not null)
  where il.id = p_line_id
  returning il.final_amount into v_new_final;

  v_delta := v_new_final - v_old_final;

  if v_delta <> 0 then
    update monthly_batches set total_final = total_final + v_delta where monthly_batches.id = v_batch_id;

    update batch_shipper_summary
    set total_final = total_final + v_delta
    where batch_id = v_batch_id
      and group_key = case when v_shipper_id is null then 'unregistered' else 'shipper:' || v_shipper_id::text end;

    if v_shipper_id is null then
      update batch_shipper_summary
      set total_final = total_final + v_delta
      where batch_id = v_batch_id
        and group_key = 'sender:' || v_candidate;
    end if;
  end if;

  return query select il.id, il.manual_amount, il.is_manual_edit, il.final_amount from invoice_lines il where il.id = p_line_id;
end;
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

-- "화주사로 등록" 버튼 전용: 방금 등록한 화주사 이름(candidate_name)에 해당하는 행만 이관한다.
-- 전체 재계산(recompute_batch_applied_amounts_chunk)은 화주사/단가표가 광범위하게 바뀔 때 쓰는 것이고,
-- 신규 화주사 1명 등록은 그 이름에 해당하는 행(보통 수천 건)만 건드리면 되므로 21만 건 전체를 훑을 필요가 없다.
create or replace function assign_shipper_to_candidate(p_batch_id bigint, p_shipper_id bigint, p_candidate_name text)
returns integer
language plpgsql
as $$
declare
  v_old_orig numeric;
  v_old_appl numeric;
  v_old_final numeric;
  v_new_appl numeric;
  v_new_final numeric;
  v_count integer;
begin
  select coalesce(sum(total_fee), 0), coalesce(sum(applied_amount), 0), coalesce(sum(final_amount), 0), count(*)
  into v_old_orig, v_old_appl, v_old_final, v_count
  from invoice_lines
  where batch_id = p_batch_id and shipper_id is null and shipper_name_candidate = p_candidate_name;

  if v_count = 0 then
    return 0;
  end if;

  with computed as (
    select il.id, coalesce(t.contract_price + il.other_fee, il.total_fee) as new_applied
    from invoice_lines il
    left join lateral (
      select srt.contract_price
      from shipper_rate_tiers srt
      where srt.shipper_id = p_shipper_id and srt.cj_base_fee = il.base_fee
      order by srt.effective_from desc
      limit 1
    ) t on true
    where il.batch_id = p_batch_id
      and il.shipper_id is null
      and il.shipper_name_candidate = p_candidate_name
  ),
  upd as (
    update invoice_lines il
    set shipper_id = p_shipper_id,
        applied_amount = c.new_applied
    from computed c
    where il.id = c.id
    returning il.applied_amount, il.final_amount
  )
  select coalesce(sum(applied_amount), 0), coalesce(sum(final_amount), 0)
  into v_new_appl, v_new_final
  from upd;

  update monthly_batches
  set total_applied = total_applied + (v_new_appl - v_old_appl),
      total_final = total_final + (v_new_final - v_old_final)
  where monthly_batches.id = p_batch_id;

  update batch_shipper_summary
  set line_count = line_count - v_count,
      total_original = total_original - v_old_orig,
      total_applied = total_applied - v_old_appl,
      total_final = total_final - v_old_final
  where batch_id = p_batch_id and group_key = 'unregistered';

  delete from batch_shipper_summary
  where batch_id = p_batch_id and group_key = 'sender:' || p_candidate_name;

  insert into batch_shipper_summary
    (batch_id, group_key, shipper_id, shipper_name, sender_name, line_count, total_original, total_applied, total_final)
  select p_batch_id, 'shipper:' || p_shipper_id::text, p_shipper_id, s.name, null, v_count, v_old_orig, v_new_appl, v_new_final
  from shippers s
  where s.id = p_shipper_id
  on conflict (batch_id, group_key) do update set
    line_count = batch_shipper_summary.line_count + excluded.line_count,
    total_original = batch_shipper_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_summary.total_final + excluded.total_final;

  return v_count;
end;
$$;
