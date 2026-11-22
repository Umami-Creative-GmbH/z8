"use client";

import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	getDeputyCandidates,
	getDeputyDecisionCapability,
} from "@/app/[locale]/(app)/absences/deputy-actions";
import { EmployeeSingleSelect, toSelectableEmployee } from "@/components/employee-select";
import type { DeputyRefusal, PlainDateSpan } from "@/lib/absences/deputy";
import { useSession } from "@/lib/auth-client";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	actionMessageText,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query/keys";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The deputy refusals' texts (#1011), an override map for `actionErrorMessage`. */
const DEPUTY_REFUSALS = {
	deputy_required: [
		"absences.deputy.errors.required",
		"Choose a deputy: this absence type requires one.",
	],
	deputy_is_absent_employee: [
		"absences.deputy.errors.self",
		"An employee cannot be their own deputy.",
	],
	deputy_unavailable: [
		"absences.deputy.errors.unavailable",
		"The deputy must be an active employee of this organization.",
	],
} satisfies RefusalMessages<DeputyRefusal>;

/**
 * The deputy field's error for a server refusal code (#1011, the failed
 * result's `refusal`), or null for any other failure, which the form shows
 * elsewhere.
 */
export function deputyRefusalText(t: Translate, refusal: string | undefined): string | null {
	return refusal !== undefined && Object.hasOwn(DEPUTY_REFUSALS, refusal)
		? actionErrorMessage(t, { refusal }, DEPUTY_REFUSALS)
		: null;
}

export function deputyRequiredText(t: Translate): string {
	return actionMessageText(t, DEPUTY_REFUSALS.deputy_required);
}

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
	const { data: session } = useSession();
	const organizationId = session?.session?.activeOrganizationId ?? "";
	const range =
		isPlainDate(startDate) && isPlainDate(endDate || startDate)
			? { startDate, endDate: endDate || startDate }
			: null;
	const input = {
		...(range ?? {}),
		...(employeeId ? { employeeId } : {}),
	};
	const candidatesQuery = useQuery({
		queryKey: queryKeys.absenceDeputies.candidates(organizationId, input),
		queryFn: async () => {
			const result = await getDeputyCandidates(input);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const capabilityQuery = useQuery({
		queryKey: queryKeys.absenceDeputies.capability(organizationId, {
			deputyEmployeeId: value,
			...(employeeId ? { employeeId } : {}),
		}),
		queryFn: async () => {
			const result = await getDeputyDecisionCapability({
				deputyEmployeeId: value,
				...(employeeId ? { employeeId } : {}),
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: Boolean(value),
	});
	const candidates = candidatesQuery.data ?? [];
	const picked = candidates.find((candidate) => candidate.id === value);
	const selectableCandidates = candidates.map((candidate) =>
		toSelectableEmployee({
			id: candidate.id,
			name: candidate.name,
			secondaryText:
				candidate.awayPeriods.length > 0
					? t("absences.deputy.away", "Away {dates}", {
							dates: formatAway(candidate.awayPeriods, locale),
						})
					: null,
		}),
	);

	return (
		<div className="space-y-2">
			<EmployeeSingleSelect
				id={id}
				className="space-y-0"
				value={value || null}
				onChange={(next) => onChange(next ?? "")}
				onBlur={onBlur}
				disabled={disabled || candidatesQuery.isLoading}
				aria-invalid={ariaInvalid}
				aria-label={t("absences.deputy.label", "Deputy")}
				placeholder={
					required
						? t("absences.deputy.placeholder", "Select a deputy…")
						: t("absences.deputy.none", "No deputy")
				}
				allowClear={!required}
				clearLabel={t("absences.deputy.none", "No deputy")}
				employees={selectableCandidates}
			/>
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
