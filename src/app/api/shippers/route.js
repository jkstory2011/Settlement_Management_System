import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('shippers')
    .select('id, name, alias, biz_no, contact, memo, is_active, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shippers: data })
}

export async function POST(request) {
  const supabase = getSupabaseAdmin()
  const body = await request.json()

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '화주사명은 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('shippers')
    .insert({
      name: body.name.trim(),
      alias: Array.isArray(body.alias) ? body.alias.filter(Boolean) : [],
      biz_no: body.biz_no || null,
      contact: body.contact || null,
      memo: body.memo || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shipper: data })
}
