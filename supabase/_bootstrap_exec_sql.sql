-- 이 함수를 한 번만 등록해두면, 이후부터는 service_role 키로 임의의 DDL/SQL을
-- REST API(rpc/exec_sql)를 통해 직접 실행할 수 있습니다. (service_role은 이미 RLS를
-- 우회하는 최고 권한 키이므로, 이 함수가 추가로 노출하는 위험은 없습니다.)
create or replace function exec_sql(sql text)
returns void
language plpgsql
security definer
as $$
begin
  execute sql;
end;
$$;

revoke all on function exec_sql(text) from public, anon, authenticated;
grant execute on function exec_sql(text) to service_role;
