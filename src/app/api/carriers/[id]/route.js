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
  if (body.format_config !== undefined) update.format_config = body.format_config

  const { data, error } = await supabase.from('carriers').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ carrier: data })
}

export async function DELETE(request, { params }) {
  const supabase = getSupabaseAdmin()
  const id = Number(params.id)
  const { error } = await supabase.from('carriers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
