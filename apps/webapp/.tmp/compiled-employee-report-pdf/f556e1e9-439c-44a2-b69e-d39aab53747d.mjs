// src/lib/datetime/temporal-core.ts
import { Temporal } from "temporal-polyfill";
var systemClock = Object.freeze({
  nowInstant: () => Temporal.Now.instant().round({
    smallestUnit: "millisecond",
    roundingMode: "trunc"
  })
});
var INSTANT_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
var NANOSECONDS_PER_MILLISECOND = BigInt(1e6);
var instantEpochNanosecondsGetter = Object.getOwnPropertyDescriptor(
  Temporal.Instant.prototype,
  "epochNanoseconds"
)?.get;
var instantToString = Temporal.Instant.prototype.toString;
function parseInstant(value) {
  if (typeof value !== "string" || !INSTANT_WITH_OFFSET.test(value)) {
    throw new RangeError(
      "Instant must use a four-digit date and an explicit Z or +/-HH:mm offset"
    );
  }
  return Temporal.Instant.from(value);
}

// src/lib/datetime/temporal-format.ts
import * as TemporalPolyfill from "temporal-polyfill";

// src/lib/timezone/validation.ts
import { Temporal as Temporal2 } from "temporal-polyfill";
var TIMEZONE_VALIDATION_ANCHOR = {
  year: 2e3,
  month: 1,
  day: 1
};
function parseTimeZone(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new RangeError("Timezone must be a non-empty string without surrounding whitespace");
  }
  try {
    return Temporal2.ZonedDateTime.from({
      ...TIMEZONE_VALIDATION_ANCHOR,
      timeZone: value
    }).timeZoneId;
  } catch {
    throw new RangeError(`Invalid timezone: ${value}`);
  }
}

// src/lib/datetime/temporal-format.ts
var TemporalDateTimeFormat = TemporalPolyfill.Intl.DateTimeFormat;
var DATE_TIME_FORMAT_OPTIONS = {
  dateShort: { year: "numeric", month: "numeric", day: "numeric" },
  dateMedium: { year: "numeric", month: "short", day: "numeric" },
  dateTimeMedium: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  },
  time: { hour: "numeric", minute: "2-digit" },
  timeWithSeconds: { hour: "numeric", minute: "2-digit", second: "2-digit" }
};
var TIME_PRESETS = /* @__PURE__ */ new Set([
  "dateTimeMedium",
  "time",
  "timeWithSeconds"
]);
var MAX_FIXED_OFFSET_MINUTES = 23 * 60 + 59;
function formatInstant(instant, context, preset) {
  const timezone = parseTimeZone(context.timezone);
  const options = {
    ...DATE_TIME_FORMAT_OPTIONS[preset],
    timeZone: timezone,
    ...TIME_PRESETS.has(preset) ? {
      // ICU versions differ on numeric 24-hour padding; make the display contract explicit.
      hour: context.timeFormat === "24h" ? "2-digit" : "numeric",
      hour12: context.timeFormat === "12h"
    } : {}
  };
  return new TemporalDateTimeFormat(context.locale, options).format(instant);
}

// src/lib/organization/custom-fields/report-values.ts
function customFieldReportText(field, labels = { yes: "Yes", no: "No" }) {
  if (field.value === null) return "";
  if (typeof field.value === "boolean") return field.value ? labels.yes : labels.no;
  return field.value;
}

