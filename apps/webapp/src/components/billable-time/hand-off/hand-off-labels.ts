"use client";

import { useTranslate } from "@tolgee/react";
import { useDisplayContext } from "@/hooks/use-display-context";
import { formatBillableDay, formatBillableHours } from "@/lib/billable-time/format";
import type { TimesheetLabels } from "@/lib/billable-time/hand-off/timesheet-document";
import type {
	ChangedField,
	HandOffBlockerView,
	InvoiceDraftStatusView,
} from "@/lib/billable-time/hand-off/views";

/** The hand-off area's labels in the viewer's language (#903). */
export function useHandOffLabels() {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();

	/** An employee-local day or period bound (`YYYY-MM-DD`), never shifted by a time zone. */
	const day = (value: string): string => formatBillableDay(locale, value);

	const period = (value: { from: string; to: string }): string =>
		t("settings.billableTime.handOff.period", "{from} – {to}", {
			from: day(value.from),
			to: day(value.to),
		});

	/** Two-decimal hours (`12.50`) in the viewer's locale, without a unit. */
	const hours = (value: string): string => formatBillableHours(locale, value, 2);

	const hoursWithUnit = (value: string): string =>
		t("settings.billableTime.handOff.hoursValue", "{hours} h", { hours: hours(value) });

	const blocker = (value: HandOffBlockerView): string => {
		switch (value.kind) {
			case "billable_time_off":
				return t("settings.billableTime.handOff.blocker.off", "Billable Time is switched off.");
			case "not_connected":
				return t(
					"settings.billableTime.handOff.blocker.notConnected",
					"Connect an accounting tool on the Accounting page first.",
				);
			case "provider_unavailable":
				return t(
					"settings.billableTime.handOff.blocker.providerUnavailable",
					"The connected accounting tool is not available in this installation.",
				);
			case "no_contact_link":
				return t(
					"settings.billableTime.handOff.blocker.noContactLink",
					"Link this customer to a contact in the accounting tool on the Accounting page first.",
				);
			case "unpriced_work":
				return t(
					"settings.billableTime.handOff.blocker.unpriced",
					"{count, plural, one {# work period has} other {# work periods have}} no billable rate. Add a rate before handing off.",
					{ count: value.count },
				);
			case "nothing_to_hand_off":
				return t(
					"settings.billableTime.handOff.blocker.nothing",
					"There is no un-invoiced billable work to hand off in this period.",
				);
			case "too_many_lines":
				return t(
					"settings.billableTime.handOff.blocker.tooManyWorkLines",
					"The draft would have {lines} work lines; the accounting tool takes at most {max}. Choose fewer projects or a shorter period.",
					{ lines: value.lines, max: value.maxDraftLines },
				);
			case "currency_not_supported":
				return t(
					"settings.billableTime.handOff.blocker.currency",
					"The accounting tool cannot take drafts in {currency}.",
					{ currency: value.currency },
				);
			case "tax_treatment_not_supported":
				return t(
					"settings.billableTime.handOff.blocker.taxTreatment",
					"The accounting tool cannot take this customer's tax treatment.",
				);
		}
	};

	const changedField = (field: ChangedField): string => {
		switch (field) {
			case "times":
				return t("settings.billableTime.handOff.changed.times", "Times");
			case "project":
				return t("settings.billableTime.handOff.changed.project", "Project");
			case "billability":
				return t("settings.billableTime.handOff.changed.billability", "Billability");
			case "removed":
				return t("settings.billableTime.handOff.changed.removed", "Deleted");
			case "split":
				return t("settings.billableTime.handOff.changed.split", "Split");
		}
	};

	const status = (value: InvoiceDraftStatusView): string => {
		switch (value) {
			case "pending":
				return t("settings.billableTime.handOff.status.pending", "Waiting for the tool");
			case "created":
				return t("settings.billableTime.handOff.status.created", "Draft created");
			case "failed":
				return t("settings.billableTime.handOff.status.failed", "Failed");
			case "released":
				return t("settings.billableTime.handOff.status.released", "Released");
		}
	};

	const timesheet: TimesheetLabels = {
		title: t("settings.billableTime.handOff.timesheet.title", "Timesheet"),
		customer: t("settings.billableTime.handOff.timesheet.customer", "Customer"),
		period: t("settings.billableTime.handOff.timesheet.period", "Period"),
		generatedAt: t("settings.billableTime.handOff.timesheet.generatedAt", "Generated on"),
		table: t("settings.billableTime.handOff.timesheet.table", "Work"),
		date: t("settings.billableTime.handOff.timesheet.date", "Date"),
		employee: t("settings.billableTime.handOff.timesheet.employee", "Employee"),
		project: t("settings.billableTime.handOff.timesheet.project", "Project"),
		start: t("settings.billableTime.handOff.timesheet.start", "Start"),
		end: t("settings.billableTime.handOff.timesheet.end", "End"),
		hours: t("settings.billableTime.handOff.timesheet.hours", "Hours"),
		total: t("settings.billableTime.handOff.timesheet.total", "Total"),
		note: t(
			"settings.billableTime.handOff.timesheet.note",
			"Times are local to where the work was recorded. Hours are rounded to two decimals per work period.",
		),
		footer: t("settings.billableTime.handOff.timesheet.footer", "Generated by Z8"),
	};

	return { blocker, changedField, status, timesheet, day, period, hours, hoursWithUnit };
}
