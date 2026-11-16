"use client";

import { c as _c } from "react/compiler-runtime";
import { IconDownload, IconFileSpreadsheet, IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type ReportDocument, reportFileName } from "@/lib/reports/exporters/report-document";
import { runWithCleanup } from "@/lib/run-with-cleanup";
type Format = "pdf" | "xlsx" | "csv";
async function buildVehicleExportFile(format: Format, document: ReportDocument) {
  const data = format === "pdf" ? await (await import("@/lib/reports/exporters/report-document-pdf")).exportReportDocumentToPDF(document) : format === "xlsx" ? await (await import("@/lib/reports/exporters/report-document-excel")).exportReportDocumentToExcel(document) : (await import("@/lib/reports/exporters/report-document-csv")).exportReportDocumentToCSV(document);
  return {
    data: data as BlobPart,
    filename: reportFileName(document, format),
    mimeType: format === "pdf" ? "application/pdf" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8;"
  };
}
function downloadVehicleExportFile(file: {
  data: BlobPart;
  filename: string;
  mimeType: string;
}) {
  const url = URL.createObjectURL(new Blob([file.data], {
    type: file.mimeType
  }));
  try {
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser's download task time to consume the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
function exportErrorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

// Vehicle-only lifetime control. Shared project/customer/snapshot export controls
// remain with their owner; all three file serializers and the document are canonical.
export function VehicleReportExports(t0) {
  const $ = _c(47);
  const {
    buildDocument,
    isCurrent
  } = t0;
  const {
    t
  } = useTranslate();
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      active: false
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const active = useRef(t1);
  const pending = useRef(null);
  let t2;
  let t3;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      const arrival = {
        active: true
      };
      active.current = arrival;
      pending.current = null;
      setLoading(null);
      return () => {
        arrival.active = false;
      };
    };
    t3 = [];
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
  let t4;
  if ($[3] !== buildDocument || $[4] !== isCurrent || $[5] !== t) {
    t4 = async function download(format) {
      const arrival_0 = active.current;
      if (!arrival_0.active || !isCurrent() || pending.current) {
        return;
      }
      const request = {};
      pending.current = request;
      setLoading(format);
      setError(null);
      const ownsRequest = () => arrival_0.active && pending.current === request;
      const canDownload = () => ownsRequest() && isCurrent();
      await runWithCleanup(async () => {
        ;
        try {
          const file = await buildVehicleExportFile(format, buildDocument());
          if (!canDownload()) {
            return;
          }
          downloadVehicleExportFile(file);
          toast.success(t("reports.export.success", "Export successful"), {
            description: t("reports.export.downloaded", "Downloaded {filename}", {
              filename: file.filename
            })
          });
        } catch (t5) {
          const cause = t5;
          if (ownsRequest()) {
            setError(exportErrorMessage(cause, t("reports.export.errorDescription", "An error occurred while exporting the report")));
          }
        }
      }, () => {
        if (arrival_0.active && pending.current === request) {
          pending.current = null;
          setLoading(null);
        }
      });
    };
    $[3] = buildDocument;
    $[4] = isCurrent;
    $[5] = t;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  const download = t4;
  const t5 = loading !== null;
  let t6;
  if ($[7] !== download) {
    t6 = () => void download("pdf");
    $[7] = download;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <IconFileText aria-hidden="true" className="size-4" />;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  let t8;
  if ($[10] !== loading || $[11] !== t) {
    t8 = loading === "pdf" ? t("reports.export.generating", "Generating...") : t("reports.export.pdf", "Export PDF");
    $[10] = loading;
    $[11] = t;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  let t9;
  if ($[13] !== t5 || $[14] !== t6 || $[15] !== t8) {
    t9 = <Button type="button" variant="outline" disabled={t5} onClick={t6}>{t7}{t8}</Button>;
    $[13] = t5;
    $[14] = t6;
    $[15] = t8;
    $[16] = t9;
  } else {
    t9 = $[16];
  }
  const t10 = loading !== null;
  let t11;
  if ($[17] !== download) {
    t11 = () => void download("xlsx");
    $[17] = download;
    $[18] = t11;
  } else {
    t11 = $[18];
  }
  let t12;
  if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = <IconFileSpreadsheet aria-hidden="true" className="size-4" />;
    $[19] = t12;
  } else {
    t12 = $[19];
  }
  let t13;
  if ($[20] !== loading || $[21] !== t) {
    t13 = loading === "xlsx" ? t("reports.export.generating", "Generating...") : t("reports.export.excel", "Export Excel");
    $[20] = loading;
    $[21] = t;
    $[22] = t13;
  } else {
    t13 = $[22];
  }
  let t14;
  if ($[23] !== t10 || $[24] !== t11 || $[25] !== t13) {
    t14 = <Button type="button" variant="outline" disabled={t10} onClick={t11}>{t12}{t13}</Button>;
    $[23] = t10;
    $[24] = t11;
    $[25] = t13;
    $[26] = t14;
  } else {
    t14 = $[26];
  }
  const t15 = loading !== null;
  let t16;
  if ($[27] !== download) {
    t16 = () => void download("csv");
    $[27] = download;
    $[28] = t16;
  } else {
    t16 = $[28];
  }
  let t17;
  if ($[29] === Symbol.for("react.memo_cache_sentinel")) {
    t17 = <IconDownload aria-hidden="true" className="size-4" />;
    $[29] = t17;
  } else {
    t17 = $[29];
  }
  let t18;
  if ($[30] !== loading || $[31] !== t) {
    t18 = loading === "csv" ? t("reports.export.generating", "Generating...") : t("reports.export.csv", "Export CSV");
    $[30] = loading;
    $[31] = t;
    $[32] = t18;
  } else {
    t18 = $[32];
  }
  let t19;
  if ($[33] !== t15 || $[34] !== t16 || $[35] !== t18) {
    t19 = <Button type="button" variant="outline" disabled={t15} onClick={t16}>{t17}{t18}</Button>;
    $[33] = t15;
    $[34] = t16;
    $[35] = t18;
    $[36] = t19;
  } else {
    t19 = $[36];
  }
  let t20;
  if ($[37] !== t14 || $[38] !== t19 || $[39] !== t9) {
    t20 = <div className="flex flex-wrap gap-2">{t9}{t14}{t19}</div>;
    $[37] = t14;
    $[38] = t19;
    $[39] = t9;
    $[40] = t20;
  } else {
    t20 = $[40];
  }
  let t21;
  if ($[41] !== error || $[42] !== t) {
    t21 = error && <p role="alert">{t("reports.export.failed", "Export failed")}: {error}</p>;
    $[41] = error;
    $[42] = t;
    $[43] = t21;
  } else {
    t21 = $[43];
  }
  let t22;
  if ($[44] !== t20 || $[45] !== t21) {
    t22 = <div className="space-y-2">{t20}{t21}</div>;
    $[44] = t20;
    $[45] = t21;
    $[46] = t22;
  } else {
    t22 = $[46];
  }
  return t22;
}