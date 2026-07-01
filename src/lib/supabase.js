import { createClient } from '@supabase/supabase-js'

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// https:// 없이 입력된 경우 자동 보정
const supabaseUrl = rawUrl
  ? (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  : 'https://placeholder.supabase.co'

const supabaseAnonKey = rawKey || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
