// <stdin>
import { c as _c } from "react/compiler-runtime";

// src/lib/reports/exporters/report-document.ts
function formatReportCell(cell, kind, unknownLabel) {
  if (cell === null) return unknownLabel;
  if (kind === "hours" && typeof cell === "number") return cell.toFixed(2);
  return String(cell);
}

// <stdin>
import { jsx, jsxs } from "react/jsx-runtime";
var styleDefinitions = {
  page: {
    padding: 32,
    fontSize: 9,
    fontFamily: "Helvetica"
  },
  title: {
    fontSize: 18,
    marginBottom: 12,
    fontWeight: "bold"
  },
  fact: {
    flexDirection: "row",
    marginBottom: 3
  },
  factLabel: {
    width: "30%",
    fontWeight: "bold"
  },
  factValue: {
    width: "70%"
  },
  tableTitle: {
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 14,
    marginBottom: 6,
    backgroundColor: "#E0E0E0",
    padding: 4
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#4472C4",
    color: "white",
    fontWeight: "bold",
    padding: 4
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#CCCCCC",
    padding: 4
  },
  totalsRow: {
    flexDirection: "row",
    backgroundColor: "#E0E0E0",
    fontWeight: "bold",
    padding: 4
  },
  cell: {
    flex: 1,
    paddingRight: 4
  },
  firstCell: {
    flex: 2,
    paddingRight: 4
  },
  note: {
    marginTop: 4,
    color: "#444444"
  },
  notes: {
    marginTop: 14
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    textAlign: "center",
    fontSize: 8,
    color: "#666666"
  }
};
function ReportPDF(t0) {
  const $ = _c(62);
  const {
    document,
    renderer
  } = t0;
  const {
    Document,
    Page,
    StyleSheet,
    Text,
    View
  } = renderer;
  let t1;
  if ($[0] !== StyleSheet) {
    t1 = StyleSheet.create(styleDefinitions);
    $[0] = StyleSheet;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const styles = t1;
  const t2 = document.title;
  const t3 = styles.page;
  let t4;
  if ($[2] !== Text || $[3] !== document.title || $[4] !== styles.title) {
    t4 = /* @__PURE__ */ jsx(Text, { style: styles.title, children: document.title });
    $[2] = Text;
    $[3] = document.title;
    $[4] = styles.title;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== Text || $[7] !== View || $[8] !== document.facts || $[9] !== styles.fact || $[10] !== styles.factLabel || $[11] !== styles.factValue) {
    let t62;
    if ($[13] !== Text || $[14] !== View || $[15] !== styles.fact || $[16] !== styles.factLabel || $[17] !== styles.factValue) {
      t62 = (fact) => /* @__PURE__ */ jsxs(View, { style: styles.fact, children: [
        /* @__PURE__ */ jsx(Text, { style: styles.factLabel, children: fact.label }),
        /* @__PURE__ */ jsx(Text, { style: styles.factValue, children: fact.value })
      ] }, fact.label);
      $[13] = Text;
      $[14] = View;
      $[15] = styles.fact;
      $[16] = styles.factLabel;
      $[17] = styles.factValue;
      $[18] = t62;
    } else {
      t62 = $[18];
    }
    t5 = document.facts.map(t62);
    $[6] = Text;
    $[7] = View;
    $[8] = document.facts;
    $[9] = styles.fact;
    $[10] = styles.factLabel;
    $[11] = styles.factValue;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[19] !== Text || $[20] !== View || $[21] !== document.tables || $[22] !== document.unknownLabel || $[23] !== styles.cell || $[24] !== styles.firstCell || $[25] !== styles.headerRow || $[26] !== styles.row || $[27] !== styles.tableTitle || $[28] !== styles.totalsRow) {
    let t72;
    if ($[30] !== Text || $[31] !== View || $[32] !== document.unknownLabel || $[33] !== styles.cell || $[34] !== styles.firstCell || $[35] !== styles.headerRow || $[36] !== styles.row || $[37] !== styles.tableTitle || $[38] !== styles.totalsRow) {
      t72 = (table) => {
        const cells = (row) => row.map((cell, index) => /* @__PURE__ */ jsx(Text, { style: index === 0 ? styles.firstCell : styles.cell, children: formatReportCell(cell, table.columns[index]?.kind ?? "text", document.unknownLabel) }, table.columns[index]?.key));
        return /* @__PURE__ */ jsxs(View, { wrap: true, children: [
          /* @__PURE__ */ jsx(Text, { style: styles.tableTitle, children: table.title }),
          /* @__PURE__ */ jsx(View, { style: styles.headerRow, fixed: true, children: table.columns.map((column, index_0) => /* @__PURE__ */ jsx(Text, { style: index_0 === 0 ? styles.firstCell : styles.cell, children: column.header }, column.key)) }),
          table.rows.map((row_0, rowIndex) => /* @__PURE__ */ jsx(View, { style: styles.row, wrap: false, children: cells(row_0) }, rowIndex)),
          table.totals && /* @__PURE__ */ jsx(View, { style: styles.totalsRow, wrap: false, children: cells(table.totals) })
        ] }, table.title);
      };
      $[30] = Text;
      $[31] = View;
      $[32] = document.unknownLabel;
      $[33] = styles.cell;
      $[34] = styles.firstCell;
      $[35] = styles.headerRow;
      $[36] = styles.row;
      $[37] = styles.tableTitle;
      $[38] = styles.totalsRow;
      $[39] = t72;
    } else {
      t72 = $[39];
    }
    t6 = document.tables.map(t72);
    $[19] = Text;
    $[20] = View;
    $[21] = document.tables;
    $[22] = document.unknownLabel;
    $[23] = styles.cell;
    $[24] = styles.firstCell;
    $[25] = styles.headerRow;
    $[26] = styles.row;
    $[27] = styles.tableTitle;
    $[28] = styles.totalsRow;
    $[29] = t6;
  } else {
    t6 = $[29];
  }
  let t7;
  if ($[40] !== Text || $[41] !== View || $[42] !== document.notes || $[43] !== styles.note || $[44] !== styles.notes) {
    t7 = document.notes.length > 0 && /* @__PURE__ */ jsx(View, { style: styles.notes, children: document.notes.map((note) => /* @__PURE__ */ jsx(Text, { style: styles.note, children: note }, note)) });
    $[40] = Text;
    $[41] = View;
    $[42] = document.notes;
    $[43] = styles.note;
    $[44] = styles.notes;
    $[45] = t7;
  } else {
    t7 = $[45];
  }
  let t8;
  if ($[46] !== Text || $[47] !== document.footer || $[48] !== styles.footer) {
    t8 = /* @__PURE__ */ jsx(Text, { style: styles.footer, fixed: true, children: document.footer });
    $[46] = Text;
    $[47] = document.footer;
    $[48] = styles.footer;
    $[49] = t8;
  } else {
    t8 = $[49];
  }
  let t9;
  if ($[50] !== Page || $[51] !== styles.page || $[52] !== t4 || $[53] !== t5 || $[54] !== t6 || $[55] !== t7 || $[56] !== t8) {
    t9 = /* @__PURE__ */ jsxs(Page, { size: "A4", orientation: "landscape", style: t3, children: [
      t4,
      t5,
      t6,
      t7,
      t8
    ] });
    $[50] = Page;
    $[51] = styles.page;
    $[52] = t4;
    $[53] = t5;
    $[54] = t6;
    $[55] = t7;
    $[56] = t8;
    $[57] = t9;
  } else {
    t9 = $[57];
  }
  let t10;
  if ($[58] !== Document || $[59] !== document.title || $[60] !== t9) {
    t10 = /* @__PURE__ */ jsx(Document, { title: t2, children: t9 });
    $[58] = Document;
    $[59] = document.title;
    $[60] = t9;
    $[61] = t10;
  } else {
    t10 = $[61];
  }
  return t10;
}
async function exportReportDocumentToPDF(document) {
  const renderer = await import("@react-pdf/renderer");
  const blob = await renderer.pdf(/* @__PURE__ */ jsx(ReportPDF, { document, renderer })).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}
export {
  exportReportDocumentToPDF
};
