"use client";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { withdrawAbsenceChangeAction } from "@/app/[locale]/(app)/absences/change-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAbsenceChangeRange } from "@/lib/absences/change-request-coverage";
import type { AbsenceChangeSummary } from "@/lib/absences/change-request-types";

const STATUS_COPY = {
	pending: {
		key: "absences.change.status.pending",
		fallback: "Pending approval",
	},
	approved: { key: "absences.change.status.approved", fallback: "Approved" },
	rejected: { key: "absences.change.status.rejected", fallback: "Rejected" },
	withdrawn: { key: "absences.change.status.withdrawn", fallback: "Withdrawn" },
	obsolete: {
		key: "absences.change.status.obsolete",
		fallback: "Obsolete — submit a fresh request",
	},
	expired: { key: "absences.change.status.expired", fallback: "Expired" },
};
export function AbsenceChangeHistory({
	requests,
	onChanged,
}: {
	requests: AbsenceChangeSummary[];
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const period = (value: "am" | "pm" | "full_day") =>
		value === "am"
			? t("absences.change.morning", "Morning")
			: value === "pm"
				? t("absences.change.afternoon", "Afternoon")
				: t("absences.change.fullDay", "Full day");
	const dates = (
		range: AbsenceChangeSummary["original"] | NonNullable<AbsenceChangeSummary["proposed"]>,
	) => formatAbsenceChangeRange(range, locale, period);
	const [withdrawing, setWithdrawing] = useState<string | null>(null);
	async function withdraw(id: string) {
		setWithdrawing(id);
		const result = await withdrawAbsenceChangeAction(id).catch(() => ({
			success: false as const,
			error: null,
		}));
		setWithdrawing(null);
		if (result.success) {
			onChanged();
			toast.success(t("absences.change.withdrawn", "Request withdrawn"));
		} else
			toast.error(
				result.error ??
					t("absences.change.withdrawFailed", "Could not withdraw the request. Please try again."),
			);
	}
	return (
		<details
			className="rounded-lg border p-4"
			open={requests.some((request) => request.status === "pending")}
		>
			<summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-ring">
				{t("absences.change.history", "Absence change requests")}
			</summary>
			<ul className="mt-4 space-y-4">
				{requests.map((request) => (
					<li
						key={request.id}
						className="flex flex-wrap items-start justify-between gap-3 border-t pt-3"
					>
						<div className="min-w-0 flex-1 space-y-1 text-sm">
							<Badge variant="secondary">
								{t(STATUS_COPY[request.status].key, STATUS_COPY[request.status].fallback)}
							</Badge>
							<p>
								{dates(request.original)} →{" "}
								{request.proposed
									? dates(request.proposed)
									: t("absences.change.cancelAll", "Cancel entire absence")}
							</p>
							<p className="whitespace-pre-wrap break-words">{request.reason}</p>
							{request.deciderName ? (
								<p className="text-muted-foreground">
									{t("absences.change.reviewedBy", "Reviewed by {name}", {
										name: request.deciderName,
									})}
								</p>
							) : null}
							{request.decisionReason ? (
								<p className="text-muted-foreground">{request.decisionReason}</p>
							) : null}
						</div>
						{request.status === "pending" ? (
							<Button
								variant="outline"
								size="sm"
								disabled={withdrawing !== null}
								onClick={() => void withdraw(request.id)}
							>
								{t("absences.change.withdraw", "Withdraw request")}
							</Button>
						) : null}
					</li>
				))}
			</ul>
		</details>
	);
}
