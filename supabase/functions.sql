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
  delete from batch_shipper_type_summary where batch_id = p_batch_id;
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
    reservation_type text,
    total_fee numeric,
    applied_amount numeric,
    final_amount numeric
  ) on commit drop;

  truncate tmp_agg_chunk;

  insert into tmp_agg_chunk
  select il.id, il.shipper_id, il.shipper_name_candidate, il.reservation_type, il.total_fee, il.applied_amount, il.final_amount
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

  insert into batch_shipper_type_summary
    (batch_id, group_key, reservation_type, line_count, total_original, total_applied, total_final)
  select
    p_batch_id,
    case when c.shipper_id is null then 'unregistered' else 'shipper:' || c.shipper_id::text end,
    c.reservation_type,
    count(*),
    coalesce(sum(c.total_fee), 0),
    coalesce(sum(c.applied_amount), 0),
    coalesce(sum(c.final_amount), 0)
  from tmp_agg_chunk c
  group by c.shipper_id, c.reservation_type
  on conflict (batch_id, group_key, reservation_type) do update set
    line_count = batch_shipper_type_summary.line_count + excluded.line_count,
    total_original = batch_shipper_type_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_type_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_type_summary.total_final + excluded.total_final;

  insert into batch_shipper_type_summary
    (batch_id, group_key, reservation_type, line_count, total_original, total_applied, total_final)
  select
    p_batch_id,
    'sender:' || c.shipper_name_candidate,
    c.reservation_type,
    count(*),
    coalesce(sum(c.total_fee), 0),
    coalesce(sum(c.applied_amount), 0),
    coalesce(sum(c.final_amount), 0)
  from tmp_agg_chunk c
  where c.shipper_id is null
  group by c.shipper_name_candidate, c.reservation_type
  on conflict (batch_id, group_key, reservation_type) do update set
    line_count = batch_shipper_type_summary.line_count + excluded.line_count,
    total_original = batch_shipper_type_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_type_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_type_summary.total_final + excluded.total_final;

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

  -- 일반/반품 세부 캐시도 위에서 살아남은 sender:* 그룹에 맞춰 정리 (없어진 그룹은 같이 제거)
  delete from batch_shipper_type_summary bsts
  where bsts.batch_id = p_batch_id
    and bsts.group_key like 'sender:%'
    and not exists (
      select 1 from batch_shipper_summary bss
      where bss.batch_id = bsts.batch_id and bss.group_key = bsts.group_key
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
  v_reservation_type text;
  v_old_final numeric;
  v_new_final numeric;
  v_delta numeric;
begin
  select il.batch_id, il.shipper_id, il.shipper_name_candidate, il.reservation_type, il.final_amount
  into v_batch_id, v_shipper_id, v_candidate, v_reservation_type, v_old_final
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

    update batch_shipper_type_summary
    set total_final = total_final + v_delta
    where batch_id = v_batch_id
      and group_key = case when v_shipper_id is null then 'unregistered' else 'shipper:' || v_shipper_id::text end
      and reservation_type = v_reservation_type;

    if v_shipper_id is null then
      update batch_shipper_summary
      set total_final = total_final + v_delta
      where batch_id = v_batch_id
        and group_key = 'sender:' || v_candidate;

      update batch_shipper_type_summary
      set total_final = total_final + v_delta
      where batch_id = v_batch_id
        and group_key = 'sender:' || v_candidate
        and reservation_type = v_reservation_type;
    end if;
  end if;

  return query select il.id, il.manual_amount, il.is_manual_edit, il.final_amount from invoice_lines il where il.id = p_line_id;
end;
$$;

-- 업로드 이후 화주사 마스터/구간표가 바뀐 경우, 해당 배치의 shipper_id/applied_amount를 서버에서 일괄 재계산
-- (수동 수정된 manual_amount는 건드리지 않음. shipper_manual=true인 건도 shipper_id는 그대로 두되
--  그 화주사 기준 단가로 applied_amount는 갱신함 -- 반품 품목명 매칭 등 이름매칭 밖에서 예외적으로
--  확정한 화주사 배정이 재계산 때마다 되돌아가는 문제가 있었음)
-- 21만 건을 한 statement로 처리하면 statement_timeout(약 8초)에 걸리므로 청크 단위로 처리한다.
-- p_after_id 이후 id 기준으로 p_limit개만 처리하고, 다음 호출에 쓸 last_id와 처리 건수를 반환한다.
-- 값이 실제로 바뀐 행만 UPDATE한다 (applied_amount가 바뀌면 STORED 컬럼인 final_amount와 관련 인덱스도
-- 매번 다시 써야 해서, 대부분 그대로인 21만 건을 매번 전부 쓰면 청크당 4~6초씩 걸림을 확인함).
-- scanned_count는 이번 청크에서 훑은(=페이지네이션 커서 판단용) 건수, updated_count는 실제 변경된 건수.
create or replace function recompute_batch_applied_amounts_chunk(p_batch_id bigint, p_after_id bigint, p_limit integer default 20000)
returns table (last_id bigint, scanned_count integer, updated_count integer)
language plpgsql
as $$
declare
  v_last_id bigint;
  v_scanned integer;
  v_updated integer;
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

  create temporary table if not exists tmp_recompute_chunk (
    id bigint primary key,
    shipper_id bigint,
    new_applied_amount numeric
  ) on commit drop;
  truncate tmp_recompute_chunk;

  -- shipper_rate_tiers(화주사별 타입 참고표)는 라인 단위 타입 판별 방법이 없어 여기서 매칭에 쓰지 않는다
  -- (shipper-match.js 상단 주석 참고). applied_amount는 항상 원본 총운임(total_fee) 그대로 둔다.
  insert into tmp_recompute_chunk (id, shipper_id, new_applied_amount)
  select
    c.id,
    case when c.shipper_manual then c.cur_shipper_id else sn.shipper_id end as final_shipper_id,
    c.total_fee
  from (
    select il.id, il.total_fee, il.shipper_name_candidate,
           il.shipper_manual, il.shipper_id as cur_shipper_id
    from invoice_lines il
    where il.batch_id = p_batch_id
      and il.id > p_after_id
    order by il.id
    limit p_limit
  ) c
  left join tmp_shipper_names sn on sn.norm_name = lower(trim(c.shipper_name_candidate));

  select max(id), count(*) into v_last_id, v_scanned from tmp_recompute_chunk;

  update invoice_lines il
  set shipper_id = tmp.shipper_id,
      applied_amount = tmp.new_applied_amount
  from tmp_recompute_chunk tmp
  where il.id = tmp.id
    and (il.shipper_id is distinct from tmp.shipper_id or il.applied_amount is distinct from tmp.new_applied_amount);
  get diagnostics v_updated = row_count;

  return query select v_last_id, v_scanned, v_updated;
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
  v_count integer;
begin
  create temporary table if not exists tmp_assign_before (
    reservation_type text, cnt bigint, t_orig numeric, t_appl numeric, t_final numeric
  ) on commit drop;
  truncate tmp_assign_before;

  insert into tmp_assign_before
  select reservation_type, count(*), coalesce(sum(total_fee), 0), coalesce(sum(applied_amount), 0), coalesce(sum(final_amount), 0)
  from invoice_lines
  where batch_id = p_batch_id and shipper_id is null and shipper_name_candidate = p_candidate_name
  group by reservation_type;

  select coalesce(sum(cnt), 0) into v_count from tmp_assign_before;
  if v_count = 0 then
    return 0;
  end if;

  create temporary table if not exists tmp_assign_after (
    reservation_type text, cnt bigint, t_appl numeric, t_final numeric
  ) on commit drop;
  truncate tmp_assign_after;

  with computed as (
    select il.id, il.reservation_type, coalesce(t.contract_price + il.other_fee, il.total_fee) as new_applied
    from invoice_lines il
    left join lateral (
      select srt.contract_price
      from shipper_rate_tiers srt
      where srt.shipper_id = p_shipper_id and srt.cj_base_fee = il.base_fee
        and (il.pickup_date is null or srt.effective_from <= il.pickup_date)
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
    returning il.reservation_type, il.applied_amount, il.final_amount
  )
  insert into tmp_assign_after
  select reservation_type, count(*), coalesce(sum(applied_amount), 0), coalesce(sum(final_amount), 0)
  from upd
  group by reservation_type;

  update monthly_batches
  set total_applied = total_applied
        + (select coalesce(sum(t_appl), 0) from tmp_assign_after)
        - (select coalesce(sum(t_appl), 0) from tmp_assign_before),
      total_final = total_final
        + (select coalesce(sum(t_final), 0) from tmp_assign_after)
        - (select coalesce(sum(t_final), 0) from tmp_assign_before)
  where monthly_batches.id = p_batch_id;

  update batch_shipper_summary
  set line_count = line_count - v_count,
      total_original = total_original - (select coalesce(sum(t_orig), 0) from tmp_assign_before),
      total_applied = total_applied - (select coalesce(sum(t_appl), 0) from tmp_assign_before),
      total_final = total_final - (select coalesce(sum(t_final), 0) from tmp_assign_before)
  where batch_id = p_batch_id and group_key = 'unregistered';

  update batch_shipper_type_summary bts
  set line_count = bts.line_count - b.cnt,
      total_original = bts.total_original - b.t_orig,
      total_applied = bts.total_applied - b.t_appl,
      total_final = bts.total_final - b.t_final
  from tmp_assign_before b
  where bts.batch_id = p_batch_id and bts.group_key = 'unregistered' and bts.reservation_type = b.reservation_type;

  delete from batch_shipper_summary
  where batch_id = p_batch_id and group_key = 'sender:' || p_candidate_name;
  delete from batch_shipper_type_summary
  where batch_id = p_batch_id and group_key = 'sender:' || p_candidate_name;

  insert into batch_shipper_summary
    (batch_id, group_key, shipper_id, shipper_name, sender_name, line_count, total_original, total_applied, total_final)
  select
    p_batch_id, 'shipper:' || p_shipper_id::text, p_shipper_id, s.name, null,
    v_count,
    (select coalesce(sum(t_orig), 0) from tmp_assign_before),
    (select coalesce(sum(t_appl), 0) from tmp_assign_after),
    (select coalesce(sum(t_final), 0) from tmp_assign_after)
  from shippers s
  where s.id = p_shipper_id
  on conflict (batch_id, group_key) do update set
    line_count = batch_shipper_summary.line_count + excluded.line_count,
    total_original = batch_shipper_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_summary.total_final + excluded.total_final;

  insert into batch_shipper_type_summary (batch_id, group_key, reservation_type, line_count, total_original, total_applied, total_final)
  select p_batch_id, 'shipper:' || p_shipper_id::text, b.reservation_type, b.cnt, b.t_orig, a.t_appl, a.t_final
  from tmp_assign_before b
  join tmp_assign_after a on a.reservation_type = b.reservation_type
  on conflict (batch_id, group_key, reservation_type) do update set
    line_count = batch_shipper_type_summary.line_count + excluded.line_count,
    total_original = batch_shipper_type_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_type_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_type_summary.total_final + excluded.total_final;

  return v_count;
end;
$$;

-- assign_shipper_to_candidate / merge-candidate 로 잘못 병합한 경우 되돌리기.
-- 해당 화주사에서 그 이름(candidate_name)에 해당하는 행만 다시 미등록으로 되돌린다.
-- alias 제거 여부는 호출부에서 별도 처리(이 함수는 invoice_lines/캐시만 되돌림).
create or replace function unassign_shipper_candidate(p_batch_id bigint, p_shipper_id bigint, p_candidate_name text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  create temporary table if not exists tmp_unassign_before (
    reservation_type text, cnt bigint, t_appl numeric, t_final numeric
  ) on commit drop;
  truncate tmp_unassign_before;

  insert into tmp_unassign_before
  select reservation_type, count(*), coalesce(sum(applied_amount), 0), coalesce(sum(final_amount), 0)
  from invoice_lines
  where batch_id = p_batch_id and shipper_id = p_shipper_id and shipper_name_candidate = p_candidate_name
  group by reservation_type;

  select coalesce(sum(cnt), 0) into v_count from tmp_unassign_before;
  if v_count = 0 then
    return 0;
  end if;

  create temporary table if not exists tmp_unassign_after (
    reservation_type text, cnt bigint, t_orig numeric, t_final numeric
  ) on commit drop;
  truncate tmp_unassign_after;

  with upd as (
    update invoice_lines
    set shipper_id = null,
        applied_amount = total_fee,
        -- 리셋 안 하면 이 라인은 향후 재계산에서 이름매칭 대상에서 영구히 제외됨(shipper_manual=true가 계속 우선함)
        shipper_manual = false
    where batch_id = p_batch_id and shipper_id = p_shipper_id and shipper_name_candidate = p_candidate_name
    returning reservation_type, total_fee, final_amount
  )
  insert into tmp_unassign_after
  select reservation_type, count(*), coalesce(sum(total_fee), 0), coalesce(sum(final_amount), 0)
  from upd
  group by reservation_type;

  update monthly_batches
  set total_applied = total_applied
        + (select coalesce(sum(t_orig), 0) from tmp_unassign_after)
        - (select coalesce(sum(t_appl), 0) from tmp_unassign_before),
      total_final = total_final
        + (select coalesce(sum(t_final), 0) from tmp_unassign_after)
        - (select coalesce(sum(t_final), 0) from tmp_unassign_before)
  where monthly_batches.id = p_batch_id;

  update batch_shipper_summary
  set line_count = line_count - v_count,
      total_original = total_original - (select coalesce(sum(t_orig), 0) from tmp_unassign_after),
      total_applied = total_applied - (select coalesce(sum(t_appl), 0) from tmp_unassign_before),
      total_final = total_final - (select coalesce(sum(t_final), 0) from tmp_unassign_before)
  where batch_id = p_batch_id and group_key = 'shipper:' || p_shipper_id::text;

  update batch_shipper_type_summary bts
  set line_count = bts.line_count - b.cnt,
      total_original = bts.total_original - a.t_orig,
      total_applied = bts.total_applied - b.t_appl,
      total_final = bts.total_final - b.t_final
  from tmp_unassign_before b
  join tmp_unassign_after a on a.reservation_type = b.reservation_type
  where bts.batch_id = p_batch_id and bts.group_key = 'shipper:' || p_shipper_id::text and bts.reservation_type = b.reservation_type;

  update batch_shipper_summary
  set line_count = line_count + v_count,
      total_original = total_original + (select coalesce(sum(t_orig), 0) from tmp_unassign_after),
      total_applied = total_applied + (select coalesce(sum(t_orig), 0) from tmp_unassign_after),
      total_final = total_final + (select coalesce(sum(t_final), 0) from tmp_unassign_after)
  where batch_id = p_batch_id and group_key = 'unregistered';

  insert into batch_shipper_type_summary (batch_id, group_key, reservation_type, line_count, total_original, total_applied, total_final)
  select p_batch_id, 'unregistered', reservation_type, cnt, t_orig, t_orig, t_final
  from tmp_unassign_after
  on conflict (batch_id, group_key, reservation_type) do update set
    line_count = batch_shipper_type_summary.line_count + excluded.line_count,
    total_original = batch_shipper_type_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_type_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_type_summary.total_final + excluded.total_final;

  insert into batch_shipper_summary
    (batch_id, group_key, shipper_id, shipper_name, sender_name, line_count, total_original, total_applied, total_final)
  select
    p_batch_id, 'sender:' || p_candidate_name, null, p_candidate_name, p_candidate_name,
    v_count,
    (select coalesce(sum(t_orig), 0) from tmp_unassign_after),
    (select coalesce(sum(t_orig), 0) from tmp_unassign_after),
    (select coalesce(sum(t_final), 0) from tmp_unassign_after)
  on conflict (batch_id, group_key) do update set
    line_count = excluded.line_count,
    total_original = excluded.total_original,
    total_applied = excluded.total_applied,
    total_final = excluded.total_final;

  insert into batch_shipper_type_summary (batch_id, group_key, reservation_type, line_count, total_original, total_applied, total_final)
  select p_batch_id, 'sender:' || p_candidate_name, reservation_type, cnt, t_orig, t_orig, t_final
  from tmp_unassign_after
  on conflict (batch_id, group_key, reservation_type) do update set
    line_count = excluded.line_count,
    total_original = excluded.total_original,
    total_applied = excluded.total_applied,
    total_final = excluded.total_final;

  return v_count;
end;
$$;

-- 송화인/받는분을 직접 수정한 뒤 호출: shipper_name_candidate(생성컬럼)가 바뀐 이름을 반영하면
-- 등록된 화주사명/별칭과 다시 매칭해서 shipper_id/applied_amount를 재계산한다.
-- 매칭 안 되면 미등록(shipper_id=null)으로 남는다.
-- batch_shipper_summary/type_summary 캐시도 옛 그룹에서 차감 + 새 그룹에 추가하는 델타 방식으로 즉시
-- 갱신한다 (전체 재집계는 21만 건 기준 14~17초씩 걸려서, 몇 건짜리 수정에는 맞지 않음을 확인함).
create or replace function update_lines_and_reassign(
  p_line_ids bigint[],
  p_sender_name text,
  p_receiver_name text,
  p_update_sender boolean,
  p_update_receiver boolean
)
returns table (updated_count integer, matched_count integer)
language plpgsql
as $$
declare
  v_updated integer;
  v_matched integer;
  v_batch_id bigint;
begin
  select il.batch_id into v_batch_id from invoice_lines il where il.id = p_line_ids[1];

  create temporary table if not exists tmp_reassign_before (
    id bigint primary key,
    shipper_id bigint,
    shipper_name_candidate text,
    reservation_type text,
    total_fee numeric,
    applied_amount numeric,
    final_amount numeric
  ) on commit drop;
  truncate tmp_reassign_before;
  insert into tmp_reassign_before
  select id, shipper_id, shipper_name_candidate, reservation_type, total_fee, applied_amount, final_amount
  from invoice_lines where id = any(p_line_ids);

  update invoice_lines il
  set sender_name = case when p_update_sender then p_sender_name else il.sender_name end,
      receiver_name = case when p_update_receiver then p_receiver_name else il.receiver_name end
  where il.id = any(p_line_ids);
  get diagnostics v_updated = row_count;

  with names as (
    select s.id as shipper_id, lower(trim(s.name)) as norm_name from shippers s where s.is_active
    union
    select s.id, lower(trim(a)) from shippers s, unnest(s.alias) a where s.is_active
  ),
  computed as (
    select il.id as line_id, n.shipper_id,
      coalesce(t.contract_price + il.other_fee, il.total_fee) as new_applied_amount
    from invoice_lines il
    left join names n on n.norm_name = lower(trim(il.shipper_name_candidate))
    left join lateral (
      select srt.contract_price from shipper_rate_tiers srt
      where srt.shipper_id = n.shipper_id and srt.cj_base_fee = il.base_fee
        and (il.pickup_date is null or srt.effective_from <= il.pickup_date)
      order by srt.effective_from desc limit 1
    ) t on n.shipper_id is not null
    where il.id = any(p_line_ids)
  )
  update invoice_lines il
  set shipper_id = c.shipper_id,
      applied_amount = c.new_applied_amount,
      shipper_manual = false
  from computed c
  where il.id = c.line_id;

  select count(*) into v_matched from invoice_lines where id = any(p_line_ids) and shipper_id is not null;

  -- monthly_batches 델타 (수정 대상 라인만 비교하므로 빠름)
  update monthly_batches mb
  set total_original = mb.total_original + d.d_orig,
      total_applied = mb.total_applied + d.d_appl,
      total_final = mb.total_final + d.d_final
  from (
    select
      coalesce(sum(a.total_fee - b.total_fee), 0) as d_orig,
      coalesce(sum(a.applied_amount - b.applied_amount), 0) as d_appl,
      coalesce(sum(a.final_amount - b.final_amount), 0) as d_final
    from invoice_lines a join tmp_reassign_before b on a.id = b.id
  ) d
  where mb.id = v_batch_id;

  -- 1) 옛 그룹(shipper:*/unregistered)에서 차감
  with old_shipper_groups as (
    select case when shipper_id is null then 'unregistered' else 'shipper:'||shipper_id::text end as group_key,
      count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from tmp_reassign_before
    group by shipper_id
  )
  update batch_shipper_summary bss
  set line_count = bss.line_count - g.cnt,
      total_original = bss.total_original - g.t_orig,
      total_applied = bss.total_applied - g.t_appl,
      total_final = bss.total_final - g.t_final
  from old_shipper_groups g
  where bss.batch_id = v_batch_id and bss.group_key = g.group_key;

  -- 2) 옛 그룹(sender:*)에서 차감 (미등록이었던 것만)
  with old_sender_groups as (
    select 'sender:'||shipper_name_candidate as group_key,
      count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from tmp_reassign_before where shipper_id is null
    group by shipper_name_candidate
  )
  update batch_shipper_summary bss
  set line_count = bss.line_count - g.cnt,
      total_original = bss.total_original - g.t_orig,
      total_applied = bss.total_applied - g.t_appl,
      total_final = bss.total_final - g.t_final
  from old_sender_groups g
  where bss.batch_id = v_batch_id and bss.group_key = g.group_key;

  -- 3) 새 그룹(shipper:*/unregistered)에 추가
  with new_shipper_groups as (
    select case when shipper_id is null then 'unregistered' else 'shipper:'||shipper_id::text end as group_key,
      shipper_id,
      count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from invoice_lines where id = any(p_line_ids)
    group by shipper_id
  )
  insert into batch_shipper_summary (batch_id, group_key, shipper_id, shipper_name, sender_name, line_count, total_original, total_applied, total_final)
  select v_batch_id, g.group_key, g.shipper_id, coalesce(s.name, '미등록(전체)'), null, g.cnt, g.t_orig, g.t_appl, g.t_final
  from new_shipper_groups g
  left join shippers s on s.id = g.shipper_id
  on conflict (batch_id, group_key) do update set
    line_count = batch_shipper_summary.line_count + excluded.line_count,
    total_original = batch_shipper_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_summary.total_final + excluded.total_final;

  -- 4) 새 그룹(sender:*)에 추가 (미등록인 것만)
  with new_sender_groups as (
    select 'sender:'||shipper_name_candidate as group_key, shipper_name_candidate,
      count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from invoice_lines where id = any(p_line_ids) and shipper_id is null
    group by shipper_name_candidate
  )
  insert into batch_shipper_summary (batch_id, group_key, shipper_id, shipper_name, sender_name, line_count, total_original, total_applied, total_final)
  select v_batch_id, g.group_key, null, g.shipper_name_candidate, g.shipper_name_candidate, g.cnt, g.t_orig, g.t_appl, g.t_final
  from new_sender_groups g
  on conflict (batch_id, group_key) do update set
    line_count = batch_shipper_summary.line_count + excluded.line_count,
    total_original = batch_shipper_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_summary.total_final + excluded.total_final;

  -- 5) type_summary도 동일하게 (옛 것 차감)
  with old_shipper_type as (
    select case when shipper_id is null then 'unregistered' else 'shipper:'||shipper_id::text end as group_key,
      reservation_type, count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from tmp_reassign_before
    group by shipper_id, reservation_type
  )
  update batch_shipper_type_summary bts
  set line_count = bts.line_count - g.cnt,
      total_original = bts.total_original - g.t_orig,
      total_applied = bts.total_applied - g.t_appl,
      total_final = bts.total_final - g.t_final
  from old_shipper_type g
  where bts.batch_id = v_batch_id and bts.group_key = g.group_key and bts.reservation_type = g.reservation_type;

  with old_sender_type as (
    select 'sender:'||shipper_name_candidate as group_key,
      reservation_type, count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from tmp_reassign_before where shipper_id is null
    group by shipper_name_candidate, reservation_type
  )
  update batch_shipper_type_summary bts
  set line_count = bts.line_count - g.cnt,
      total_original = bts.total_original - g.t_orig,
      total_applied = bts.total_applied - g.t_appl,
      total_final = bts.total_final - g.t_final
  from old_sender_type g
  where bts.batch_id = v_batch_id and bts.group_key = g.group_key and bts.reservation_type = g.reservation_type;

  -- 6) type_summary 새 것 추가
  with new_shipper_type as (
    select case when shipper_id is null then 'unregistered' else 'shipper:'||shipper_id::text end as group_key,
      reservation_type, count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from invoice_lines where id = any(p_line_ids)
    group by shipper_id, reservation_type
  )
  insert into batch_shipper_type_summary (batch_id, group_key, reservation_type, line_count, total_original, total_applied, total_final)
  select v_batch_id, g.group_key, g.reservation_type, g.cnt, g.t_orig, g.t_appl, g.t_final
  from new_shipper_type g
  on conflict (batch_id, group_key, reservation_type) do update set
    line_count = batch_shipper_type_summary.line_count + excluded.line_count,
    total_original = batch_shipper_type_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_type_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_type_summary.total_final + excluded.total_final;

  with new_sender_type as (
    select 'sender:'||shipper_name_candidate as group_key,
      reservation_type, count(*) as cnt, sum(total_fee) as t_orig, sum(applied_amount) as t_appl, sum(final_amount) as t_final
    from invoice_lines where id = any(p_line_ids) and shipper_id is null
    group by shipper_name_candidate, reservation_type
  )
  insert into batch_shipper_type_summary (batch_id, group_key, reservation_type, line_count, total_original, total_applied, total_final)
  select v_batch_id, g.group_key, g.reservation_type, g.cnt, g.t_orig, g.t_appl, g.t_final
  from new_sender_type g
  on conflict (batch_id, group_key, reservation_type) do update set
    line_count = batch_shipper_type_summary.line_count + excluded.line_count,
    total_original = batch_shipper_type_summary.total_original + excluded.total_original,
    total_applied = batch_shipper_type_summary.total_applied + excluded.total_applied,
    total_final = batch_shipper_type_summary.total_final + excluded.total_final;

  -- 7) 정리: 다 빠져서 0(이하)가 된 그룹, sender: 그룹인데 1건 이하로 줄어든 것 제거
  delete from batch_shipper_summary where batch_id = v_batch_id and group_key not like 'sender:%' and line_count <= 0;
  delete from batch_shipper_summary where batch_id = v_batch_id and group_key like 'sender:%' and line_count <= 1;
  delete from batch_shipper_type_summary bts
  where bts.batch_id = v_batch_id
    and (bts.line_count <= 0
      or (bts.group_key like 'sender:%' and not exists (
        select 1 from batch_shipper_summary bss where bss.batch_id = bts.batch_id and bss.group_key = bts.group_key
      )));

  return query select v_updated, coalesce(v_matched, 0);
