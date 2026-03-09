"use client";

import {
	IconBriefcase,
	IconCheck,
	IconClock,
	IconLoader2,
	IconPencil,
	IconX,
	IconXboxX,
} from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { ProjectSelector } from "@/components/time-tracking/project-selector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import {
	formatDuration,
	formatEventTimeRange,
	type WorkPeriodDialogMetadata,
} from "./work-period-dialog-utils";

export function ApprovalStatusBanner({
	status,
	t,
}: {
	status: "approved" | "pending" | "rejected";
	t: TFnType;
}) {
	if (status === "pending") {
		return (
			<Alert className="border-amber-500/50 bg-amber-500/10">
				<IconClock className="h-4 w-4 text-amber-500" />
				<AlertTitle className="text-amber-600 dark:text-amber-400">
					{t("calendar.details.pendingApproval", "Pending Approval")}
				</AlertTitle>
				<AlertDescription className="text-amber-600/80 dark:text-amber-400/80">
					{t(
						"calendar.details.pendingApprovalDescription",
						"This work period is awaiting manager approval. The recorded times may change if rejected.",
					)}
				</AlertDescription>
			</Alert>
		);
	}

	if (status === "rejected") {
		return (
			<Alert variant="destructive">
				<IconXboxX className="h-4 w-4" />
				<AlertTitle>{t("calendar.details.rejected", "Rejected")}</AlertTitle>
				<AlertDescription>
					{t(
						"calendar.details.rejectedDescription",
						"This work period change was rejected by a manager. The original times have been restored.",
					)}
				</AlertDescription>
			</Alert>
		);
	}

	return null;
}

export function WorkPeriodHeader({
	event,
	status,
	t,
}: {
	event: CalendarEvent;
	status: "approved" | "pending" | "rejected";
	t: TFnType;
}) {
	return (
		<>
			<div className="flex items-center gap-2">
				<div
					className={`h-3 w-3 rounded-full ${status === "pending" ? "opacity-60" : ""}`}
					style={{ backgroundColor: event.color }}
				/>
				<span className="font-semibold">{t("calendar.edit.title", "Work Period")}</span>
				{status === "pending" ? (
					<Badge variant="outline" className="border-amber-500 text-amber-600">
						{t("calendar.status.pending", "Pending")}
					</Badge>
				) : null}
				{status === "rejected" ? (
					<Badge variant="destructive">{t("calendar.status.rejected", "Rejected")}</Badge>
				) : null}
			</div>
			<div className="text-sm text-muted-foreground">{format(event.date, "PPP")}</div>
		</>
	);
}

export function WorkPeriodDurationSection({
	metadata,
	t,
}: {
	metadata: WorkPeriodDialogMetadata;
	t: TFnType;
}) {
	const hasSurcharge = !!metadata.surchargeMinutes && metadata.surchargeMinutes > 0;

	return (
		<div>
			<span className="text-sm text-muted-foreground">
				{t("calendar.details.duration", "Duration")}
			</span>
			{hasSurcharge ? (
				<div className="mt-1 space-y-1">
					<div className="flex justify-between text-sm">
						<span className="text-muted-foreground">
							{t("calendar.details.baseWorked", "Base worked")}
						</span>
						<span className="tabular-nums">{formatDuration(metadata.durationMinutes)}</span>
					</div>
					<div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
						<span>{t("calendar.details.surcharge", "Surcharge")}</span>
						<span className="tabular-nums">+{formatDuration(metadata.surchargeMinutes!)}</span>
					</div>
					<div className="flex justify-between border-t pt-1 font-medium">
						<span>{t("calendar.details.credited", "Credited")}</span>
						<span className="tabular-nums">{formatDuration(metadata.totalCreditedMinutes!)}</span>
					</div>
					{metadata.surchargeBreakdown?.length ? (
						<div className="mt-2 space-y-1 border-t pt-2">
							<span className="text-xs text-muted-foreground">
								{t("calendar.details.surchargeBreakdown", "Surcharge Breakdown")}
							</span>
							{metadata.surchargeBreakdown.map((rule, index) => (
								<div
									key={`${rule.ruleName}-${index}`}
									className="flex justify-between rounded bg-muted/50 px-2 py-1 text-xs"
								>
									<span>
										{rule.ruleName}{" "}
										<span className="text-muted-foreground">({rule.percentage}%)</span>
									</span>
									<span className="tabular-nums text-emerald-600 dark:text-emerald-400">
										+{formatDuration(rule.surchargeMinutes)}
									</span>
								</div>
							))}
						</div>
					) : null}
				</div>
			) : (
				<p className="font-medium">{formatDuration(metadata.durationMinutes)}</p>
			)}
		</div>
	);
}

