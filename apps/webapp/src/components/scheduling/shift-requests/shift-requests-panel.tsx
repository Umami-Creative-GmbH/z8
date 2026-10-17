"use client";

import { IconArrowsExchange, IconCheck, IconMapPin, IconX } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { ShiftRequestWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import {
	ApproveShiftRequestForm,
	assignedEmployeeIdOf,
	RejectShiftRequestForm,
} from "./shift-request-decision";
import { usePendingShiftRequests } from "./use-pending-shift-requests";

type RequestEmployee = ShiftRequestWithRelations["requester"];

function employeeName(employee: RequestEmployee | null | undefined): string {
	if (!employee) return "";
	return (
		(employee.user ? buildAuthUserDisplayName(employee.user) : "") ||
		buildAuthUserDisplayName(employee)
	);
}

interface ShiftRequestsReviewProps {
	/** The planner's employee id. */
	approverId: string;
	organizationTimezone: string;
}

/** The planner's toolbar button with the pending count, and the panel it opens. */
export function ShiftRequestsReview({
	approverId,
	organizationTimezone,
}: ShiftRequestsReviewProps) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const { data: requests } = usePendingShiftRequests(approverId);
	const count = requests?.length ?? 0;

	return (
		<>
			<Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
				<IconArrowsExchange className="mr-2 size-4" aria-hidden="true" />
				{t("scheduling:scheduling.shiftRequests.button", "Shift requests")}
				{count > 0 && (
					<Badge variant="secondary" className="ml-2">
						{count}
					</Badge>
				)}
			</Button>
			<ShiftRequestsPanel
				open={open}
				onOpenChange={setOpen}
				approverId={approverId}
				organizationTimezone={organizationTimezone}
			/>
		</>
	);
}

interface ShiftRequestsPanelProps extends ShiftRequestsReviewProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

type Decision = { requestId: string; kind: "approve" | "reject" };

export function ShiftRequestsPanel({
	open,
	onOpenChange,
	approverId,
	organizationTimezone,
}: ShiftRequestsPanelProps) {
	const { t } = useTranslate();
	const { data: requests, isLoading, isError } = usePendingShiftRequests(approverId, open);
	// One request is decided at a time.
	const [decision, setDecision] = useState<Decision | null>(null);

	const handleOpenChange = (next: boolean) => {
		if (!next) setDecision(null);
		onOpenChange(next);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("scheduling:scheduling.shiftRequests.title", "Shift requests")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"scheduling:scheduling.shiftRequests.description",
							"Approve or reject pending pickup and swap requests",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-3">
					{isLoading ? (
						<p className="text-sm text-muted-foreground" role="status">
							{t("scheduling:scheduling.shiftRequests.loading", "Loading requests…")}
						</p>
					) : isError ? (
						<p className="text-sm text-destructive" role="alert">
							{t("scheduling:scheduling.shiftRequests.loadFailed", "Failed to load requests")}
						</p>
					) : !requests || requests.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("scheduling:scheduling.shiftRequests.empty", "No pending requests")}
						</p>
					) : (
						<ul className="space-y-3">
							{requests.map((request) => (
								<li key={request.id}>
									<ShiftRequestItem
										request={request}
										organizationTimezone={organizationTimezone}
										decision={decision?.requestId === request.id ? decision.kind : null}
										onDecide={(kind) => setDecision({ requestId: request.id, kind })}
										onClose={() => setDecision(null)}
									/>
								</li>
							))}
						</ul>
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}

interface ShiftRequestItemProps {
	request: ShiftRequestWithRelations;
	organizationTimezone: string;
	decision: Decision["kind"] | null;
	onDecide: (kind: Decision["kind"]) => void;
	onClose: () => void;
}

function ShiftRequestItem({
	request,
	organizationTimezone,
	decision,
	onDecide,
	onClose,
}: ShiftRequestItemProps) {
	const { t } = useTranslate();
	const locale = useTolgee().getLanguage() || "en";
	const unnamed = t("scheduling:scheduling.shiftRequests.unnamedEmployee", "Unnamed employee");
	const requester = employeeName(request.requester) || unnamed;
	const target = employeeName(request.targetEmployee) || unnamed;
	const shiftDate = formatPlainDate(
		shiftCalendarDate(request.shift.date, organizationTimezone),
		locale,
		"weekdayMonthDay",
	);
	const subarea = request.shift.subarea;
	const canApprove = assignedEmployeeIdOf(request) !== null;
	const headingId = `shift-request-${request.id}`;

	return (
		<article aria-labelledby={headingId} className="space-y-3 rounded-lg border p-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={request.type === "swap" ? "outline" : "secondary"}>
					{request.type === "swap"
						? t("scheduling:scheduling.shiftRequests.type.swap", "Swap")
						: t("scheduling:scheduling.shiftRequests.type.pickup", "Pickup")}
				</Badge>
				<h3 id={headingId} className="text-sm font-medium">
					{t("scheduling:scheduling.shiftRequests.shiftWhen", "{date}, {start}–{end}", {
						date: shiftDate,
						start: request.shift.startTime,
						end: request.shift.endTime,
					})}
				</h3>
			</div>

			{subarea && (
				<p className="flex items-center gap-1.5 text-sm text-muted-foreground">
					<IconMapPin className="size-4" aria-hidden="true" />
					{subarea.location.name} – {subarea.name}
				</p>
			)}

			<p className="text-sm">
				{request.type === "pickup"
					? t(
							"scheduling:scheduling.shiftRequests.pickupSummary",
							"{requester} wants to pick up this open shift",
							{ requester },
						)
					: request.targetEmployeeId
						? t(
								"scheduling:scheduling.shiftRequests.swapSummary",
								"{requester} wants to hand this shift to {target}",
								{ requester, target },
							)
						: t(
								"scheduling:scheduling.shiftRequests.swapWithoutTarget",
								"{requester} wants to hand this shift on, but has not named a colleague",
								{ requester },
							)}
			</p>

			{request.reason && (
				<p className="text-sm text-muted-foreground">
					{t("scheduling:scheduling.shiftRequests.reason", "Reason: {reason}", {
						reason: request.reason,
					})}
				</p>
			)}
			{request.notes && (
				<p className="text-sm text-muted-foreground">
					{t("scheduling:scheduling.shiftRequests.notes", "Notes: {notes}", {
						notes: request.notes,
					})}
				</p>
			)}

			{decision === "approve" ? (
				<ApproveShiftRequestForm
					request={request}
					organizationTimezone={organizationTimezone}
					onDone={onClose}
					onCancel={onClose}
				/>
			) : decision === "reject" ? (
				<RejectShiftRequestForm request={request} onDone={onClose} onCancel={onClose} />
			) : (
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" size="sm" onClick={() => onDecide("reject")}>
						<IconX className="mr-2 size-4" aria-hidden="true" />
						{t("scheduling:scheduling.shiftRequests.reject", "Reject")}
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={() => onDecide("approve")}
						disabled={!canApprove}
					>
						<IconCheck className="mr-2 size-4" aria-hidden="true" />
						{t("scheduling:scheduling.shiftRequests.approve", "Approve")}
					</Button>
				</div>
			)}
		</article>
	);
}
