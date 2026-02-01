"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { DateTime } from "luxon";
import { IconAlertTriangle, IconCheck, IconExclamationCircle, IconInfoCircle, IconLoader2, IconX } from "@tabler/icons-react";
import {
	acknowledgeFinding,
	resolveFinding,
	waiveFinding,
	type ComplianceFindingWithDetails,
} from "@/app/[locale]/(app)/settings/compliance-radar/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ComplianceFindingSeverity, ComplianceFindingStatus, ComplianceFindingType } from "@/db/schema";

interface ComplianceFindingDialogProps {
	finding: ComplianceFindingWithDetails | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isAdmin: boolean;
	onAction: () => void;
}

const SEVERITY_ICONS: Record<ComplianceFindingSeverity, typeof IconInfoCircle> = {
	info: IconInfoCircle,
	warning: IconExclamationCircle,
	critical: IconAlertTriangle,
};

const SEVERITY_COLORS: Record<ComplianceFindingSeverity, string> = {
	info: "text-blue-600",
	warning: "text-orange-600",
	critical: "text-red-600",
};

export function ComplianceFindingDialog({
	finding,
	open,
	onOpenChange,
	isAdmin,
	onAction,
}: ComplianceFindingDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [note, setNote] = useState("");
	const [waiverReason, setWaiverReason] = useState("");
	const [showWaiverForm, setShowWaiverForm] = useState(false);

	const findingTypeLabels: Record<ComplianceFindingType, string> = {
		rest_period_insufficient: t("complianceRadar.findingType.restPeriodInsufficient", "Insufficient Rest Period"),
		max_hours_daily_exceeded: t("complianceRadar.findingType.maxHoursDailyExceeded", "Daily Hours Exceeded"),
		max_hours_weekly_exceeded: t("complianceRadar.findingType.maxHoursWeeklyExceeded", "Weekly Hours Exceeded"),
		consecutive_days_exceeded: t("complianceRadar.findingType.consecutiveDaysExceeded", "Consecutive Days Exceeded"),
	};

	const statusLabels: Record<ComplianceFindingStatus, string> = {
		open: t("complianceRadar.status.open", "Open"),
		acknowledged: t("complianceRadar.status.acknowledged", "Acknowledged"),
		waived: t("complianceRadar.status.waived", "Waived"),
		resolved: t("complianceRadar.status.resolved", "Resolved"),
	};

	if (!finding) return null;

	const SeverityIcon = SEVERITY_ICONS[finding.severity];

	const handleAcknowledge = async () => {
		setIsSubmitting(true);
		try {
			const result = await acknowledgeFinding(finding.id, note || undefined);
			if (result.success) {
				toast.success(t("complianceRadar.finding.acknowledged", "Finding acknowledged"));
				setNote("");
				onAction();
			} else {
				toast.error(result.error.message);
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleWaive = async () => {
		if (!waiverReason.trim()) {
			toast.error(t("complianceRadar.finding.waiverReasonRequired", "Waiver reason is required"));
			return;
		}
		setIsSubmitting(true);
		try {
			const result = await waiveFinding(finding.id, waiverReason);
			if (result.success) {
				toast.success(t("complianceRadar.finding.waived", "Finding waived"));
				setWaiverReason("");
				setShowWaiverForm(false);
				onAction();
			} else {
				toast.error(result.error.message);
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleResolve = async () => {
		setIsSubmitting(true);
		try {
			const result = await resolveFinding(finding.id, note || undefined);
			if (result.success) {
				toast.success(t("complianceRadar.finding.resolved", "Finding resolved"));
				setNote("");
				onAction();
			} else {
				toast.error(result.error.message);
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const formatEvidence = () => {
		const evidence = finding.evidence;
		switch (evidence.type) {
			case "rest_period_insufficient":
				return (
					<div className="space-y-2 text-sm">
						<div className="grid grid-cols-2 gap-2">
							<span className="text-muted-foreground">{t("complianceRadar.evidence.lastClockOut", "Last Clock Out:")}</span>
							<span>{DateTime.fromISO(evidence.lastClockOutTime).toLocaleString(DateTime.DATETIME_SHORT)}</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.nextClockIn", "Next Clock In:")}</span>
							<span>{DateTime.fromISO(evidence.nextClockInTime).toLocaleString(DateTime.DATETIME_SHORT)}</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.actualRest", "Actual Rest:")}</span>
							<span>{Math.floor(evidence.actualRestMinutes / 60)}h {evidence.actualRestMinutes % 60}m</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.requiredRest", "Required Rest:")}</span>
							<span>{Math.floor(evidence.requiredRestMinutes / 60)}h {evidence.requiredRestMinutes % 60}m</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.shortfall", "Shortfall:")}</span>
							<span className="text-red-600">{Math.floor(evidence.shortfallMinutes / 60)}h {evidence.shortfallMinutes % 60}m</span>
						</div>
					</div>
				);
			case "max_hours_daily_exceeded":
				return (
					<div className="space-y-2 text-sm">
						<div className="grid grid-cols-2 gap-2">
							<span className="text-muted-foreground">{t("complianceRadar.evidence.date", "Date:")}</span>
							<span>{evidence.date}</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.hoursWorked", "Hours Worked:")}</span>
							<span>{Math.floor(evidence.workedMinutes / 60)}h {evidence.workedMinutes % 60}m</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.limit", "Limit:")}</span>
							<span>{Math.floor(evidence.limitMinutes / 60)}h {evidence.limitMinutes % 60}m</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.exceededBy", "Exceeded By:")}</span>
							<span className="text-red-600">{Math.floor(evidence.exceedanceMinutes / 60)}h {evidence.exceedanceMinutes % 60}m</span>
						</div>
					</div>
				);
			case "max_hours_weekly_exceeded":
				return (
					<div className="space-y-2 text-sm">
						<div className="grid grid-cols-2 gap-2">
							<span className="text-muted-foreground">{t("complianceRadar.evidence.week", "Week:")}</span>
							<span>{evidence.weekStartDate} - {evidence.weekEndDate}</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.hoursWorked", "Hours Worked:")}</span>
							<span>{Math.floor(evidence.workedMinutes / 60)}h {evidence.workedMinutes % 60}m</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.limit", "Limit:")}</span>
							<span>{Math.floor(evidence.limitMinutes / 60)}h {evidence.limitMinutes % 60}m</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.exceededBy", "Exceeded By:")}</span>
							<span className="text-red-600">{Math.floor(evidence.exceedanceMinutes / 60)}h {evidence.exceedanceMinutes % 60}m</span>
						</div>
					</div>
				);
			case "consecutive_days_exceeded":
				return (
					<div className="space-y-2 text-sm">
						<div className="grid grid-cols-2 gap-2">
							<span className="text-muted-foreground">{t("complianceRadar.evidence.period", "Period:")}</span>
							<span>{evidence.startDate} - {evidence.endDate}</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.consecutiveDays", "Consecutive Days:")}</span>
							<span className="text-red-600">{evidence.consecutiveDays}</span>
							<span className="text-muted-foreground">{t("complianceRadar.evidence.maxAllowed", "Max Allowed:")}</span>
							<span>{evidence.maxAllowedDays}</span>
						</div>
					</div>
				);
		}
	};

	const canAcknowledge = finding.status === "open";
	const canWaive = isAdmin && (finding.status === "open" || finding.status === "acknowledged");
	const canResolve = finding.status === "open" || finding.status === "acknowledged";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<SeverityIcon className={cn("size-5", SEVERITY_COLORS[finding.severity])} aria-hidden="true" />
						{findingTypeLabels[finding.type]}
					</DialogTitle>
					<DialogDescription>
						{finding.employee.firstName} {finding.employee.lastName} -{" "}
						{DateTime.fromJSDate(finding.occurrenceDate).toLocaleString(DateTime.DATE_MED)}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Status Badge */}
					<div className="flex items-center justify-between">
						<span className="text-sm font-medium">{t("complianceRadar.finding.status", "Status")}</span>
						<Badge variant={finding.status === "open" ? "destructive" : "secondary"}>
							{statusLabels[finding.status]}
						</Badge>
					</div>

					<Separator />

					{/* Evidence */}
					<div className="space-y-2">
						<span className="text-sm font-medium">{t("complianceRadar.finding.evidence", "Evidence")}</span>
						<div className="rounded-md bg-muted p-3">
							{formatEvidence()}
						</div>
					</div>

					{/* Previous Actions */}
					{finding.acknowledgedBy && (
						<div className="space-y-1">
							<span className="text-sm font-medium">{t("complianceRadar.status.acknowledged", "Acknowledged")}</span>
							<p className="text-sm text-muted-foreground">
								{t("complianceRadar.finding.actionBy", "By {{name}} on {{date}}", {
									name: `${finding.acknowledgedBy.firstName} ${finding.acknowledgedBy.lastName}`,
									date: finding.acknowledgedAt ? DateTime.fromJSDate(finding.acknowledgedAt).toLocaleString(DateTime.DATETIME_SHORT) : "",
								})}
							</p>
							{finding.acknowledgmentNote && (
								<p className="text-sm italic">"{finding.acknowledgmentNote}"</p>
							)}
						</div>
					)}

					{finding.waivedBy && (
						<div className="space-y-1">
							<span className="text-sm font-medium">{t("complianceRadar.status.waived", "Waived")}</span>
							<p className="text-sm text-muted-foreground">
								{t("complianceRadar.finding.actionBy", "By {{name}} on {{date}}", {
									name: `${finding.waivedBy.firstName} ${finding.waivedBy.lastName}`,
									date: finding.waivedAt ? DateTime.fromJSDate(finding.waivedAt).toLocaleString(DateTime.DATETIME_SHORT) : "",
								})}
							</p>
							{finding.waiverReason && (
								<p className="text-sm italic">{t("complianceRadar.finding.reason", "Reason: \"{{reason}}\"", { reason: finding.waiverReason })}</p>
							)}
						</div>
					)}

					{finding.resolvedBy && (
						<div className="space-y-1">
							<span className="text-sm font-medium">{t("complianceRadar.status.resolved", "Resolved")}</span>
							<p className="text-sm text-muted-foreground">
								{t("complianceRadar.finding.actionBy", "By {{name}} on {{date}}", {
									name: `${finding.resolvedBy.firstName} ${finding.resolvedBy.lastName}`,
									date: finding.resolvedAt ? DateTime.fromJSDate(finding.resolvedAt).toLocaleString(DateTime.DATETIME_SHORT) : "",
								})}
							</p>
							{finding.resolutionNote && (
								<p className="text-sm italic">"{finding.resolutionNote}"</p>
							)}
						</div>
					)}

					<Separator />

					{/* Action Form */}
					{(canAcknowledge || canResolve) && !showWaiverForm && (
						<div className="space-y-2">
							<Label htmlFor="note">{t("complianceRadar.finding.noteLabel", "Note (optional)")}</Label>
							<Textarea
								id="note"
								placeholder={t("complianceRadar.finding.notePlaceholder", "Add a note…")}
								value={note}
								onChange={(e) => setNote(e.target.value)}
							/>
						</div>
					)}

					{showWaiverForm && (
						<div className="space-y-2">
							<Label htmlFor="waiverReason">{t("complianceRadar.finding.waiverReasonLabel", "Waiver Reason (required)")}</Label>
							<Textarea
								id="waiverReason"
								placeholder={t("complianceRadar.finding.waiverReasonPlaceholder", "Explain why this finding is being waived…")}
								value={waiverReason}
								onChange={(e) => setWaiverReason(e.target.value)}
							/>
						</div>
					)}
				</div>

				<DialogFooter className="flex-col gap-2 sm:flex-row">
					{showWaiverForm ? (
						<>
							<Button variant="outline" onClick={() => setShowWaiverForm(false)} disabled={isSubmitting}>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button variant="destructive" onClick={handleWaive} disabled={isSubmitting || !waiverReason.trim()}>
								{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
								{t("complianceRadar.finding.confirmWaiver", "Confirm Waiver")}
							</Button>
						</>
					) : (
						<>
							{canAcknowledge && (
								<Button variant="outline" onClick={handleAcknowledge} disabled={isSubmitting}>
									{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
									<IconCheck className="mr-2 size-4" aria-hidden="true" />
									{t("complianceRadar.finding.acknowledge", "Acknowledge")}
								</Button>
							)}
							{canWaive && (
								<Button variant="outline" onClick={() => setShowWaiverForm(true)} disabled={isSubmitting}>
									<IconX className="mr-2 size-4" aria-hidden="true" />
									{t("complianceRadar.finding.waive", "Waive")}
								</Button>
							)}
							{canResolve && (
								<Button onClick={handleResolve} disabled={isSubmitting}>
									{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
									<IconCheck className="mr-2 size-4" aria-hidden="true" />
									{t("complianceRadar.finding.resolve", "Resolve")}
								</Button>
							)}
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