end;
$$;

-- 반품 건의 받는분에 물류대행사 이름 등 화주사가 아닌 값이 찍혀 미등록으로 잡힌 경우를 위한 도구.
-- 반품의 (송화인+품목명)을 일반 건의 (받는분+품목명 접두어)와 매칭해 원래 화주사를 찾아 이관하고,
-- 매칭되는 화주사가 하나로 좁혀지지 않으면 건드리지 않고 미등록으로 남긴다.
-- 캐시(batch_shipper_summary 등) 갱신은 하지 않는다 -- 호출부(match-returns API)가 매번
-- refreshBatchAggregates로 전체 재집계를 하므로 델타 갱신을 별도로 넣지 않았다.
create or replace function match_return_candidates_to_general(p_batch_id bigint, p_candidate_names text[])
returns table (matched_count integer, unmatched_count integer)
language plpgsql
as $$
declare
  v_matched integer;
  v_unmatched integer;
begin
  create temporary table if not exists tmp_match_staging (
    id bigint primary key,
    shipper_id bigint,
    new_applied_amount numeric
  ) on commit drop;
  truncate tmp_match_staging;

  insert into tmp_match_staging (id, shipper_id, new_applied_amount)
  with cand as (
    select r.id, r.receiver_name, r.sender_name, r.item_name, r.base_fee, r.other_fee, r.total_fee, r.pickup_date
    from invoice_lines r
    where r.batch_id = p_batch_id and r.reservation_type = '반품'
      and r.shipper_id is null
      and r.receiver_name = any(p_candidate_names)
  ),
  joined as (
    select c.id, c.item_name, c.base_fee, c.other_fee, c.total_fee, c.pickup_date,
           g.item_name as g_item, g.shipper_id as g_shipper_id
    from cand c
    join invoice_lines g
      on g.batch_id = p_batch_id and g.reservation_type = '일반' and g.receiver_name = c.sender_name
  ),
  matched as (
    select id, base_fee, other_fee, total_fee, pickup_date, min(g_shipper_id) as shipper_id
    from joined
    where g_item like item_name || '%'
    group by id, base_fee, other_fee, total_fee, pickup_date
    having count(distinct g_shipper_id) = 1
  )
  select m.id, m.shipper_id,
    coalesce(t.contract_price + m.other_fee, m.total_fee)
  from matched m
  left join lateral (
    select srt.contract_price from shipper_rate_tiers srt
    where srt.shipper_id = m.shipper_id and srt.cj_base_fee = m.base_fee
      and (m.pickup_date is null or srt.effective_from <= m.pickup_date)
    order by srt.effective_from desc limit 1
  ) t on true;

  select count(*) into v_matched from tmp_match_staging;

  update invoice_lines il
  set shipper_id = s.shipper_id, applied_amount = s.new_applied_amount, shipper_manual = true
  from tmp_match_staging s
  where il.id = s.id;

  select count(*) into v_unmatched
  from invoice_lines r
  where r.batch_id = p_batch_id and r.reservation_type = '반품'
    and r.shipper_id is null
    and r.receiver_name = any(p_candidate_names);

  return query select v_matched, v_unmatched;
