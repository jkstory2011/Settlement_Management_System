import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { buildStatementXlsxBuffer } from '@/lib/statement-xlsx'
import { renderStatementPdfBuffer } from '@/lib/statement-pdf'

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

  if (format === 'pdf') {
    const buffer = await renderStatementPdfBuffer(snapshot)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.pdf"`,
      },
    })
  }

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
