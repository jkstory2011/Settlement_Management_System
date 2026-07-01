import { createClient } from '@supabase/supabase-js'

export function getSupabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    // Next.js는 fetch() 응답을 기본 캐싱하므로, DB 조회는 항상 최신 상태를 봐야 한다
    global: { fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }) },
  })
}
