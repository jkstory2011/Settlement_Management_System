import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)
  const body = await request.json()

  const update = {}
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.alias !== undefined) update.alias = Array.isArray(body.alias) ? body.alias.filter(Boolean) : []
  if (body.biz_no !== undefined) update.biz_no = body.biz_no || null
  if (body.contact !== undefined) update.contact = body.contact || null
  if (body.memo !== undefined) update.memo = body.memo || null
  if (body.is_active !== undefined) update.is_active = Boolean(body.is_active)

  const { data, error } = await supabase.from('shippers').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shipper: data })
}

export async function DELETE(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)
  const { error } = await supabase.from('shippers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
