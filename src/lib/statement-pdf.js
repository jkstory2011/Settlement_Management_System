import path from 'node:path'
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'

Font.register({
  family: 'Pretendard',
  fonts: [
    {
      src: path.join(process.cwd(), 'node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf'),
      fontWeight: 'normal',
    },
    {
      src: path.join(process.cwd(), 'node_modules/pretendard/dist/public/static/alternative/Pretendard-Bold.ttf'),
      fontWeight: 'bold',
    },
  ],
})

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 9, fontFamily: 'Pretendard' },
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