end;
$$;

-- is_bundled 컬럼을 나중에(기존 행이 이미 있는 상태에서) 추가했을 때 한 번 돌린 백필용 함수.
-- 신규 업로드는 upload API가 매번 is_bundled를 직접 계산해서 넣으므로 평소엔 호출되지 않는다.
create or replace function backfill_is_bundled_chunk(p_after_id bigint, p_limit integer default 20000)
returns table (last_id bigint, updated_count integer)
language plpgsql
as $$
begin
  return query
  with chunk as (
    select id from invoice_lines where id > p_after_id order by id limit p_limit
  ),
  upd as (
    update invoice_lines il
    set is_bundled = (il.item_name like '%$%')
    from chunk c
    where il.id = c.id
    returning il.id
  )
  select max(upd.id), count(*)::integer from upd;
end;
$$;

-- 화주사 계약단가 등록 화면에서 "CJ 기본운임(구간)"을 직접 타이핑하지 않고 실제 라인 데이터에
-- 이미 나타난 값 중에서 고르게 하기 위한 조회 함수. 운임구분(freight_type, 극소/소/중 등) 컬럼값이
-- 없는 배치도 많아 base_fee 금액만으로 구간을 구분한다.
create or replace function shipper_base_fee_breakdown(p_shipper_id bigint)
returns table (
  base_fee numeric,
  line_count bigint
)
language sql
stable
as $$
  select base_fee, count(*)
  from invoice_lines
  where shipper_id = p_shipper_id
  group by base_fee
  order by base_fee
$$;
