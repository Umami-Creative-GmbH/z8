"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import {
	acknowledgeWorkPolicyViolation,
	getWorkPolicyViolations,
	type WorkPolicyViolationWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { queryKeys } from "@/lib/query";
import { AcknowledgementPanel } from "./work-policy-compliance/acknowledgement-panel";
import {
	WorkPolicyComplianceContent,
	WorkPolicyComplianceError,
	WorkPolicyComplianceLoading,
} from "./work-policy-compliance/content";
import { buildCsvContent, formatEmployeeName, getViolationTypeLabel } from "./work-policy-compliance/helpers";

interface WorkPolicyComplianceViewProps {
	organizationId: string;
}

export function WorkPolicyComplianceView({ organizationId }: WorkPolicyComplianceViewProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("30d");
	const [acknowledgeDialogOpen, setAcknowledgeDialogOpen] = useState(false);
	const [selectedViolation, setSelectedViolation] = useState<WorkPolicyViolationWithDetails | null>(
		null,
	);
	const [acknowledgeNote, setAcknowledgeNote] = useState("");

	const range = (() => {
		const endDt = DateTime.now();
		let days: number;
		switch (dateRange) {
			case "7d":
				days = 7;
				break;
			case "30d":
				days = 30;
				break;
			case "90d":
				days = 90;
				break;
			default:
				days = 30;
		}
		const startDt = endDt.minus({ days });
		return { start: startDt.toJSDate(), end: endDt.toJSDate() };
	})();

	const queryKey = queryKeys.workPolicies.violations.list(organizationId, range);
	const { data: violations, isLoading, error, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getWorkPolicyViolations(organizationId, range.start, range.end);
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
			acknowledgeWorkPolicyViolation(violationId, note),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.violationAcknowledged", "Violation acknowledged"));
				queryClient.invalidateQueries({ queryKey });
				resetAcknowledgement();
			} else {
				toast.error(
					result.error ||
						t("settings.workPolicies.acknowledgeFailed", "Failed to acknowledge violation"),
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
			t("settings.workPolicies.csv.date", "Date"),
			t("settings.workPolicies.csv.policy", "Policy"),
			t("settings.workPolicies.csv.violationType", "Violation Type"),
			t("settings.workPolicies.csv.status", "Status"),
			t("settings.workPolicies.csv.acknowledgedAt", "Acknowledged At"),
			t("settings.workPolicies.csv.acknowledgedNote", "Acknowledged Note"),
		];
		const unknownLabel = t("common.unknown", "Unknown");
		const acknowledgedLabel = t("settings.workPolicies.acknowledged", "Acknowledged");
		const pendingLabel = t("settings.workPolicies.pending", "Pending");
		const rows = violations.map((violation) => [
			formatEmployeeName(violation.employee, unknownLabel),
			DateTime.fromJSDate(violation.violationDate).toFormat("yyyy-MM-dd"),
			violation.policy?.name || unknownLabel,
			getViolationTypeLabel(violation.violationType, t),
			violation.acknowledgedAt ? acknowledgedLabel : pendingLabel,
			violation.acknowledgedAt
				? DateTime.fromJSDate(violation.acknowledgedAt).toFormat("yyyy-MM-dd HH:mm")
				: "",
			violation.acknowledgedNote || "",
		]);
		const csvContent = buildCsvContent(headers, rows);
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `policy-violations-${dateRange}-${DateTime.now().toFormat("yyyy-MM-dd")}.csv`;
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
				dateRange={dateRange}
				violations={violations}
				onDateRangeChange={setDateRange}
				onExport={handleExportCSV}
				onRefresh={() => refetch()}
				onAcknowledge={handleAcknowledgeClick}
			/>
			<AcknowledgementPanel
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
