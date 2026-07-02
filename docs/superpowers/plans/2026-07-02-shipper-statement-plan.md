# 화주사 정산서 발행 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배치(택배사+월) 상세 화면에서 화주사별로 정산서를 발행(스냅샷 저장)하고, 화면에서 조회하거나 Excel/PDF로 다운로드할 수 있게 한다.

**Architecture:** 발행 시점의 화주사/배치/라인 데이터를 하나의 jsonb 스냅샷으로 얼려 `shipper_statements` 테이블에 버전별로 저장한다. 조회/다운로드는 항상 이 스냅샷만 읽으며, `invoice_lines`를 다시 계산하지 않는다. UI는 기존 배치 상세 화면(`/monthly-fees/[batchId]`)에 탭 하나를 추가하는 형태로 붙인다.

**Tech Stack:** Next.js 14 App Router API routes, Supabase(Postgres, `@supabase/supabase-js`), `xlsx`(SheetJS, 이미 의존성 있음), `@react-pdf/renderer`(신규 의존성), React(클라이언트 컴포넌트).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-02-shipper-statement-design.md` — 이 문서의 데이터 모델/API/UI 절이 각 태스크의 근거임.
- 발행은 스냅샷 방식: 발행 후 라인이 바뀌어도 기존 정산서는 그대로 유지, 재발행 시 새 버전.
- 집계 단위는 배치(택배사+월) 단위, 화주사별 개별 발행 + 전체 일괄 발행 모두 지원.
- 이 프로젝트에는 자동화 테스트가 구성되어 있지 않다(확인됨: `package.json`에 jest/vitest 없음, `*.test.*` 파일 없음). 각 태스크의 "테스트" 단계는 `npm run dev`로 로컬 서버를 띄운 뒤 curl/브라우저로 실제 동작을 확인하는 수동 검증이다. 이 프로젝트는 별도 스테이징 DB가 없으므로 로컬 서버도 `.env.local`의 운영 Supabase에 연결된다 — 검증 시 실제 배치/화주사 데이터를 사용하고, 쓰기 동작(발행)은 되돌릴 수 있는 것(같은 화주사에 새 버전을 또 발행하는 것은 무해함)만 실행한다.
- 기존 코드 스타일을 따른다: `'use client'` 클라이언트 컴포넌트, `getSupabaseAdmin()`으로 서버에서 서비스롤 접근, `NextResponse.json`, Tailwind 다크모드 우선 클래스, `src/components/ui/*` 공용 컴포넌트 재사용.
- 배치 상세 페이지(`src/app/monthly-fees/[batchId]/page.js`)는 이미 986줄이므로 새 탭 UI는 별도 파일로 분리한다(기존 탭을 리팩터링하지는 않는다).

---

### Task 1: `shipper_statements` 테이블 추가

**Files:**
- Modify: `supabase/schema.sql` (파일 끝에 추가)
- Create: `scratch/apply-shipper-statements-table.mjs` (1회성 적용 스크립트, 다른 스크래치 스크립트와 동일 패턴)

**Interfaces:**
- Produces: `shipper_statements` 테이블 — 컬럼 `id, batch_id, shipper_id, version, issued_at, line_count, total_final, snapshot(jsonb)`, unique `(batch_id, shipper_id, version)`.

- [ ] **Step 1: `schema.sql`에 테이블 정의 추가**

`supabase/schema.sql` 맨 끝에 추가:

```sql

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
```

- [ ] **Step 2: 운영 DB에 적용하는 스크립트 작성**

이 프로젝트는 마이그레이션 도구가 없고, `exec_sql` RPC(서비스롤 전용, `supabase/_bootstrap_exec_sql.sql`)로 SQL Editor 없이 반영해온 전례가 있다(이전 버그수정 커밋 `c81fb97` 참고). 같은 방식으로 적용한다.

`scratch/apply-shipper-statements-table.mjs` 생성:

```js
import { readFileSync } from 'node:fs'

const envText = readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx), l.slice(idx + 1)]
    })
)

const sql = `
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
`

const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
  method: 'POST',
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ sql }),
})
console.log(res.status, await res.text())
```

- [ ] **Step 3: 실행하고 반영 확인**

Run: `node scratch/apply-shipper-statements-table.mjs`
Expected: `204` 출력 (본문 없음 — `exec_sql`은 `void` 반환).

이어서 테이블이 실제로 생겼는지 REST로 확인:

Run:
```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/shipper_statements?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
Expected: `[]` (에러 없이 빈 배열 — 테이블이 존재하고 아직 행이 없다는 뜻).

- [ ] **Step 4: 스크래치 스크립트 삭제, schema.sql만 커밋**

```bash
rm scratch/apply-shipper-statements-table.mjs
git add supabase/schema.sql
git commit -m "feat: shipper_statements 테이블 추가 (정산서 발행 이력)"
```

---

### Task 2: 정산서 스냅샷 빌더 (`src/lib/statement-snapshot.js`)

**Files:**
- Create: `src/lib/statement-snapshot.js`

**Interfaces:**
- Consumes: `getSupabaseAdmin()`의 반환값과 동일한 인터페이스를 가진 `supabase` 클라이언트(호출부에서 주입).
- Produces:
  - `buildStatementSnapshot(supabase, { batchId, shipperId }) -> Promise<Snapshot>` — 캐시(`batch_shipper_summary`)와 실제 라인 합계가 불일치하면 `Error`를 throw.
  - `issueStatement(supabase, batchId, shipperId) -> Promise<{ id, version, issued_at, line_count, total_final }>` — 스냅샷을 만들어 `shipper_statements`에 새 버전으로 insert.
  - `Snapshot` 타입: `{ shipper: {id, name, biz_no, contact}, carrier: {id, name}, batch: {id, year_month}, summary: { 일반, 반품, 합계 (각각 {line_count, total_original, total_applied, total_final}) }, lines: [{tracking_no, pickup_date, reservation_type, sender_name, receiver_name, item_name, qty, is_bundled, base_fee, other_fee, total_fee, applied_amount, final_amount}] }`

- [ ] **Step 1: 라이브러리 파일 작성**

```js
// src/lib/statement-snapshot.js
// 화주사 정산서 스냅샷 생성 + 발행(버전 저장). API 라우트에서만 호출한다.

export async function buildStatementSnapshot(supabase, { batchId, shipperId }) {
  const [{ data: shipper, error: shipperError }, { data: batch, error: batchError }] = await Promise.all([
    supabase.from('shippers').select('id, name, biz_no, contact').eq('id', shipperId).single(),
    supabase.from('monthly_batches').select('id, year_month, carrier_id, carriers(name)').eq('id', batchId).single(),
  ])
  if (shipperError) throw new Error(shipperError.message)
  if (batchError) throw new Error(batchError.message)

  const { data: lines, error: linesError } = await supabase
    .from('invoice_lines')
    .select(
      'tracking_no, pickup_date, reservation_type, sender_name, receiver_name, item_name, qty, is_bundled, base_fee, other_fee, total_fee, applied_amount, final_amount'
    )
    .eq('batch_id', batchId)
    .eq('shipper_id', shipperId)
    .order('no', { ascending: true })
  if (linesError) throw new Error(linesError.message)

  const summary = buildSummary(lines)

  const { data: cached, error: cacheError } = await supabase
    .from('batch_shipper_summary')
    .select('line_count, total_final')
    .eq('batch_id', batchId)
    .eq('group_key', `shipper:${shipperId}`)
    .maybeSingle()
  if (cacheError) throw new Error(cacheError.message)

  assertMatchesCache(summary.합계, cached)

  return {
    shipper: { id: shipper.id, name: shipper.name, biz_no: shipper.biz_no, contact: shipper.contact },
    carrier: { id: batch.carrier_id, name: batch.carriers?.name || null },
    batch: { id: batch.id, year_month: batch.year_month },
    summary,
    lines: lines.map((l) => ({
      tracking_no: l.tracking_no,
      pickup_date: l.pickup_date,
      reservation_type: l.reservation_type,
      sender_name: l.sender_name,
      receiver_name: l.receiver_name,
      item_name: l.item_name,
      qty: l.qty,
      is_bundled: l.is_bundled,
      base_fee: Number(l.base_fee),
      other_fee: Number(l.other_fee),
      total_fee: Number(l.total_fee),
      applied_amount: Number(l.applied_amount),
      final_amount: Number(l.final_amount),
    })),
  }
}

export async function issueStatement(supabase, batchId, shipperId) {
  const snapshot = await buildStatementSnapshot(supabase, { batchId, shipperId })

  const { data: maxRow, error: maxError } = await supabase
    .from('shipper_statements')
    .select('version')
    .eq('batch_id', batchId)
    .eq('shipper_id', shipperId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxError) throw new Error(maxError.message)
  const version = (maxRow?.version || 0) + 1

  const { data: inserted, error: insertError } = await supabase
    .from('shipper_statements')
    .insert({
      batch_id: batchId,
      shipper_id: shipperId,
      version,
      line_count: snapshot.summary.합계.line_count,
      total_final: snapshot.summary.합계.total_final,
      snapshot,
    })
    .select('id, version, issued_at, line_count, total_final')
    .single()
  if (insertError) throw new Error(insertError.message)

  return inserted
}

function buildSummary(lines) {
  const empty = () => ({ line_count: 0, total_original: 0, total_applied: 0, total_final: 0 })
  const acc = { 일반: empty(), 반품: empty(), 합계: empty() }
  for (const l of lines) {
    const bucket = l.reservation_type === '반품' ? '반품' : '일반'
    for (const key of [bucket, '합계']) {
      acc[key].line_count += 1
      acc[key].total_original += Number(l.total_fee)
      acc[key].total_applied += Number(l.applied_amount)
      acc[key].total_final += Number(l.final_amount)
    }
  }
  return acc
}

function assertMatchesCache(liveTotal, cached) {
  if (!cached) {
    if (liveTotal.line_count === 0) return
    throw new Error('배치 캐시가 없습니다. "화주사/단가 재계산"을 실행한 뒤 다시 시도하세요.')
  }
  const mismatch =
    Number(cached.line_count) !== liveTotal.line_count || Number(cached.total_final) !== liveTotal.total_final
  if (mismatch) {
    throw new Error('배치 캐시와 실제 라인 합계가 일치하지 않습니다. "화주사/단가 재계산"을 실행한 뒤 다시 시도하세요.')
  }
}
```

- [ ] **Step 2: 임시 검증 스크립트로 동작 확인**

자동 테스트가 없으므로, 실제 배치/화주사 하나를 골라 직접 호출해본다. `scratch/test-snapshot.mjs`:

```js
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { buildStatementSnapshot } from '../src/lib/statement-snapshot.js'

const envText = readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const idx = l.indexOf('=')
    return [l.slice(0, idx), l.slice(idx + 1)]
  })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// batchId/shipperId는 실제 존재하는 값으로 바꿔서 실행 (대시보드에서 배치 ID, 화주사 관리에서 화주사 ID 확인)
const snapshot = await buildStatementSnapshot(supabase, { batchId: Number(process.argv[2]), shipperId: Number(process.argv[3]) })
console.log(JSON.stringify(snapshot.summary, null, 2))
console.log('lines:', snapshot.lines.length)
```

Run: `node scratch/test-snapshot.mjs <실제_batchId> <실제_shipperId>`
Expected: `summary.합계.line_count`가 해당 배치 상세 화면(`/monthly-fees/[batchId]`)의 "화주사별 건수" 탭에서 그 화주사 카드에 표시되는 건수와 일치.

Run(캐시 불일치 케이스 확인용, 선택): 존재하지 않는 조합이나 최근 재계산 전 상태로 시도하면 에러 메시지가 뜨는지 확인.

- [ ] **Step 3: 검증 스크립트 삭제, 커밋**

```bash
rm scratch/test-snapshot.mjs
git add src/lib/statement-snapshot.js
git commit -m "feat: 정산서 스냅샷 빌더(buildStatementSnapshot/issueStatement) 추가"
```

---

### Task 3: 화주사별 발행 목록 + 개별 발행 API

**Files:**
- Create: `src/app/api/batches/[id]/statements/route.js`

**Interfaces:**
- Consumes: `issueStatement` from `@/lib/statement-snapshot`.
- Produces: `GET /api/batches/:id/statements -> { shippers: [{ shipper_id, shipper_name, current_line_count, current_total_final, latest_statement: {id, version, issued_at, line_count, total_final} | null }] }`, `POST /api/batches/:id/statements { shipperId } -> { statement: {id, version, issued_at, line_count, total_final} }`.

- [ ] **Step 1: 라우트 작성**

```js
// src/app/api/batches/[id]/statements/route.js
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { issueStatement } from '@/lib/statement-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  const { data: summaryRows, error: summaryError } = await supabase
    .from('batch_shipper_summary')
    .select('shipper_id, shipper_name, line_count, total_final')
    .eq('batch_id', batchId)
    .not('shipper_id', 'is', null)
  if (summaryError) return NextResponse.json({ error: summaryError.message }, { status: 500 })

  const { data: statements, error: stError } = await supabase
    .from('shipper_statements')
    .select('id, shipper_id, version, issued_at, line_count, total_final')
    .eq('batch_id', batchId)
    .order('version', { ascending: false })
  if (stError) return NextResponse.json({ error: stError.message }, { status: 500 })

  const latestByShipper = new Map()
  for (const s of statements) {
    if (!latestByShipper.has(s.shipper_id)) latestByShipper.set(s.shipper_id, s)
  }

  const rows = summaryRows
    .filter((r) => Number(r.line_count) > 0)
    .map((r) => {
      const latest = latestByShipper.get(r.shipper_id)
      return {
        shipper_id: r.shipper_id,
        shipper_name: r.shipper_name,
        current_line_count: Number(r.line_count),
        current_total_final: Number(r.total_final),
        latest_statement: latest
          ? {
              id: latest.id,
              version: latest.version,
              issued_at: latest.issued_at,
              line_count: latest.line_count,
              total_final: latest.total_final,
            }
          : null,
      }
    })
    .sort((a, b) => a.shipper_name.localeCompare(b.shipper_name, 'ko'))

  return NextResponse.json({ shippers: rows })
}

export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)
  const body = await request.json()
  const shipperId = Number(body.shipperId)
  if (!shipperId) return NextResponse.json({ error: 'shipperId는 필수입니다.' }, { status: 400 })

  try {
    const statement = await issueStatement(supabase, batchId, shipperId)
    return NextResponse.json({ statement })
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 })
  }
}
```

- [ ] **Step 2: 서버 실행 후 curl로 확인**

Run: `npm run dev` (다른 터미널에서 계속 실행)

Run: `curl -s http://localhost:3000/api/batches/<실제_batchId>/statements`
Expected: `{"shippers":[{"shipper_id":...,"shipper_name":"...","current_line_count":N,"current_total_final":N,"latest_statement":null}, ...]}` — 라인이 있는 등록 화주사만 나오고, `latest_statement`는 아직 전부 `null`.

Run: `curl -s -X POST http://localhost:3000/api/batches/<실제_batchId>/statements -H "Content-Type: application/json" -d '{"shipperId": <실제_shipperId>}'`
Expected: `{"statement":{"id":N,"version":1,"issued_at":"...","line_count":N,"total_final":N}}`

Run(같은 요청 다시): 위 POST를 한 번 더 실행
Expected: `version:2`로 응답 — 재발행 시 버전이 올라가는지 확인.

Run: `curl -s http://localhost:3000/api/batches/<실제_batchId>/statements` 다시 호출
Expected: 해당 화주사의 `latest_statement.version`이 `2`.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/batches/\[id\]/statements/route.js
git commit -m "feat: 화주사별 정산서 발행 목록/개별 발행 API 추가"
```

---

### Task 4: 전체 일괄 발행 API

**Files:**
- Create: `src/app/api/batches/[id]/statements/bulk/route.js`

**Interfaces:**
- Consumes: `issueStatement` from `@/lib/statement-snapshot`.
- Produces: `POST /api/batches/:id/statements/bulk -> { results: [{ shipperId, ok: true, statement } | { shipperId, ok: false, error }] }`.

- [ ] **Step 1: 라우트 작성**

```js
// src/app/api/batches/[id]/statements/bulk/route.js
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { issueStatement } from '@/lib/statement-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request, { params }) {
  const supabase = getSupabaseAdmin()
  const batchId = Number(params.id)

  const { data: summaryRows, error } = await supabase
    .from('batch_shipper_summary')
    .select('shipper_id, line_count')
    .eq('batch_id', batchId)
    .not('shipper_id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const shipperIds = summaryRows.filter((r) => Number(r.line_count) > 0).map((r) => r.shipper_id)

  const results = []
  for (const shipperId of shipperIds) {
    try {
      const statement = await issueStatement(supabase, batchId, shipperId)
      results.push({ shipperId, ok: true, statement })
    } catch (err) {
      results.push({ shipperId, ok: false, error: String(err.message || err) })
    }
  }

  return NextResponse.json({ results })
}
```

- [ ] **Step 2: curl로 확인**

Run: `curl -s -X POST http://localhost:3000/api/batches/<실제_batchId>/statements/bulk`
Expected: `{"results":[{"shipperId":N,"ok":true,"statement":{...}}, ...]}` — 라인이 있는 등록 화주사 수만큼 결과가 나오고 전부 `ok:true`.

Run: `curl -s http://localhost:3000/api/batches/<실제_batchId>/statements`
Expected: 모든 화주사의 `latest_statement`가 채워져 있음(버전은 이전 태스크에서 이미 발행한 화주사는 3, 나머지는 1).

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/batches/\[id\]/statements/bulk/route.js
git commit -m "feat: 정산서 전체 일괄 발행 API 추가"
```

---

### Task 5: 정산서 단건 조회 + 발행 이력 API

**Files:**
- Create: `src/app/api/statements/[id]/route.js`
- Create: `src/app/api/statements/[id]/history/route.js`

**Interfaces:**
- Produces: `GET /api/statements/:id -> { statement: { id, batch_id, shipper_id, version, issued_at, line_count, total_final, snapshot } }`, `GET /api/statements/:id/history -> { history: [{id, version, issued_at, line_count, total_final}] }` (같은 batch_id+shipper_id의 전체 버전, 최신순).

- [ ] **Step 1: 단건 조회 라우트**

```js
// src/app/api/statements/[id]/route.js
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)
  const { data, error } = await supabase.from('shipper_statements').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ statement: data })
}
```

- [ ] **Step 2: 이력 라우트**

```js
// src/app/api/statements/[id]/history/route.js
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)

  const { data: current, error: currentError } = await supabase
    .from('shipper_statements')
    .select('batch_id, shipper_id')
    .eq('id', id)
    .single()
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })

  const { data, error } = await supabase
    .from('shipper_statements')
    .select('id, version, issued_at, line_count, total_final')
    .eq('batch_id', current.batch_id)
    .eq('shipper_id', current.shipper_id)
    .order('version', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ history: data })
}
```

- [ ] **Step 3: curl로 확인**

Task 3에서 발행한 statement id를 사용(POST 응답의 `statement.id`, 또는 목록 API의 `latest_statement.id`).

Run: `curl -s http://localhost:3000/api/statements/<statementId>`
Expected: `{"statement":{"id":...,"snapshot":{"shipper":{...},"lines":[...]}, ...}}`

Run: `curl -s http://localhost:3000/api/statements/<statementId>/history`
Expected: `{"history":[{"id":...,"version":2,...},{"id":...,"version":1,...}]}` (Task 3에서 두 번 발행했던 화주사라면 2건).

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/statements/\[id\]/route.js src/app/api/statements/\[id\]/history/route.js
git commit -m "feat: 정산서 단건 조회/발행 이력 API 추가"
```

---

### Task 6: Excel 내보내기

**Files:**
- Create: `src/lib/statement-xlsx.js`
- Create: `src/app/api/statements/[id]/export/route.js` (Excel만, PDF는 Task 7에서 이어서 같은 파일에 추가)

**Interfaces:**
- Consumes: `Snapshot` 타입(Task 2 정의).
- Produces: `buildStatementXlsxBuffer(snapshot) -> Buffer`, `GET /api/statements/:id/export?format=xlsx -> xlsx 파일 바이너리`.

- [ ] **Step 1: xlsx 빌더 작성**

```js
// src/lib/statement-xlsx.js
import * as XLSX from 'xlsx'

export function buildStatementXlsxBuffer(snapshot) {
  const wb = XLSX.utils.book_new()

  const s = snapshot.summary
  const summaryRows = [
    ['화주사', snapshot.shipper.name],
    ['사업자번호', snapshot.shipper.biz_no || ''],
    ['연락처', snapshot.shipper.contact || ''],
    ['택배사', snapshot.carrier.name || ''],
    ['대상월', snapshot.batch.year_month],
    [],
    ['구분', '건수', '원본운임', '적용운임', '최종금액'],
    ['일반', s.일반.line_count, s.일반.total_original, s.일반.total_applied, s.일반.total_final],
    ['반품', s.반품.line_count, s.반품.total_original, s.반품.total_applied, s.반품.total_final],
    ['합계', s.합계.line_count, s.합계.total_original, s.합계.total_applied, s.합계.total_final],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), '요약')

  const detailHeader = ['송장번호', '집화일', '구분', '송화인', '수화인', '품목', '수량', '원본운임', '최종금액']
  const detailRows = snapshot.lines.map((l) => [
    l.tracking_no,
    l.pickup_date,
    l.reservation_type,
    l.sender_name,
    l.receiver_name,
    l.item_name,
    l.qty,
    l.total_fee,
    l.final_amount,
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]), '명세')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
```

- [ ] **Step 2: export 라우트 작성 (Excel만)**

```js
// src/app/api/statements/[id]/export/route.js
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { buildStatementXlsxBuffer } from '@/lib/statement-xlsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'xlsx'

  const { data: statement, error } = await supabase
    .from('shipper_statements')
    .select('snapshot, version')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const snapshot = statement.snapshot
  const filename = `${snapshot.shipper.name}_${snapshot.batch.year_month}_v${statement.version}`

  if (format === 'xlsx') {
    const buffer = buildStatementXlsxBuffer(snapshot)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.xlsx"`,
      },
    })
  }

  return NextResponse.json({ error: `지원하지 않는 형식: ${format}` }, { status: 400 })
}
```

- [ ] **Step 3: curl로 확인**

Run: `curl -s -o /tmp/statement.xlsx -D - http://localhost:3000/api/statements/<statementId>/export?format=xlsx`
Expected: 응답 헤더에 `content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `/tmp/statement.xlsx` 파일이 생성됨.

Run: Excel/한셀 등으로 `/tmp/statement.xlsx`를 열어 "요약" 시트의 합계 금액이 Task 5의 `GET /api/statements/:id` 응답의 `snapshot.summary.합계.total_final`과 일치하는지, "명세" 시트 행 수가 `snapshot.lines.length`와 같은지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/statement-xlsx.js src/app/api/statements/\[id\]/export/route.js
git commit -m "feat: 정산서 Excel 내보내기 추가"
```

---

### Task 7: PDF 내보내기

**Files:**
- Modify: `package.json` (의존성 추가)
- Create: `src/lib/statement-pdf.js`
- Modify: `src/app/api/statements/[id]/export/route.js` (PDF 분기 추가)

**Interfaces:**
- Consumes: `Snapshot` 타입(Task 2 정의).
- Produces: `renderStatementPdfBuffer(snapshot) -> Promise<Buffer>`, `GET /api/statements/:id/export?format=pdf -> pdf 파일 바이너리`.

- [ ] **Step 1: 의존성 설치**

Run: `npm install @react-pdf/renderer`
Expected: `package.json`의 `dependencies`에 `@react-pdf/renderer` 추가됨.

- [ ] **Step 2: PDF 렌더러 작성**

```js
// src/lib/statement-pdf.js
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 9 },
  title: { fontSize: 14, marginBottom: 8, fontWeight: 700 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  summaryTable: { marginBottom: 16 },
  row: { flexDirection: 'row', borderBottom: '1 solid #ddd', paddingVertical: 3 },
  headerCell: { flex: 1, fontWeight: 700 },
  cell: { flex: 1 },
  detailHeaderRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', paddingVertical: 3 },
})

function StatementDocument({ snapshot }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>
          {snapshot.shipper.name} 정산서 ({snapshot.batch.year_month})
        </Text>
        <View style={styles.headerRow}>
          <Text>택배사: {snapshot.carrier.name}</Text>
          <Text>사업자번호: {snapshot.shipper.biz_no || '-'}</Text>
        </View>

        <View style={styles.summaryTable}>
          <View style={styles.row}>
            <Text style={styles.headerCell}>구분</Text>
            <Text style={styles.headerCell}>건수</Text>
            <Text style={styles.headerCell}>원본운임</Text>
            <Text style={styles.headerCell}>최종금액</Text>
          </View>
          {['일반', '반품', '합계'].map((key) => (
            <View style={styles.row} key={key}>
              <Text style={styles.cell}>{key}</Text>
              <Text style={styles.cell}>{snapshot.summary[key].line_count.toLocaleString()}</Text>
              <Text style={styles.cell}>{snapshot.summary[key].total_original.toLocaleString()}</Text>
              <Text style={styles.cell}>{snapshot.summary[key].total_final.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        <View style={styles.detailHeaderRow}>
          <Text style={{ flex: 1.2 }}>송장번호</Text>
          <Text style={{ flex: 0.8 }}>집화일</Text>
          <Text style={{ flex: 0.6 }}>구분</Text>
          <Text style={{ flex: 1 }}>송화인</Text>
          <Text style={{ flex: 1 }}>수화인</Text>
          <Text style={{ flex: 2 }}>품목</Text>
          <Text style={{ flex: 0.5 }}>수량</Text>
          <Text style={{ flex: 1 }}>최종금액</Text>
        </View>
        {snapshot.lines.map((l, i) => (
          <View style={styles.row} key={i} wrap={false}>
            <Text style={{ flex: 1.2 }}>{l.tracking_no}</Text>
            <Text style={{ flex: 0.8 }}>{l.pickup_date}</Text>
            <Text style={{ flex: 0.6 }}>{l.reservation_type}</Text>
            <Text style={{ flex: 1 }}>{l.sender_name}</Text>
            <Text style={{ flex: 1 }}>{l.receiver_name}</Text>
            <Text style={{ flex: 2 }}>{l.item_name}</Text>
            <Text style={{ flex: 0.5 }}>{l.qty}</Text>
            <Text style={{ flex: 1 }}>{Number(l.final_amount).toLocaleString()}</Text>
          </View>
        ))}
      </Page>
    </Document>
  )
}

export async function renderStatementPdfBuffer(snapshot) {
  return renderToBuffer(<StatementDocument snapshot={snapshot} />)
}
```

- [ ] **Step 3: export 라우트에 PDF 분기 추가**

`src/app/api/statements/[id]/export/route.js`에서 import 추가:

```js
import { renderStatementPdfBuffer } from '@/lib/statement-pdf'
```

`if (format === 'xlsx') { ... }` 블록 앞에 추가:

```js
  if (format === 'pdf') {
    const buffer = await renderStatementPdfBuffer(snapshot)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.pdf"`,
      },
    })
  }

```

- [ ] **Step 4: curl로 확인**

Run: `curl -s -o /tmp/statement.pdf -D - "http://localhost:3000/api/statements/<statementId>/export?format=pdf"`
Expected: 응답 헤더 `content-type: application/pdf`, `/tmp/statement.pdf`가 유효한 PDF로 열림(뷰어에서 요약 표 + 명세 표가 보임, 라인 수가 많으면 여러 페이지로 자동 분할됨).

- [ ] **Step 5: 커밋**

```bash
git add package.json package-lock.json src/lib/statement-pdf.js src/app/api/statements/\[id\]/export/route.js
git commit -m "feat: 정산서 PDF 내보내기 추가"
```

---

### Task 8: 정산서 발행 탭 UI (목록)

**Files:**
- Create: `src/app/monthly-fees/[batchId]/StatementsTab.js`
- Modify: `src/app/monthly-fees/[batchId]/page.js`

**Interfaces:**
- Consumes: Task 3/4 API (`GET/POST /api/batches/:id/statements`, `POST /api/batches/:id/statements/bulk`).
- Produces: `<StatementsTab batchId={batchId} />` — 이 태스크에서는 목록/발행만 구현하고, "보기" 클릭 시 상세는 Task 9의 `StatementDetailView`를 사용(아직 없으면 이 태스크에서는 `alert`로 자리만 잡아두지 않고, Task 9와 함께 완성해야 하므로 이 태스크의 Step 3에서 바로 `StatementDetailView`를 import — Task 9를 먼저 봐도 무방).

- [ ] **Step 1: `StatementsTab.js` 작성**

```jsx
// src/app/monthly-fees/[batchId]/StatementsTab.js
'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'
import StatementDetailView from './StatementDetailView'

export default function StatementsTab({ batchId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [issuingId, setIssuingId] = useState(null)
  const [bulkIssuing, setBulkIssuing] = useState(false)
  const [openStatementId, setOpenStatementId] = useState(null)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/batches/${batchId}/statements`)
    const json = await res.json()
    setRows(json.shippers || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [batchId])

  async function handleIssue(shipperId) {
    setIssuingId(shipperId)
    try {
      const res = await fetch(`/api/batches/${batchId}/statements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipperId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '발행 실패')
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setIssuingId(null)
    }
  }

  async function handleBulkIssue() {
    setBulkIssuing(true)
    try {
      const res = await fetch(`/api/batches/${batchId}/statements/bulk`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '일괄 발행 실패')
      const failed = (json.results || []).filter((r) => !r.ok)
      await load()
      if (failed.length > 0) {
        alert(`${failed.length}건 발행 실패:\n${failed.map((f) => `- ${f.shipperId}: ${f.error}`).join('\n')}`)
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setBulkIssuing(false)
    }
  }

  if (openStatementId) {
    return <StatementDetailView statementId={openStatementId} onBack={() => setOpenStatementId(null)} />
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400">화주사별 정산서</h2>
        <Button variant="secondary" onClick={handleBulkIssue} disabled={bulkIssuing || rows.length === 0}>
          {bulkIssuing ? '일괄 발행 중...' : '전체 일괄 발행'}
        </Button>
      </div>
      <Table>
        <THead>
          <Th>화주사</Th>
          <Th className="text-right">현재 건수</Th>
          <Th className="text-right">현재 합계</Th>
          <Th>최근 발행</Th>
          <Th className="text-right">발행 금액</Th>
          <Th></Th>
        </THead>
        <TBody>
          {loading && <EmptyRow colSpan={6}>불러오는 중...</EmptyRow>}
          {!loading && rows.length === 0 && <EmptyRow colSpan={6}>등록된 화주사 라인이 없습니다.</EmptyRow>}
          {!loading &&
            rows.map((r) => (
              <Tr key={r.shipper_id}>
                <Td className="font-medium text-slate-900 dark:text-slate-200">{r.shipper_name}</Td>
                <Td className="tabular text-right">{r.current_line_count.toLocaleString()}</Td>
                <Td className="tabular text-right">{r.current_total_final.toLocaleString()}원</Td>
                <Td>
                  {r.latest_statement
                    ? `v${r.latest_statement.version} · ${new Date(r.latest_statement.issued_at).toLocaleString('ko-KR')}`
                    : '미발행'}
                </Td>
                <Td className="tabular text-right">
                  {r.latest_statement ? `${Number(r.latest_statement.total_final).toLocaleString()}원` : '-'}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {r.latest_statement && (
                      <Button variant="ghost" onClick={() => setOpenStatementId(r.latest_statement.id)}>
                        보기
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => handleIssue(r.shipper_id)}
                      disabled={issuingId === r.shipper_id}
                    >
                      {issuingId === r.shipper_id ? '발행 중...' : r.latest_statement ? '재발행' : '발행'}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
        </TBody>
      </Table>
    </Card>
  )
}
```

- [ ] **Step 2: `page.js`에 탭 등록**

`src/app/monthly-fees/[batchId]/page.js` 상단 import 목록에 추가:

```js
import StatementsTab from './StatementsTab'
```

탭 배열(약 441번째 줄 부근) 수정:

```js
        {[
          { value: 'lines', label: '라인 조회' },
          { value: 'shippers', label: '화주사별 건수' },
          { value: 'statements', label: '정산서 발행' },
        ].map((tab) => (
```

`{activeTab === 'lines' && (` 블록이 시작하는 622번째 줄 바로 앞에 추가:

```jsx
      {activeTab === 'statements' && <StatementsTab batchId={batchId} />}

```

- [ ] **Step 3: 브라우저로 확인**

Run: `npm run dev`, 브라우저에서 `/monthly-fees/<실제_batchId>` 접속.
Expected: 상단 탭에 "정산서 발행"이 추가돼 있고, 클릭하면 화주사별 표가 뜬다. "전체 일괄 발행" 클릭 시 각 화주사 행의 "최근 발행"이 채워지고, "보기"를 누르면(Task 9 완성 후) 상세 화면으로 전환된다.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/monthly-fees/[batchId]/StatementsTab.js" "src/app/monthly-fees/[batchId]/page.js"
git commit -m "feat: 정산서 발행 탭 UI(목록) 추가"
```

---

### Task 9: 정산서 상세 조회 UI (요약 + 명세 + 다운로드 + 이력)

**Files:**
- Create: `src/app/monthly-fees/[batchId]/StatementDetailView.js`

**Interfaces:**
- Consumes: Task 5 API (`GET /api/statements/:id`, `GET /api/statements/:id/history`), Task 6/7 export 엔드포인트(`GET /api/statements/:id/export?format=xlsx|pdf`).
- Produces: `<StatementDetailView statementId={number} onBack={() => void} />` — Task 8의 `StatementsTab.js`가 이미 이 컴포넌트를 import하고 있으므로, 이 파일이 없으면 Task 8의 빌드가 깨진다(같은 PR/커밋 그룹으로 묶어도 됨).

- [ ] **Step 1: `StatementDetailView.js` 작성**

```jsx
// src/app/monthly-fees/[batchId]/StatementDetailView.js
'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import KpiCard from '@/components/ui/KpiCard'
import { Table, THead, Th, TBody, Tr, Td, EmptyRow } from '@/components/ui/Table'

export default function StatementDetailView({ statementId, onBack }) {
  const [statement, setStatement] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [stRes, histRes] = await Promise.all([
        fetch(`/api/statements/${statementId}`),
        fetch(`/api/statements/${statementId}/history`),
      ])
      const stJson = await stRes.json()
      const histJson = await histRes.json()
      setStatement(stJson.statement)
      setHistory(histJson.history || [])
      setLoading(false)
    }
    load()
  }, [statementId])

  if (loading || !statement) {
    return (
      <Card className="p-4">
        <p className="text-sm text-slate-500">불러오는 중...</p>
      </Card>
    )
  }

  const snapshot = statement.snapshot

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← 목록으로
        </Button>
        <div className="flex gap-2">
          <a href={`/api/statements/${statementId}/export?format=xlsx`}>
            <Button variant="secondary">Excel 다운로드</Button>
          </a>
          <a href={`/api/statements/${statementId}/export?format=pdf`}>
            <Button variant="secondary">PDF 다운로드</Button>
          </a>
        </div>
      </div>

      <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
        {snapshot.shipper.name} 정산서 · {snapshot.batch.year_month}
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        {snapshot.carrier.name} · v{statement.version} · {new Date(statement.issued_at).toLocaleString('ko-KR')} 발행
      </p>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <KpiCard
          label="일반"
          value={snapshot.summary.일반.line_count.toLocaleString()}
          unit="건"
          sub={`${snapshot.summary.일반.total_final.toLocaleString()}원`}
        />
        <KpiCard
          label="반품"
          value={snapshot.summary.반품.line_count.toLocaleString()}
          unit="건"
          sub={`${snapshot.summary.반품.total_final.toLocaleString()}원`}
        />
        <KpiCard
          label="합계"
          value={snapshot.summary.합계.line_count.toLocaleString()}
          unit="건"
          sub={`${snapshot.summary.합계.total_final.toLocaleString()}원`}
          tone="accent"
        />
      </div>

      {history.length > 1 && (
        <Card className="mb-4 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-500">발행 이력</p>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <span
                key={h.id}
                className={`rounded px-2 py-1 text-xs ${
                  h.id === statement.id ? 'bg-cyan-600 text-white' : 'bg-slate-100 dark:bg-slate-800'
                }`}
              >
                v{h.version} · {new Date(h.issued_at).toLocaleDateString('ko-KR')}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Table>
        <THead>
          <Th>송장번호</Th>
          <Th>집화일</Th>
          <Th>구분</Th>
          <Th>송화인</Th>
          <Th>수화인</Th>
          <Th>품목</Th>
          <Th className="text-right">수량</Th>
          <Th className="text-right">원본운임</Th>
          <Th className="text-right">최종금액</Th>
        </THead>
        <TBody>
          {snapshot.lines.length === 0 && <EmptyRow colSpan={9}>명세가 없습니다.</EmptyRow>}
          {snapshot.lines.map((l, i) => (
            <Tr key={i}>
              <Td>{l.tracking_no}</Td>
              <Td>{l.pickup_date}</Td>
              <Td>{l.reservation_type}</Td>
              <Td>{l.sender_name}</Td>
              <Td>{l.receiver_name}</Td>
              <Td className="max-w-xs truncate">{l.item_name}</Td>
              <Td className="tabular text-right">{l.qty}</Td>
              <Td className="tabular text-right">{Number(l.total_fee).toLocaleString()}</Td>
              <Td className="tabular text-right">{Number(l.final_amount).toLocaleString()}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 2: 브라우저로 확인**

Run: `/monthly-fees/<실제_batchId>` → "정산서 발행" 탭 → 이미 발행된 화주사의 "보기" 클릭.
Expected: 요약 카드 3개(일반/반품/합계) 숫자가 목록 화면의 "발행 금액"과 일치, 명세 표에 라인이 나열됨, "발행 이력"에 이전 버전들(Task 3/4에서 여러 번 발행했다면 v1/v2/v3)이 보이고 현재 버전이 강조 표시됨.

Run: "Excel 다운로드"/"PDF 다운로드" 클릭
Expected: Task 6/7에서 만든 것과 같은 파일이 브라우저에서 다운로드됨.

Run: 라인 수정 후 재검증(선택) — `/monthly-fees/<batchId>`의 "라인 조회" 탭에서 해당 화주사의 아무 라인 하나를 수동 수정 → "정산서 발행" 탭에서 그 화주사의 "현재 합계"는 바뀌었지만 "발행 금액"(이미 발행된 버전)은 그대로인지 확인 → "재발행" 클릭 후 "보기"를 다시 열면 새 금액이 반영된 새 버전인지 확인.
Expected: 스펙의 스냅샷 고정 요구사항이 지켜짐.

- [ ] **Step 3: 커밋**

```bash
git add "src/app/monthly-fees/[batchId]/StatementDetailView.js"
git commit -m "feat: 정산서 상세 조회 UI(요약/명세/다운로드/이력) 추가"
```

---

## Self-Review

- **스펙 커버리지**: 데이터 모델(Task 1), 발행 API/스냅샷 고정(Task 2~4), 조회/이력(Task 5), Excel/PDF(Task 6~7), UI 목록/상세(Task 8~9), 검증 방식(각 태스크 curl/브라우저 단계) 모두 스펙 문서의 대응 절을 커버함. "범위 밖"으로 명시된 이메일 발송/승인 워크플로/통합 정산서는 포함하지 않음.
- **플레이스홀더 스캔**: TBD/TODO/"적절히 처리" 패턴 없음. 모든 스텝에 실행 가능한 전체 코드/명령어 포함.
- **타입/시그니처 일관성**: `Snapshot` 구조(`shipper/carrier/batch/summary/lines`)를 Task 2에서 정의한 그대로 Task 6(xlsx)·7(pdf)·9(UI)에서 동일한 필드명으로 사용. `issueStatement`/`buildStatementSnapshot` 시그니처가 Task 3/4의 호출부와 일치. API 응답 필드명(`shipper_id`, `current_line_count`, `latest_statement` 등)이 Task 3(생성)과 Task 8(소비) 간에 일치.
