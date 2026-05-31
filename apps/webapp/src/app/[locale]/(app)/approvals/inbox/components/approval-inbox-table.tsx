"use client";

import {
	IconAlertTriangle,
	IconCalendarOff,
	IconClockEdit,
	IconReceipt,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UserAvatar } from "@/components/user-avatar";
import type { ApprovalInboxItem, ApprovalInboxType } from "@/lib/approvals/inbox/types";
import { useEmployeeClockStatuses } from "@/lib/query";
import { cn } from "@/lib/utils";

interface ApprovalInboxTableProps {
	items: ApprovalInboxItem[];
	selectedIds: Set<string>;
	onSelectItem: (id: string, checked: boolean) => void;
	onRowClick: (item: ApprovalInboxItem) => void;
	isFetching: boolean;
}

const TYPE_ICONS: Record<ApprovalInboxType, React.ComponentType<{ className?: string }>> = {
	absence_entry: IconCalendarOff,
	time_entry: IconClockEdit,
	travel_expense_claim: IconReceipt,
};

const TYPE_LABELS: Record<ApprovalInboxType, string> = {
	absence_entry: "Absence Requests",
	time_entry: "Time Corrections",
	travel_expense_claim: "Travel Expenses",
};

const RISK_BADGE_VARIANTS: Record<
	ApprovalInboxItem["triage"]["riskLevel"],
	"destructive" | "outline" | "secondary"
> = {
	low: "secondary",
	medium: "outline",
	high: "destructive",
};

function getAgeLabel(t: ReturnType<typeof useTranslate>["t"], ageDays: number): string {
	if (ageDays <= 0) {
		return t("approvals:approvals.requestedToday", "Today");
	}

	return t(
		"approvals:approvals.requestAgeDays",
		ageDays === 1 ? "1 day" : `${ageDays} days`,
		{ count: ageDays },
	);
}

export function ApprovalInboxTable({
	items,
	selectedIds,
	onSelectItem,
	onRowClick,
	isFetching,
}: ApprovalInboxTableProps) {
	const { t } = useTranslate();
	const ariaLabel = t("approvals:approvals.selectRow", "Select row");
	const presence = useEmployeeClockStatuses(
		items.map((item) => item.requester.id),
		{ polling: false },
	);

	return (
		<div className="overflow-hidden rounded-md border bg-card">
			{items.length === 0 ? (
				<div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
					<p className="font-medium text-sm">{t("approvals:approvals.noRequests", "No pending requests")}</p>
					<p className="max-w-sm text-muted-foreground text-sm">
						{t(
							"approvals:approvals.noRequestsDescription",
							"New approval requests will appear here when they need manager review.",
						)}
					</p>
				</div>
			) : (
				<div className="divide-y">
					{items.map((item) => {
						const TypeIcon = TYPE_ICONS[item.type];
						const isSelected = selectedIds.has(item.id);
						const isHighRisk = item.triage.riskLevel === "high";

						return (
							<div
								key={item.id}
								className={cn(
									"grid w-full grid-cols-[2.25rem_minmax(0,1fr)] gap-4 px-4 py-4 transition-colors hover:bg-muted/40 md:items-center",
									isSelected && "bg-muted/30",
									isFetching && "opacity-70",
								)}
							>
								<div className="flex items-start md:items-center">
									<Checkbox
										checked={isSelected}
										onCheckedChange={(checked) => onSelectItem(item.id, !!checked)}
										onClick={(event) => event.stopPropagation()}
										aria-label={ariaLabel}
									/>
								</div>

								<button
									type="button"
									onClick={() => onRowClick(item)}
									className="grid min-w-0 gap-4 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:grid-cols-[minmax(12rem,1.1fr)_minmax(12rem,1.4fr)_8rem] md:items-center"
									aria-label={t(
										"approvals:approvals.openDetailsFor",
										`Open details for ${item.summary.title}`,
									)}
								>
									<div className="flex min-w-0 items-center gap-3">
										<UserAvatar
											image={item.requester.image}
											seed={item.requester.id}
											name={item.requester.name}
											size="sm"
											clockStatus={presence.getStatus(item.requester.id)}
										/>
										<div className="min-w-0">
											<div className="truncate font-medium text-sm">{item.requester.name}</div>
											<div className="truncate text-muted-foreground text-xs">
												{item.requester.email}
											</div>
										</div>
									</div>

									<div className="min-w-0 space-y-2">
										<div className="flex flex-wrap items-center gap-2">
											<span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-muted-foreground text-xs">
												<TypeIcon className="size-3.5" aria-hidden="true" />
												{t(`approvals:approvals.types.${item.type}`, TYPE_LABELS[item.type])}
											</span>
											<Badge variant={RISK_BADGE_VARIANTS[item.triage.riskLevel]}>
												{isHighRisk && <IconAlertTriangle className="mr-1 size-3" aria-hidden="true" />}
												{t(
													`approvals:approvals.risk.${item.triage.riskLevel}`,
													`${item.triage.riskLevel} risk`,
												)}
											</Badge>
										</div>
										<div>
											<div className="truncate font-medium text-sm">{item.summary.title}</div>
											<div className="truncate text-muted-foreground text-sm">
												{item.summary.detail}
											</div>
										</div>
										<p className="text-muted-foreground text-xs leading-5">{item.triage.explanation}</p>
									</div>

									<div className="text-muted-foreground text-sm md:text-right">
										{getAgeLabel(t, item.timing.ageDays)}
									</div>
								</button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