export function ProjectEditSection({
	projectsEnabled,
	metadata,
	isEditing,
	selectedProjectId,
	isSaving,
	onStartEdit,
	onCancel,
	onSave,
	onProjectChange,
	t,
}: {
	projectsEnabled: boolean;
	metadata: WorkPeriodDialogMetadata;
	isEditing: boolean;
	selectedProjectId: string | undefined;
	isSaving: boolean;
	onStartEdit: () => void;
	onCancel: () => void;
	onSave: () => void;
	onProjectChange: (projectId: string | undefined) => void;
	t: TFnType;
}) {
	if (!projectsEnabled) {
		return null;
	}

	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.project", "Project")}
				</span>
				{!isEditing ? (
					<Button variant="ghost" size="sm" onClick={onStartEdit} className="h-7 px-2">
						<IconPencil className="mr-1 size-4" />
						{t("common.edit", "Edit")}
					</Button>
				) : null}
			</div>

			{isEditing ? (
				<div className="space-y-2">
					<ProjectSelector
						value={selectedProjectId}
						onValueChange={onProjectChange}
						disabled={isSaving}
						showLabel={false}
						autoSelectLast={false}
					/>
					<div className="flex gap-2">
						<Button size="sm" onClick={onSave} disabled={isSaving} className="flex-1">
							{isSaving ? (
								<IconLoader2 className="mr-1 size-4 animate-spin" />
							) : (
								<IconCheck className="mr-1 size-4" />
							)}
							{t("common.save", "Save")}
						</Button>
						<Button size="sm" variant="outline" onClick={onCancel} disabled={isSaving}>
							<IconX className="mr-1 size-4" />
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				</div>
			) : (
				<div className="flex items-center gap-2">
					{metadata.projectColor ? (
						<div
							className="size-3 rounded-full"
							style={{ backgroundColor: metadata.projectColor }}
						/>
					) : (
						<IconBriefcase className="size-4 text-muted-foreground" />
					)}
					{metadata.projectName ? (
						<p className="font-medium">{metadata.projectName}</p>
					) : (
						<p className="text-sm italic text-muted-foreground">
							{t("calendar.edit.noProject", "No project assigned")}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

export function NotesEditSection({
	notes,
	isEditing,
	isSaving,
	onNotesChange,
	onStartEdit,
	onCancel,
	onSave,
	t,
}: {
	notes: string;
	isEditing: boolean;
	isSaving: boolean;
	onNotesChange: (notes: string) => void;
	onStartEdit: () => void;
	onCancel: () => void;
	onSave: () => void;
	t: TFnType;
}) {
	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.notes", "Notes")}
				</span>
				{!isEditing ? (
					<Button variant="ghost" size="sm" onClick={onStartEdit} className="h-7 px-2">
						<IconPencil className="mr-1 size-4" />
						{t("common.edit", "Edit")}
					</Button>
				) : null}
			</div>

			{isEditing ? (
				<div className="space-y-2">
					<Textarea
						placeholder={t("timeTracking.notesPlaceholder", "What did you work on?")}
						value={notes}
						onChange={(event) => onNotesChange(event.target.value)}
						rows={3}
						className="resize-none"
						autoFocus
					/>
					<div className="flex gap-2">
						<Button size="sm" onClick={onSave} disabled={isSaving} className="flex-1">
							{isSaving ? (
								<IconLoader2 className="mr-1 size-4 animate-spin" />
							) : (
								<IconCheck className="mr-1 size-4" />
							)}
							{t("common.save", "Save")}
						</Button>
						<Button size="sm" variant="outline" onClick={onCancel} disabled={isSaving}>
							<IconX className="mr-1 size-4" />
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				</div>
			) : notes ? (
				<p className="text-sm">{notes}</p>
			) : (
				<p className="text-sm italic text-muted-foreground">
					{t("calendar.edit.noNotes", "No notes added")}
				</p>
			)}
		</div>
	);
}

export function WorkPeriodSummaryBlock({
	event,
	metadata,
	t,
}: {
	event: CalendarEvent;
	metadata: WorkPeriodDialogMetadata;
	t: TFnType;
}) {
	return (
		<>
			<div>
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.employee", "Employee")}
				</span>
				<p className="font-medium">{metadata.employeeName}</p>
			</div>
			<div>
				<span className="text-sm text-muted-foreground">{t("calendar.details.time", "Time")}</span>
				<p className="font-medium">{formatEventTimeRange(event)}</p>
			</div>
		</>
	);
}
