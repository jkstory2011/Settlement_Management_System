import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.from('carriers').select('id, name, format_config').order('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ carriers: data })
}

export async function POST(request) {
  const supabase = getSupabaseAdmin()
  const body = await request.json()

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '택배사명은 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await supabase.from('carriers').insert({ name: body.name.trim() }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ carrier: data })
}
