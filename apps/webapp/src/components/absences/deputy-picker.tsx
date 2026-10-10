"use client";

import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	getDeputyCandidates,
	getDeputyDecisionCapability,
} from "@/app/[locale]/(app)/absences/deputy-actions";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DEPUTY_REFUSAL_MESSAGES, type PlainDateSpan } from "@/lib/absences/deputy";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query/keys";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The deputy field's error for a server refusal (#1011), or null for any other error. */
export function deputyRefusalText(t: Translate, message: string | undefined): string | null {
	switch (message) {
		case DEPUTY_REFUSAL_MESSAGES.deputy_required:
			return deputyRequiredText(t);
		case DEPUTY_REFUSAL_MESSAGES.deputy_is_absent_employee:
			return t("absences.deputy.errors.self", "An employee cannot be their own deputy.");
		case DEPUTY_REFUSAL_MESSAGES.deputy_unavailable:
			return t(
				"absences.deputy.errors.unavailable",
				"The deputy must be an active employee of this organization.",
			);
		default:
			return null;
	}
}

export function deputyRequiredText(t: Translate): string {
	return t("absences.deputy.errors.required", "Choose a deputy: this absence type requires one.");
}

/** The select's value for "no deputy"; a Radix item cannot have an empty value. */
const NO_DEPUTY = "__no-deputy";

export interface DeputyPickerProps {
	/** The picked deputy's employee id, or "" for none. */
	value: string;
	onChange: (deputyEmployeeId: string) => void;
	onBlur?: () => void;
	/** The requested dates; colleagues away during them are marked. */
	startDate?: string;
	endDate?: string;
	/** Whose absence it is, when a manager or admin records it for them. */
	employeeId?: string;
	/** The absence type requires a deputy: "No deputy" is not offered. */
	required: boolean;
	disabled?: boolean;
	id?: string;
	"aria-invalid"?: boolean;
}

function isPlainDate(value: string | undefined): value is string {
	return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function formatAway(periods: PlainDateSpan[], locale: string): string {
	return periods
		.map((period) =>
			formatPlainDateRange(
				parsePlainDate(period.startDate),
				parsePlainDate(period.endDate),
				locale,
				"monthDay",
			),
		)
		.join(", ");
}

/**
 * Picks the colleague who covers during an absence (#1011). Colleagues away
 * themselves during the requested dates are marked and warned about, but can
 * still be picked; a deputy who cannot use the approval inbox is noted as a
 * contact only.
 */
export function DeputyPicker({
	value,
	onChange,
	onBlur,
	startDate,
	endDate,
	employeeId,
	required,
	disabled,
	id,
	"aria-invalid": ariaInvalid,
}: DeputyPickerProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const range =
		isPlainDate(startDate) && isPlainDate(endDate || startDate)
			? { startDate, endDate: endDate || startDate }
			: null;
	const input = {
		...(range ?? {}),
		...(employeeId ? { employeeId } : {}),
	};
	const candidatesQuery = useQuery({
		queryKey: queryKeys.absenceDeputies.candidates(input),
		queryFn: async () => {
			const result = await getDeputyCandidates(input);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const capabilityQuery = useQuery({
		queryKey: queryKeys.absenceDeputies.capability(value),
		queryFn: async () => {
			const result = await getDeputyDecisionCapability(value);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: Boolean(value),
	});
	const candidates = candidatesQuery.data ?? [];
	const picked = candidates.find((candidate) => candidate.id === value);

	const optionLabel = (candidate: (typeof candidates)[number]) =>
		candidate.awayPeriods.length > 0
			? t("absences.deputy.awayOption", "{name} · Away {dates}", {
					name: candidate.name,
					dates: formatAway(candidate.awayPeriods, locale),
				})
			: candidate.name;

	return (
		<div className="space-y-2">
			<Select
				value={value || (required ? "" : NO_DEPUTY)}
				onValueChange={(next) => onChange(!next || next === NO_DEPUTY ? "" : next)}
				disabled={disabled || candidatesQuery.isLoading}
			>
				<SelectTrigger
					id={id}
					className="w-full"
					onBlur={onBlur}
					aria-invalid={ariaInvalid}
					aria-label={t("absences.deputy.label", "Deputy")}
				>
					<SelectValue placeholder={t("absences.deputy.placeholder", "Select a deputy…")} />
				</SelectTrigger>
				<SelectContent>
					{!required && (
						<SelectItem value={NO_DEPUTY} label={t("absences.deputy.none", "No deputy")}>
							{t("absences.deputy.none", "No deputy")}
						</SelectItem>
					)}
					{candidates.map((candidate) => (
						<SelectItem key={candidate.id} value={candidate.id} label={optionLabel(candidate)}>
							<span>{candidate.name}</span>
							{candidate.awayPeriods.length > 0 && (
								<span className="text-muted-foreground text-xs">
									{t("absences.deputy.away", "Away {dates}", {
										dates: formatAway(candidate.awayPeriods, locale),
									})}
								</span>
							)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{picked && picked.awayPeriods.length > 0 && (
				<p
					role="status"
					className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"
				>
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					{t(
						"absences.deputy.awayWarning",
						"{name} is away during these dates. You can still choose them.",
						{ name: picked.name },
					)}
				</p>
			)}
			{picked && capabilityQuery.data?.canDecideApprovals === false && (
				<p role="status" className="flex items-start gap-2 text-muted-foreground text-sm">
					<IconInfoCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					{t(
						"absences.deputy.contactOnly",
						"{name} will be shown as a contact only and cannot decide approvals.",
						{ name: picked.name },
					)}
				</p>
			)}
		</div>
	);
}
