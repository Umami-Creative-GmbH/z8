"use client";

import {
	IconBriefcase,
	IconCheck,
	IconClock,
	IconLoader2,
	IconPencil,
	IconScissors,
	IconTrash,
	IconX,
	IconXboxX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
	updateWorkPeriodNotes,
	updateWorkPeriodProject,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { ProjectSelector } from "@/components/time-tracking/project-selector";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import { useProjectsEnabled } from "@/stores/organization-settings-store";

interface WorkPeriodEditDialogProps {
	event: CalendarEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNotesUpdated?: () => void;
	onSplitClick?: () => void;
	onDeleteClick?: () => void;
}

export function WorkPeriodEditDialog({
	event,
	open,
	onOpenChange,
	onNotesUpdated,
	onSplitClick,
	onDeleteClick,
}: WorkPeriodEditDialogProps) {
	const { t } = useTranslate();
	const projectsEnabled = useProjectsEnabled();

	// Get metadata with defaults
	const metadata = event.metadata as {
		durationMinutes: number;
		employeeName: string;
		notes?: string;
		projectId?: string;
		projectName?: string;
		projectColor?: string;
		// Surcharge fields
		surchargeMinutes?: number;
		totalCreditedMinutes?: number;
		surchargeBreakdown?: Array<{
			ruleName: string;
			ruleType: "day_of_week" | "time_window" | "date_based";
			percentage: number;
			qualifyingMinutes: number;
			surchargeMinutes: number;
		}>;
		// Approval status for change policy enforcement
		approvalStatus?: "approved" | "pending" | "rejected";
	};

	const approvalStatus = metadata.approvalStatus ?? "approved";
	const isPending = approvalStatus === "pending";
	const isRejected = approvalStatus === "rejected";

	const hasSurcharge = metadata.surchargeMinutes && metadata.surchargeMinutes > 0;

	// Edit state
	const [isEditing, setIsEditing] = useState(false);
	const [notes, setNotes] = useState(metadata.notes || "");
	const [isSaving, setIsSaving] = useState(false);

	// Project edit state
	const [isEditingProject, setIsEditingProject] = useState(false);
	const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
		metadata.projectId,
	);
	const [isSavingProject, setIsSavingProject] = useState(false);

	// Format duration
	const formatDuration = (minutes: number) => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	};

	// Format time range
	const formatTimeRange = () => {
		const startTime = format(event.date, "p"); // e.g., "9:00 AM"
		const endTime = event.endDate ? format(event.endDate, "p") : "—";
		return `${startTime} - ${endTime}`;
	};

	const handleSaveNotes = useCallback(async () => {
		setIsSaving(true);
		try {
			const result = await updateWorkPeriodNotes(event.id, notes.trim());
			if (result.success) {
				toast.success(t("calendar.edit.notesSaved", "Notes saved"));
				// Trigger refetch via callback
				onNotesUpdated?.();
				setIsEditing(false);
			} else {
				toast.error(result.error || t("calendar.edit.notesSaveFailed", "Failed to save notes"));
			}
		} finally {
			setIsSaving(false);
		}
	}, [event.id, notes, onNotesUpdated, t]);

	const handleCancelEdit = useCallback(() => {
		setNotes(metadata.notes || "");
		setIsEditing(false);
	}, [metadata.notes]);

	const handleStartEdit = useCallback(() => {
		setNotes(metadata.notes || "");
		setIsEditing(true);
	}, [metadata.notes]);

	// Project editing handlers
	const handleSaveProject = useCallback(async () => {
		setIsSavingProject(true);
		try {
			const result = await updateWorkPeriodProject(event.id, selectedProjectId ?? null);
			if (result.success) {
				toast.success(t("calendar.edit.projectSaved", "Project updated"));
				onNotesUpdated?.(); // Reuse callback for refetching
				setIsEditingProject(false);
			} else {
				toast.error(
					result.error || t("calendar.edit.projectSaveFailed", "Failed to update project"),
				);
			}
		} finally {
			setIsSavingProject(false);
		}
	}, [event.id, selectedProjectId, onNotesUpdated, t]);

	const handleCancelProjectEdit = useCallback(() => {
		setSelectedProjectId(metadata.projectId);
		setIsEditingProject(false);
	}, [metadata.projectId]);

	const handleStartProjectEdit = useCallback(() => {
		setSelectedProjectId(metadata.projectId);
		setIsEditingProject(true);
	}, [metadata.projectId]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<div
							className={`w-3 h-3 rounded-full ${isPending ? "opacity-60" : ""}`}
							style={{ backgroundColor: event.color }}
						/>
						<DialogTitle>{t("calendar.edit.title", "Work Period")}</DialogTitle>
						{isPending && (
							<Badge variant="outline" className="text-amber-600 border-amber-500">
								{t("calendar.status.pending", "Pending")}
							</Badge>
						)}
						{isRejected && (
							<Badge variant="destructive">{t("calendar.status.rejected", "Rejected")}</Badge>
						)}
					</div>
					<DialogDescription>
						{format(event.date, "PPP")} {/* e.g., "January 1, 2024" */}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Approval Status Banner - show for pending or rejected */}
					{isPending && (
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
					)}
					{isRejected && (
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
					)}

					{/* Employee name */}
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.employee", "Employee")}
						</span>
						<p className="font-medium">{metadata.employeeName}</p>
					</div>

					{/* Time range */}
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.time", "Time")}
						</span>
						<p className="font-medium">{formatTimeRange()}</p>
					</div>

					{/* Duration - with surcharge breakdown */}
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.duration", "Duration")}
						</span>
						{hasSurcharge ? (
							<div className="space-y-1 mt-1">
								<div className="flex justify-between text-sm">
									<span className="text-muted-foreground">
										{t("calendar.details.baseWorked", "Base worked")}
									</span>
									<span className="tabular-nums">{formatDuration(metadata.durationMinutes)}</span>
								</div>
								<div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
									<span>{t("calendar.details.surcharge", "Surcharge")}</span>
									<span className="tabular-nums">
										+{formatDuration(metadata.surchargeMinutes!)}
									</span>
								</div>
								<div className="flex justify-between font-medium border-t pt-1">
									<span>{t("calendar.details.credited", "Credited")}</span>
									<span className="tabular-nums">
										{formatDuration(metadata.totalCreditedMinutes!)}
									</span>
								</div>
								{/* Surcharge breakdown details */}
								{metadata.surchargeBreakdown && metadata.surchargeBreakdown.length > 0 && (
									<div className="mt-2 pt-2 border-t space-y-1">
										<span className="text-xs text-muted-foreground">
											{t("calendar.details.surchargeBreakdown", "Surcharge Breakdown")}
										</span>
										{metadata.surchargeBreakdown.map((rule, index) => (
											<div
												key={`${rule.ruleName}-${index}`}
												className="flex justify-between text-xs bg-muted/50 rounded px-2 py-1"
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
								)}
							</div>
						) : (
							<p className="font-medium">{formatDuration(metadata.durationMinutes)}</p>
						)}
					</div>

					{/* Project section - only show if projects feature is enabled */}
					{projectsEnabled && (
						<div>
							<div className="flex items-center justify-between mb-1">
								<span className="text-sm text-muted-foreground">
									{t("calendar.details.project", "Project")}
								</span>
								{!isEditingProject && (
									<Button
										variant="ghost"
										size="sm"
										onClick={handleStartProjectEdit}
										className="h-7 px-2"
									>
										<IconPencil className="size-4 mr-1" />
										{t("common.edit", "Edit")}
									</Button>
								)}
							</div>

							{isEditingProject ? (
								<div className="space-y-2">
									<ProjectSelector
										value={selectedProjectId}
										onValueChange={setSelectedProjectId}
										disabled={isSavingProject}
										showLabel={false}
										autoSelectLast={false}
									/>
									<div className="flex gap-2">
										<Button
											size="sm"
											onClick={handleSaveProject}
											disabled={isSavingProject}
											className="flex-1"
										>
											{isSavingProject ? (
												<IconLoader2 className="size-4 animate-spin mr-1" />
											) : (
												<IconCheck className="size-4 mr-1" />
											)}
											{t("common.save", "Save")}
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={handleCancelProjectEdit}
											disabled={isSavingProject}
										>
											<IconX className="size-4 mr-1" />
											{t("common.cancel", "Cancel")}
										</Button>
									</div>
								</div>
							) : (
								<div className="flex items-center gap-2">
									{metadata.projectColor && (
										<div
											className="size-3 rounded-full"
											style={{ backgroundColor: metadata.projectColor }}
										/>
									)}
									{metadata.projectName ? (
										<p className="font-medium">{metadata.projectName}</p>
									) : (
										<p className="text-sm text-muted-foreground italic">
											{t("calendar.edit.noProject", "No project assigned")}
										</p>
									)}
								</div>
							)}
						</div>
					)}

					{/* Notes section */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<span className="text-sm text-muted-foreground">
								{t("calendar.details.notes", "Notes")}
							</span>
							{!isEditing && (
								<Button variant="ghost" size="sm" onClick={handleStartEdit} className="h-7 px-2">
									<IconPencil className="size-4 mr-1" />
									{t("common.edit", "Edit")}
								</Button>
							)}
						</div>

						{isEditing ? (
							<div className="space-y-2">
								<Textarea
									placeholder={t("timeTracking.notesPlaceholder", "What did you work on?")}
									value={notes}
									onChange={(e) => setNotes(e.target.value)}
									rows={3}
									className="resize-none"
									autoFocus
								/>
								<div className="flex gap-2">
									<Button
										size="sm"
										onClick={handleSaveNotes}
										disabled={isSaving}
										className="flex-1"
									>
										{isSaving ? (
											<IconLoader2 className="size-4 animate-spin mr-1" />
										) : (
											<IconCheck className="size-4 mr-1" />
										)}
										{t("common.save", "Save")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={handleCancelEdit}
										disabled={isSaving}
									>
										<IconX className="size-4 mr-1" />
										{t("common.cancel", "Cancel")}
									</Button>
								</div>
							</div>
						) : (
							<p className="text-sm">
								{metadata.notes || (
									<span className="text-muted-foreground italic">
										{t("calendar.edit.noNotes", "No notes added")}
									</span>
								)}
							</p>
						)}
					</div>
				</div>

				<DialogFooter className="flex-col sm:flex-row gap-2">
					{/* Split and Delete buttons - for future phases */}
					<div className="flex gap-2 w-full sm:w-auto">
						<Button
							variant="outline"
							size="sm"
							onClick={onSplitClick}
							disabled={!onSplitClick}
							className="flex-1 sm:flex-none"
						>
							<IconScissors className="size-4 mr-1" />
							{t("calendar.edit.split", "Split")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onDeleteClick}
							disabled={!onDeleteClick}
							className="flex-1 sm:flex-none text-destructive hover:text-destructive"
						>
							<IconTrash className="size-4 mr-1" />
							{t("calendar.edit.convertToBreak", "Convert to Break")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
