"use client";

import { useMemo, useCallback, useRef } from "react";
import {
	IconCalendarOff,
	IconClockEdit,
	IconExchange,
	IconAlertTriangle,
	IconClock,
} from "@tabler/icons-react";
import type { ColumnDef, CellContext } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { formatRelative } from "@/lib/datetime/luxon-utils";
import { DataTable } from "@/components/data-table-server";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import type { ApprovalPriority, ApprovalType, SLAStatus, UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { cn } from "@/lib/utils";

interface ApprovalInboxTableProps {
	items: UnifiedApprovalItem[];
	selectedIds: Set<string>;
	onSelectItem: (id: string, checked: boolean) => void;
	onRowClick: (item: UnifiedApprovalItem) => void;
	isFetching: boolean;
}

// Icon mapping for approval types
const TYPE_ICONS: Record<ApprovalType, React.ComponentType<{ className?: string }>> = {
	absence_entry: IconCalendarOff,
	time_entry: IconClockEdit,
	shift_request: IconExchange,
};

// Priority badge variants
const PRIORITY_VARIANTS: Record<ApprovalPriority, "destructive" | "outline" | "default" | "secondary"> = {
	urgent: "destructive",
	high: "outline",
	normal: "default",
	low: "secondary",
};

// SLA status colors
function getSLAStatusColor(status: SLAStatus): string {
	switch (status) {
		case "overdue":
			return "text-destructive";
		case "approaching":
			return "text-amber-500";
		case "on_time":
			return "text-muted-foreground";
	}
}

// Selection cell component that reads from refs to avoid column recreation
function SelectionCell({
	row,
	selectedIdsRef,
	onSelectItemRef,
	ariaLabel,
}: {
	row: CellContext<UnifiedApprovalItem, unknown>["row"];
	selectedIdsRef: React.RefObject<Set<string>>;
	onSelectItemRef: React.RefObject<(id: string, checked: boolean) => void>;
	ariaLabel: string;
}) {
	return (
		<Checkbox
			checked={selectedIdsRef.current?.has(row.original.id) ?? false}
			onCheckedChange={(checked) => onSelectItemRef.current?.(row.original.id, !!checked)}
			onClick={(e) => e.stopPropagation()}
			aria-label={ariaLabel}
		/>
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

	// Use refs to avoid column recreation when these values change
	const selectedIdsRef = useRef(selectedIds);
	selectedIdsRef.current = selectedIds;
	const onSelectItemRef = useRef(onSelectItem);
	onSelectItemRef.current = onSelectItem;

	const ariaLabel = t("approvals.selectRow", "Select row");

	const columns = useMemo<ColumnDef<UnifiedApprovalItem>[]>(
		() => [
			// Selection column - uses refs to avoid recreation
			{
				id: "select",
				header: () => null,
				cell: ({ row }) => (
					<SelectionCell
						row={row}
						selectedIdsRef={selectedIdsRef}
						onSelectItemRef={onSelectItemRef}
						ariaLabel={ariaLabel}
					/>
				),
				enableSorting: false,
				enableHiding: false,
				size: 40,
			},
			// Type column
			{
				accessorKey: "approvalType",
				header: t("approvals.type", "Type"),
				cell: ({ row }) => {
					const TypeIcon = TYPE_ICONS[row.original.approvalType] || IconClockEdit;
					return (
						<div className="flex items-center gap-2">
							<TypeIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<span className="text-sm">{row.original.typeName}</span>
						</div>
					);
				},
				size: 150,
			},
			// Requester column
			{
				accessorKey: "requester",
				header: t("approvals.requester", "Requester"),
				cell: ({ row }) => (
					<div className="flex items-center gap-3">
						<UserAvatar
							image={row.original.requester.image}
							seed={row.original.requester.userId}
							name={row.original.requester.name}
							size="sm"
						/>
						<div className="min-w-0">
							<div className="font-medium truncate">{row.original.requester.name}</div>
							<div className="text-xs text-muted-foreground truncate">
								{row.original.requester.email}
							</div>
						</div>
					</div>
				),
				size: 200,
			},
			// Summary column
			{
				accessorKey: "display.summary",
				header: t("approvals.details", "Details"),
				cell: ({ row }) => (
					<div className="min-w-0">
						<div className="font-medium truncate">{row.original.display.title}</div>
						<div className="text-sm text-muted-foreground truncate">
							{row.original.display.subtitle}
						</div>
					</div>
				),
			},
			// Priority column
			{
				accessorKey: "priority",
				header: t("approvals.priority", "Priority"),
				cell: ({ row }) => (
					<Badge variant={PRIORITY_VARIANTS[row.original.priority]}>
						{t(`approvals.priorities.${row.original.priority}`, row.original.priority)}
					</Badge>
				),
				size: 100,
			},
			// SLA column
			{
				accessorKey: "sla",
				header: t("approvals.sla", "SLA"),
				cell: ({ row }) => {
					const { sla } = row.original;
					if (!sla.deadline) {
						return <span className="text-muted-foreground">-</span>;
					}

					return (
						<div className={cn("flex items-center gap-1", getSLAStatusColor(sla.status))}>
							{sla.status === "overdue" && <IconAlertTriangle className="h-4 w-4" aria-hidden="true" />}
							{sla.status === "approaching" && <IconClock className="h-4 w-4" aria-hidden="true" />}
							<span className="text-sm">
								{sla.hoursRemaining !== null
									? sla.hoursRemaining < 0
										? `${Math.abs(sla.hoursRemaining)}h overdue`
										: `${sla.hoursRemaining}h left`
									: "-"}
							</span>
						</div>
					);
				},
				size: 120,
			},
			// Age column
			{
				accessorKey: "createdAt",
				header: t("approvals.requested", "Requested"),
				cell: ({ row }) => (
					<span className="text-sm text-muted-foreground">
						{formatRelative(row.original.createdAt)}
					</span>
				),
				size: 120,
			},
		],
		[t, ariaLabel],
	);

	// Stable callback for row className that reads from ref
	const getRowClassName = useCallback(
		(row: UnifiedApprovalItem) =>
			cn(
				"cursor-pointer hover:bg-muted/50 transition-colors",
				selectedIdsRef.current?.has(row.id) && "bg-muted/30",
			),
		[],
	);

	return (
		<div className="rounded-md border">
			<DataTable
				columns={columns}
				data={items}
				isFetching={isFetching}
				onRowClick={onRowClick}
				getRowId={(row) => row.id}
				rowClassName={getRowClassName}
				emptyMessage={t("approvals.noRequests", "No pending requests")}
			/>
		</div>
	);
}
