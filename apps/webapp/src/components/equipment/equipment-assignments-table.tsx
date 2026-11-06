"use client";
import {
	IconArrowDown,
	IconArrowsExchange,
	IconArrowsSort,
	IconArrowUp,
	IconCircleX,
	IconDots,
	IconEye,
	IconPackageImport,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { EquipmentAssignmentView } from "@/lib/organization/equipment/contracts";
import { useRouter } from "@/navigation";
import type { AssignmentSort, AssignmentSortColumn } from "./equipment-list";
import { assignmentHref } from "./equipment-list-state";
import {
	AssignmentStatusBadge,
	DeadlineText,
	HolderIdentity,
	ItemIdentity,
} from "./equipment-status";

export type AssignmentRowAction = "receipt" | "transfer" | "closure";

/** A column header that sorts the list; the same column again flips the direction. */
function SortableHead({
	column,
	sort,
	onSort,
	children,
}: {
	column: AssignmentSortColumn;
	sort: AssignmentSort;
	onSort: (sort: AssignmentSort) => void;
	children: string;
}) {
	const active = sort.column === column;
	const Icon = !active
		? IconArrowsSort
		: sort.direction === "asc"
			? IconArrowUp
			: IconArrowDown;
	return (
		<TableHead
			aria-sort={
				active
					? sort.direction === "asc"
						? "ascending"
						: "descending"
					: "none"
			}
		>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="-ml-2 h-8 px-2"
				onClick={() =>
					onSort({
						column,
						direction: active && sort.direction === "asc" ? "desc" : "asc",
					})
				}
			>
				{children}
				<Icon aria-hidden="true" className="size-3.5" />
			</Button>
		</TableHead>
	);
}

/**
 * Assignments as a table that stacks on phones (#1572). A row opens the
 * assignment's page; its menu offers only the commands the reader may run there.
 */
export function EquipmentAssignmentsTable({
	assignments,
	today,
	sort,
	onSort,
	showHolder,
	holderHref,
	back,
	canTransfer,
	onAction,
	busy,
}: {
	assignments: readonly EquipmentAssignmentView[];
	today: string;
	sort: AssignmentSort;
	onSort: (sort: AssignmentSort) => void;
	showHolder: boolean;
	/** Staff readers link a holder to their equipment. */
	holderHref?: (assignment: EquipmentAssignmentView) => string | undefined;
	/** The list to return to from an assignment's page. */
	back?: string;
	canTransfer: (assignment: EquipmentAssignmentView) => boolean;
	onAction: (action: AssignmentRowAction, assignmentId: string) => void;
	busy?: boolean;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const router = useRouter();
	return (
		<Table mobileLayout="stacked" aria-busy={busy}>
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					{showHolder ? (
						<SortableHead column="holder" sort={sort} onSort={onSort}>
							{t("settings.equipment.list.holder", "Holder")}
						</SortableHead>
					) : null}
					<SortableHead column="item" sort={sort} onSort={onSort}>
						{t("settings.equipment.list.item", "Item")}
					</SortableHead>
					<TableHead>
						{t("settings.equipment.list.outstanding", "Outstanding")}
					</TableHead>
					<SortableHead column="deadline" sort={sort} onSort={onSort}>
						{t("settings.equipment.list.deadline", "Return deadline")}
					</SortableHead>
					<TableHead>{t("settings.equipment.list.status", "Status")}</TableHead>
					<TableHead className="w-12">
						<span className="sr-only">
							{t("settings.equipment.list.actions", "Actions")}
						</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{assignments.map((assignment) => {
					const href = assignmentHref(assignment.id, back);
					const transferable = canTransfer(assignment);
					const hasCommands =
						assignment.canReceive ||
						transferable ||
						assignment.canCloseException;
					return (
						<TableRow
							key={assignment.id}
							className="cursor-pointer [content-visibility:auto]"
							onClick={() => router.push(href)}
						>
							{showHolder ? (
								<TableCell>
									<HolderIdentity
										employeeId={assignment.employeeId}
										name={assignment.holderName}
										image={assignment.holderImage}
										former={assignment.former}
										href={holderHref?.(assignment)}
									/>
								</TableCell>
							) : null}
							<TableCell className="max-w-64">
								<ItemIdentity assignment={assignment} href={href} />
							</TableCell>
							<TableCell className="tabular-nums">
								{assignment.outstandingQuantity.toLocaleString(locale)}{" "}
								<span className="text-muted-foreground">
									/ {assignment.quantity.toLocaleString(locale)}
								</span>
							</TableCell>
							<TableCell>
								<DeadlineText assignment={assignment} today={today} />
							</TableCell>
							<TableCell>
								<AssignmentStatusBadge assignment={assignment} />
							</TableCell>
							{/* The menu acts on the row without opening it. */}
							<TableCell
								className="text-right"
								onClick={(event) => event.stopPropagation()}
							>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="size-8"
											aria-label={t(
												"settings.equipment.list.rowActions",
												"Actions for {identifier}",
												{ identifier: assignment.identifier },
											)}
										>
											<IconDots className="size-4" aria-hidden="true" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-52">
										<DropdownMenuLabel className="truncate text-xs text-muted-foreground">
											{assignment.identifier}
										</DropdownMenuLabel>
										{assignment.canReceive ? (
											<DropdownMenuItem
												onClick={() => onAction("receipt", assignment.id)}
											>
												<IconPackageImport aria-hidden="true" />
												{t(
													"settings.equipment.handover.receive",
													"Record receipt",
												)}
											</DropdownMenuItem>
										) : null}
										{transferable ? (
											<DropdownMenuItem
												onClick={() => onAction("transfer", assignment.id)}
											>
												<IconArrowsExchange aria-hidden="true" />
												{t("settings.equipment.list.transfer", "Transfer")}
											</DropdownMenuItem>
										) : null}
										{assignment.canCloseException ? (
											<DropdownMenuItem
												onClick={() => onAction("closure", assignment.id)}
											>
												<IconCircleX aria-hidden="true" />
												{t(
													"settings.equipment.exception.close",
													"Close return",
												)}
											</DropdownMenuItem>
										) : null}
										{hasCommands ? <DropdownMenuSeparator /> : null}
										<DropdownMenuItem onClick={() => router.push(href)}>
											<IconEye aria-hidden="true" />
											{t("settings.equipment.list.viewDetails", "View details")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
