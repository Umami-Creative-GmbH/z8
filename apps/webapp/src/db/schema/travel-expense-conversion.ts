import { sql } from "drizzle-orm";
import {
	check,
	date,
	decimal,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	ConversionBasis,
	ReferenceRateConversion,
} from "@/lib/travel-expenses/currency-conversion";
import { user } from "../auth-schema";
import {
	travelExpenseReport,
	travelExpenseReportItem,
	travelExpenseReportReceipt,
} from "./travel-expense";

// Conversion of a foreign-currency report item into the report's reimbursement
// currency (#607); at most one per item. The original amount and currency stay
// on the item. `card_charge` is the employee's actual charge in the
// reimbursement currency, evidenced by one of the item's own attachments
// (cleared when that file is removed). `manual_rate` is a documented rate an
// expense administrator authorized: `1 rate_base = rate rate_quote` for the
// item's currency pair in either direction, with its date, reason and
// evidence reference (0131); the authorizer is kept by value. The pair is recorded so a conversion never
// applies after the item's currency changed. `reference_rate` (#608) is stored
// only by a submission: the approved feed's publication it froze, with the
// expense date it was chosen for; drafts derive it on every read.
export const travelExpenseReportItemConversion = pgTable(
	"travel_expense_report_item_conversion",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		reportId: uuid("report_id").notNull(),
		itemId: uuid("item_id").notNull(),
		basis: text("basis").$type<ConversionBasis>().notNull(),
		sourceCurrency: text("source_currency").notNull(),
		targetCurrency: text("target_currency").notNull(),
		chargedAmount: decimal("charged_amount", { precision: 12, scale: 2 }),
		rate: decimal("rate", { precision: 22, scale: 10 }),
		rateBaseCurrency: text("rate_base_currency"),
		rateQuoteCurrency: text("rate_quote_currency"),
		rateDate: date("rate_date"),
		reason: text("reason"),
		// 0131: where a `manual_rate` can be verified (document, statement line,
		// reference); required for that basis only.
		rateEvidence: text("rate_evidence"),
		evidenceReceiptId: uuid("evidence_receipt_id"),
		authorizedByEmployeeId: uuid("authorized_by_employee_id"),
		authorizedByName: text("authorized_by_name"),
		authorizedAt: timestamp("authorized_at", { withTimezone: true }),
		// #608: the publication a `reference_rate` conversion froze at submission.
		referenceSource: jsonb("reference_source").$type<ReferenceRateConversion["source"]>(),
		referenceExpenseDate: date("reference_expense_date"),
		recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_report_item_conversion_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_report_item_conversion_item_fk",
			columns: [table.itemId, table.organizationId],
			foreignColumns: [travelExpenseReportItem.id, travelExpenseReportItem.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_report_item_conversion_evidence_fk",
			columns: [table.evidenceReceiptId],
			foreignColumns: [travelExpenseReportReceipt.id],
		}).onDelete("set null"),
		uniqueIndex("travelExpenseReportItemConversion_item_idx").on(table.itemId),
		index("travelExpenseReportItemConversion_report_idx").on(table.reportId),
		check(
			"travel_expense_report_item_conversion_pair_check",
			sql`${table.sourceCurrency} ~ '^[A-Z]{3}$' AND ${table.targetCurrency} ~ '^[A-Z]{3}$'
			AND ${table.sourceCurrency} <> ${table.targetCurrency}`,
		),
		check(
			"travel_expense_report_item_conversion_basis_check",
			sql`(${table.basis} = 'card_charge' AND ${table.chargedAmount} IS NOT NULL
				AND ${table.chargedAmount} > 0 AND ${table.rate} IS NULL
				AND ${table.rateBaseCurrency} IS NULL AND ${table.rateQuoteCurrency} IS NULL
				AND ${table.rateDate} IS NULL AND ${table.reason} IS NULL
				AND ${table.authorizedByEmployeeId} IS NULL AND ${table.authorizedByName} IS NULL
				AND ${table.authorizedAt} IS NULL)
			OR (${table.basis} = 'manual_rate' AND ${table.chargedAmount} IS NULL
				AND ${table.rate} IS NOT NULL AND ${table.rate} > 0
				AND ((${table.rateBaseCurrency} = ${table.sourceCurrency}
						AND ${table.rateQuoteCurrency} = ${table.targetCurrency})
					OR (${table.rateBaseCurrency} = ${table.targetCurrency}
						AND ${table.rateQuoteCurrency} = ${table.sourceCurrency}))
				AND ${table.rateDate} IS NOT NULL AND ${table.reason} IS NOT NULL
				AND length(btrim(${table.reason})) > 0 AND ${table.evidenceReceiptId} IS NULL
				AND ${table.authorizedByEmployeeId} IS NOT NULL AND ${table.authorizedByName} IS NOT NULL
				AND ${table.authorizedAt} IS NOT NULL)
			OR (${table.basis} = 'reference_rate' AND ${table.chargedAmount} IS NULL
				AND ${table.rate} IS NOT NULL AND ${table.rate} > 0
				AND ((${table.rateBaseCurrency} = ${table.sourceCurrency}
						AND ${table.rateQuoteCurrency} = ${table.targetCurrency})
					OR (${table.rateBaseCurrency} = ${table.targetCurrency}
						AND ${table.rateQuoteCurrency} = ${table.sourceCurrency}))
				AND ${table.rateDate} IS NOT NULL AND ${table.referenceExpenseDate} IS NOT NULL
				AND ${table.rateDate} <= ${table.referenceExpenseDate}
				AND ${table.referenceSource} IS NOT NULL AND ${table.reason} IS NULL
				AND ${table.evidenceReceiptId} IS NULL AND ${table.authorizedByEmployeeId} IS NULL
				AND ${table.authorizedByName} IS NULL AND ${table.authorizedAt} IS NULL)`,
		),
		check(
			"travel_expense_report_item_conversion_rate_evidence_check",
			sql`(${table.basis} = 'manual_rate') = (${table.rateEvidence} IS NOT NULL)
				AND (${table.rateEvidence} IS NULL
					OR char_length(btrim(${table.rateEvidence})) BETWEEN 1 AND 2000)`,
		),
		check(
			"travel_expense_report_item_conversion_reference_check",
			sql`(${table.basis} = 'reference_rate') = (${table.referenceSource} IS NOT NULL)
				AND (${table.basis} = 'reference_rate') = (${table.referenceExpenseDate} IS NOT NULL)`,
		),
	],
);
