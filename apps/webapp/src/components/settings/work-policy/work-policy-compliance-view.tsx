"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	acknowledgeWorkPolicyViolation,
	getWorkPolicyViolations,
	type WorkPolicyViolationWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { AcknowledgementPanel } from "./work-policy-compliance/acknowledgement-panel";
import {
	WorkPolicyComplianceContent,
	WorkPolicyComplianceError,
	WorkPolicyComplianceLoading,
} from "./work-policy-compliance/content";
import {
	buildCsvContent,
	formatCsvLocalMinute,
	formatEmployeeName,
	formatViolationCsvDate,
	getViolationTypeLabel,
	type ViolationDisplayContext,
} from "./work-policy-compliance/helpers";

interface WorkPolicyComplianceViewProps {
	organizationId: string;
	/** The organization's IANA timezone; violation instants are shown in it. */
	organizationTimezone: string;
}

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

export function WorkPolicyComplianceView({
	organizationId,
	organizationTimezone,
}: WorkPolicyComplianceViewProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const display: ViolationDisplayContext = { locale, timezone: organizationTimezone };
	const queryClient = useQueryClient();
	const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("30d");
	const [acknowledgeDialogOpen, setAcknowledgeDialogOpen] = useState(false);
	const [selectedViolation, setSelectedViolation] = useState<WorkPolicyViolationWithDetails | null>(
		null,
	);
	const [acknowledgeNote, setAcknowledgeNote] = useState("");
	// The range ends when it was chosen, not at every render: a moving end would change
	// the query key on each render and refetch without end.
	const [rangeEndMillis, setRangeEndMillis] = useState(
		() => systemClock.nowInstant().epochMilliseconds,
	);

	const handleDateRangeChange = (nextRange: "7d" | "30d" | "90d") => {
		setDateRange(nextRange);
		setRangeEndMillis(systemClock.nowInstant().epochMilliseconds);
	};

	const range = (() => {
		const end = Temporal.Instant.fromEpochMilliseconds(rangeEndMillis);
		// Calendar days back in the organization's zone, so a DST change keeps whole days.
		const start = end
			.toZonedDateTimeISO(organizationTimezone)
			.subtract({ days: RANGE_DAYS[dateRange] ?? 30 })
			.toInstant();
		return { start: dateFromInstant(start), end: dateFromInstant(end) };
	})();

	const queryKey = queryKeys.workPolicies.violations.list(organizationId, range);
	const { data: violations, isLoading, error, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getWorkPolicyViolations({ startDate: range.start, endDate: range.end });
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch violations");
			}
			return result.data;
		},
		staleTime: 30 * 1000,
		refetchOnWindowFocus: false,
	});

	const resetAcknowledgement = () => {
		setAcknowledgeDialogOpen(false);
		setSelectedViolation(null);
		setAcknowledgeNote("");
	};

	const acknowledgeMutation = useMutation({
		mutationFn: ({ violationId, note }: { violationId: string; note?: string }) =>
			acknowledgeWorkPolicyViolation({ violationId, note }),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.violationAcknowledged", "Violation acknowledged"));
				queryClient.invalidateQueries({ queryKey });
				resetAcknowledgement();
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.workPolicies.acknowledgeFailed",
						"Failed to acknowledge violation",
					]),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.acknowledgeFailed", "Failed to acknowledge violation"));
		},
	});

	const handleAcknowledgeClick = (violation: WorkPolicyViolationWithDetails) => {
		setSelectedViolation(violation);
		setAcknowledgeNote("");
		setAcknowledgeDialogOpen(true);
	};

	const handleAcknowledgeConfirm = () => {
		if (selectedViolation) {
			acknowledgeMutation.mutate({
				violationId: selectedViolation.id,
				note: acknowledgeNote || undefined,
			});
		}
	};

	const handleExportCSV = () => {
		if (!violations || violations.length === 0) {
			toast.error(t("settings.workPolicies.noDataToExport", "No data to export"));
			return;
		}

		const headers = [
			t("settings.workPolicies.csv.employee", "Employee"),
			t("settings.workPolicies.csv.dateInTimezone", "Date ({timezone})", {
				timezone: organizationTimezone,
			}),
			t("settings.workPolicies.csv.policy", "Policy"),
			t("settings.workPolicies.csv.violationType", "Violation Type"),
			t("settings.workPolicies.csv.status", "Status"),
			t("settings.workPolicies.csv.acknowledgedAtInTimezone", "Acknowledged At ({timezone})", {
				timezone: organizationTimezone,
			}),
			t("settings.workPolicies.csv.acknowledgedNote", "Acknowledged Note"),
		];
		const unknownLabel = t("common.unknown", "Unknown");
		const acknowledgedLabel = t("settings.workPolicies.acknowledged", "Acknowledged");
		const pendingLabel = t("settings.workPolicies.pending", "Pending");
		const rows = violations.map((violation) => [
			formatEmployeeName(violation.employee, unknownLabel),
			formatViolationCsvDate(violation.violationDate, organizationTimezone),
			violation.policy?.name || unknownLabel,
			getViolationTypeLabel(violation.violationType, t),
			violation.acknowledgedAt ? acknowledgedLabel : pendingLabel,
			violation.acknowledgedAt
				? formatCsvLocalMinute(violation.acknowledgedAt, organizationTimezone)
				: "",
			violation.acknowledgedNote || "",
		]);
		const csvContent = buildCsvContent(headers, rows);
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		const exportDay = systemClock
			.nowInstant()
			.toZonedDateTimeISO(organizationTimezone)
			.toPlainDate()
			.toString();
		link.href = url;
		link.download = `policy-violations-${dateRange}-${exportDay}.csv`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);

		toast.success(t("settings.workPolicies.exportSuccess", "Violations exported successfully"));
	};

	if (isLoading) {
		return <WorkPolicyComplianceLoading />;
	}

	if (error) {
		return <WorkPolicyComplianceError onRetry={() => refetch()} />;
	}

	return (
		<>
			<WorkPolicyComplianceContent
				display={display}
				dateRange={dateRange}
				violations={violations}
				onDateRangeChange={handleDateRangeChange}
				onExport={handleExportCSV}
				onRefresh={() => {
					// Move the range end to now so violations recorded since the range was chosen appear.
					setRangeEndMillis(systemClock.nowInstant().epochMilliseconds);
				}}
				onAcknowledge={handleAcknowledgeClick}
			/>
			<AcknowledgementPanel
				display={display}
				open={acknowledgeDialogOpen}
				violation={selectedViolation}
				note={acknowledgeNote}
				onOpenChange={setAcknowledgeDialogOpen}
				onNoteChange={setAcknowledgeNote}
				onCancel={resetAcknowledgement}
				onConfirm={handleAcknowledgeConfirm}
				isPending={acknowledgeMutation.isPending}
			/>
		</>
	);
}