// <stdin>
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var currencyFormatters = /* @__PURE__ */ new Map();
var formatCurrency = (amount, currency) => {
  const cachedFormatter = currencyFormatters.get(currency);
  if (cachedFormatter) {
    return cachedFormatter.format(amount);
  }
  const formatter = Intl.NumberFormat("de-DE", {
    style: "currency",
    currency
  });
  currencyFormatters.set(currency, formatter);
  return formatter.format(amount);
};
var styleDefinitions = {
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica"
  },
  title: {
    fontSize: 20,
    marginBottom: 20,
    fontWeight: "bold",
    textAlign: "center"
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "bold",
    marginTop: 15,
    marginBottom: 10,
    backgroundColor: "#E0E0E0",
    padding: 5
  },
  row: {
    flexDirection: "row",
    marginBottom: 5
  },
  label: {
    width: "40%",
    fontWeight: "bold"
  },
  value: {
    width: "60%"
  },
  table: {
    marginTop: 10,
    marginBottom: 10
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#4472C4",
    padding: 5,
    fontWeight: "bold",
    color: "white"
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#CCCCCC",
    padding: 5
  },
  tableCell: {
    flex: 1
  },
  tableCellLabel: {
    flex: 2
  },
  taxSection: {
    marginTop: 20,
    padding: 15,
    border: "2px solid #FF0000",
    backgroundColor: "#FFFACD"
  },
  taxTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#FF0000",
    marginBottom: 10,
    textAlign: "center"
  },
  earningsSection: {
    marginTop: 20,
    padding: 15,
    border: "2px solid #22C55E",
    backgroundColor: "#F0FDF4"
  },
  earningsTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#22C55E",
    marginBottom: 10,
    textAlign: "center"
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: "#666666"
  },
  spacer: {
    marginTop: 10
  }
};
async function exportToPDF(reportData, context) {
  const {
    Document,
    Page,
    pdf,
    StyleSheet,
    Text,
    View
  } = await import("@react-pdf/renderer");
  const styles = StyleSheet.create(styleDefinitions);
  const generatedAtLabel = formatInstant(parseInstant(context.generatedAt), context, "dateTimeMedium");
  const document = /* @__PURE__ */ jsx(Document, { children: /* @__PURE__ */ jsxs(Page, { size: "A4", style: styles.page, children: [
    /* @__PURE__ */ jsx(Text, { style: styles.title, children: "Employee Report" }),
    /* @__PURE__ */ jsx(Text, { style: styles.sectionHeader, children: "Employee Information" }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Name:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.employee.name })
    ] }),
    reportData.employee.employeeNumber && /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Employee Number:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.employee.employeeNumber })
    ] }),
    reportData.employee.position && /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Position:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.employee.position })
    ] }),
    reportData.employee.email && /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Email:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.employee.email })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Contract Type:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.employee.contractType === "hourly" ? "Hourly" : "Fixed" })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Report Period:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.period.label })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Generated On:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: generatedAtLabel })
    ] }),
    reportData.employee.customFields.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Text, { style: styles.sectionHeader, children: "Custom Fields" }),
      reportData.employee.customFields.map((field) => /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
        /* @__PURE__ */ jsxs(Text, { style: styles.label, children: [
          field.name,
          ":"
        ] }),
        /* @__PURE__ */ jsx(Text, { style: styles.value, children: customFieldReportText(field) || "\u2014" })
      ] }, field.fieldId))
    ] }),
    /* @__PURE__ */ jsx(Text, { style: styles.sectionHeader, children: "Work Hours Summary" }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Total Hours:" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        reportData.workHours.totalHours,
        "h"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Work Days:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.workHours.workDays })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Average Hours per Day:" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        reportData.workHours.averagePerDay,
        "h"
      ] })
    ] }),
    reportData.workHours.byMonth.size > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(View, { style: styles.spacer }),
      /* @__PURE__ */ jsx(Text, { style: {
        fontSize: 12,
        fontWeight: "bold",
        marginBottom: 5
      }, children: "Monthly Breakdown" }),
      /* @__PURE__ */ jsxs(View, { style: styles.table, children: [
        /* @__PURE__ */ jsxs(View, { style: styles.tableHeader, children: [
          /* @__PURE__ */ jsx(Text, { style: styles.tableCellLabel, children: "Month" }),
          /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: "Hours" }),
          /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: "Days" })
        ] }),
        Array.from(reportData.workHours.byMonth).map(([month, data]) => /* @__PURE__ */ jsxs(View, { style: styles.tableRow, children: [
          /* @__PURE__ */ jsx(Text, { style: styles.tableCellLabel, children: month }),
          /* @__PURE__ */ jsxs(Text, { style: styles.tableCell, children: [
            data.hours,
            "h"
          ] }),
          /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: data.days })
        ] }, month))
      ] })
    ] }),
    reportData.hourlyEarnings && /* @__PURE__ */ jsxs(View, { style: styles.earningsSection, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.earningsTitle, children: "EARNINGS SUMMARY (HOURLY TERMS)" }),
      /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
        /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Total Hours:" }),
        /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
          reportData.hourlyEarnings.totalHours,
          "h"
        ] })
      ] }),
      /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
        /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Total Earnings:" }),
        /* @__PURE__ */ jsx(Text, { style: styles.value, children: formatCurrency(reportData.hourlyEarnings.totalEarnings, reportData.hourlyEarnings.currency) })
      ] }),
      reportData.hourlyEarnings.byRatePeriod.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(View, { style: styles.spacer }),
        /* @__PURE__ */ jsx(Text, { style: {
          fontWeight: "bold",
          marginBottom: 5
        }, children: "Earnings by Rate Period:" }),
        /* @__PURE__ */ jsxs(View, { style: styles.table, children: [
          /* @__PURE__ */ jsxs(View, { style: styles.tableHeader, children: [
            /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: "Period" }),
            /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: "Rate" }),
            /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: "Hours" }),
            /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: "Earnings" })
          ] }),
          reportData.hourlyEarnings.byRatePeriod.map((period) => /* @__PURE__ */ jsxs(View, { style: styles.tableRow, children: [
            /* @__PURE__ */ jsxs(Text, { style: styles.tableCell, children: [
              period.periodStart,
              " - ",
              period.periodEnd
            ] }),
            /* @__PURE__ */ jsxs(Text, { style: styles.tableCell, children: [
              formatCurrency(period.rate, period.currency),
              "/h"
            ] }),
            /* @__PURE__ */ jsxs(Text, { style: styles.tableCell, children: [
              period.hours,
              "h"
            ] }),
            /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: formatCurrency(period.earnings, period.currency) })
          ] }, `${period.periodStart}-${period.periodEnd}-${period.rate}`))
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(Text, { style: styles.sectionHeader, children: "Absences Summary" }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Total Absence Days:" }),
      /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.absences.totalDays })
    ] }),
    /* @__PURE__ */ jsx(View, { style: styles.spacer }),
    /* @__PURE__ */ jsx(Text, { style: {
      fontWeight: "bold",
      marginBottom: 5
    }, children: "By Type:" }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Vacation (Approved):" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        reportData.absences.vacation.approved,
        " days"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Vacation (Pending):" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        reportData.absences.vacation.pending,
        " days"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Sick Leave (Approved):" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        reportData.absences.sick.approved,
        " days"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Sick Leave (Pending):" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        reportData.absences.sick.pending,
        " days"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.taxSection, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.taxTitle, children: "HOME OFFICE SUMMARY (TAX RELEVANT)" }),
      /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
        /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Total Home Office Days:" }),
        /* @__PURE__ */ jsx(Text, { style: styles.value, children: reportData.absences.homeOffice.days })
      ] }),
      /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
        /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Hours Worked from Home:" }),
        /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
          reportData.absences.homeOffice.hoursWorked,
          "h"
        ] })
      ] }),
      reportData.absences.homeOffice.dateDetails.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(View, { style: styles.spacer }),
        /* @__PURE__ */ jsx(Text, { style: {
          fontWeight: "bold",
          marginBottom: 5
        }, children: "Date-by-Date Breakdown:" }),
        /* @__PURE__ */ jsxs(View, { style: styles.table, children: [
          /* @__PURE__ */ jsxs(View, { style: styles.tableHeader, children: [
            /* @__PURE__ */ jsx(Text, { style: styles.tableCellLabel, children: "Date" }),
            /* @__PURE__ */ jsx(Text, { style: styles.tableCell, children: "Hours Worked" })
          ] }),
          reportData.absences.homeOffice.dateDetails.map((detail) => /* @__PURE__ */ jsxs(View, { style: styles.tableRow, children: [
            /* @__PURE__ */ jsx(Text, { style: styles.tableCellLabel, children: detail.date }),
            /* @__PURE__ */ jsxs(Text, { style: styles.tableCell, children: [
              detail.hours,
              "h"
            ] })
          ] }, detail.date))
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(Text, { style: styles.sectionHeader, children: "Compliance Metrics" }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Attendance Percentage:" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        reportData.complianceMetrics.attendancePercentage,
        "%"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Overtime:" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        Math.round(reportData.complianceMetrics.overtimeMinutes / 60 * 100) / 100,
        "h"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles.row, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.label, children: "Undertime:" }),
      /* @__PURE__ */ jsxs(Text, { style: styles.value, children: [
        Math.round(reportData.complianceMetrics.underTimeMinutes / 60 * 100) / 100,
        "h"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(Text, { style: styles.footer, children: [
      "Generated by Z8 Time Tracking | ",
      generatedAtLabel
    ] })
  ] }) });
  const blob = await pdf(document).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}
function generatePDFFilename(reportData) {
  const employeeName = reportData.employee.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const timestamp = Date.now();
  return `report-${employeeName}-${timestamp}.pdf`;
}
export {
  exportToPDF,
  generatePDFFilename
};
