import { IconCalendar, IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import type { useTranslate } from "@tolgee/react";
import type { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EmploymentHistoryEntry } from "./types";
import {
	canCancel,
	canConfirm,
	formatCurrency,
	formatDate,
	formatWeeklyHours,
	isCurrentConfirmed,
} from "./utils";

type Translate = ReturnType<typeof useTranslate>["t"];

export function EmploymentHistoryContext({
	entry,
	label,
	empty,
	t,
	policyNameById,
}: {
	entry?: EmploymentHistoryEntry;
	label: string;
	empty: string;
	t: Translate;
	policyNameById: Map<string, string>;
}) {
	const policyName =
		entry?.workPolicy?.name ?? (entry?.workPolicyId && policyNameById.get(entry.workPolicyId));
	return (
		<div className="rounded-lg border p-4">
			<div className="mb-2 text-sm text-muted-foreground">{label}</div>
			{entry ? (
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="default">
							{t("settings.employmentHistory.weeklyHoursValue", "{hours} / week", {
								hours: formatWeeklyHours(entry.weeklyContractMinutes),
							})}
						</Badge>
						<Badge variant="outline">{entry.workModel}</Badge>
						<Badge variant="secondary">{entry.contractType}</Badge>
					</div>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<IconCalendar className="size-3" aria-hidden="true" />
						<span>
							{t("settings.employmentHistory.effectiveDateValue", "Effective {date}", {
								date: formatDate(entry.validFrom) ?? t("common.present", "Present"),
							})}
						</span>
					</div>
					{entry.contractType === "hourly" && entry.hourlyRate && (
						<div className="text-sm">
							{t("settings.employmentHistory.hourlyRateValue", "{rate} / hour", {
								rate: formatCurrency(entry.hourlyRate, entry.currency),
							})}
						</div>
					)}
					{policyName && (
						<div className="text-sm text-muted-foreground">
							{t("settings.employmentHistory.policyValue", "Policy: {policyName}", { policyName })}
						</div>
					)}
				</div>
			) : (
				<div className="text-sm text-muted-foreground">{empty}</div>
			)}
		</div>
	);
}

export function EmploymentHistoryTimeline({
	history,
	canManage,
	isMutating,
	now,
	onConfirm,
	onCancel,
	t,
	policyNameById,
}: {
	history: EmploymentHistoryEntry[];
	canManage: boolean;
	isMutating: boolean;
	now: DateTime;
	onConfirm: (historyId: string) => void;
	onCancel: (historyId: string) => void;
	t: Translate;
	policyNameById: Map<string, string>;
}) {
	return (
		<div className="space-y-3">
			<div className="text-sm font-medium">
				{t("settings.employmentHistory.timeline", "Timeline")}
			</div>
			{history.length === 0 ? (
				<div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
					{t("settings.employmentHistory.emptyTimeline", "No contract or work-model history yet.")}
				</div>
			) : (
				<div className="space-y-3">
					{history.map((entry) => (
						<TimelineRow
							key={entry.id}
							entry={entry}
							canManage={canManage}
							isMutating={isMutating}
							now={now}
							onConfirm={onConfirm}
							onCancel={onCancel}
							t={t}
							policyNameById={policyNameById}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function TimelineRow({
	entry,
	canManage,
	isMutating,
	now,
	onConfirm,
	onCancel,
	t,
	policyNameById,
}: {
	entry: EmploymentHistoryEntry;
	canManage: boolean;
	isMutating: boolean;
	now: DateTime;
	onConfirm: (historyId: string) => void;
	onCancel: (historyId: string) => void;
	t: Translate;
	policyNameById: Map<string, string>;
}) {
	const current = isCurrentConfirmed(entry, now);
	const hourlyRate = formatCurrency(entry.hourlyRate, entry.currency);
	const policyName =
		entry.workPolicy?.name ?? (entry.workPolicyId && policyNameById.get(entry.workPolicyId));
	return (
		<div className="rounded-lg border p-4">
			<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<span className={cn("font-medium", current && "text-primary")}>
							{t("settings.employmentHistory.weeklyHoursValue", "{hours} / week", {
								hours: formatWeeklyHours(entry.weeklyContractMinutes),
							})}
						</span>
						<Badge variant={entry.reviewState === "confirmed" ? "default" : "secondary"}>
							{entry.reviewState}
						</Badge>
						{current && <Badge variant="outline">{t("common.current", "Current")}</Badge>}
					</div>
					<div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
						<span>{entry.workModel}</span>
						<span aria-hidden="true">·</span>
						<span>{entry.contractType}</span>
						{hourlyRate && (
							<>
								<span aria-hidden="true">·</span>
								<span>
									{t("settings.employmentHistory.hourlyRateValue", "{rate} / hour", {
										rate: hourlyRate,
									})}
								</span>
							</>
						)}
					</div>
					<div className="text-xs text-muted-foreground">
						{formatDate(entry.validFrom)} -{" "}
						{entry.validUntil ? formatDate(entry.validUntil) : t("common.present", "Present")}
					</div>
					{entry.probationStartsOn && entry.probationEndsOn && (
						<div className="text-xs text-muted-foreground">
							{t("settings.employmentHistory.probationRange", "Probation {startDate} - {endDate}", {
								startDate: formatDate(entry.probationStartsOn) ?? "",
								endDate: formatDate(entry.probationEndsOn) ?? "",
							})}
						</div>
					)}
					{entry.changeReason && (
						<div className="text-sm text-muted-foreground">{entry.changeReason}</div>
					)}
					{policyName && (
						<div className="text-xs text-muted-foreground">
							{t("settings.employmentHistory.policyValue", "Policy: {policyName}", { policyName })}
						</div>
					)}
				</div>
				{canManage && (canConfirm(entry) || canCancel(entry, now)) && (
					<div className="flex gap-2">
						{canConfirm(entry) && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => onConfirm(entry.id)}
								disabled={isMutating}
							>
								{isMutating ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconCheck className="mr-2 size-4" aria-hidden="true" />
								)}
								{t("common.confirm", "Confirm")}
							</Button>
						)}
						{canCancel(entry, now) && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => onCancel(entry.id)}
								disabled={isMutating}
							>
								<IconX className="mr-2 size-4" aria-hidden="true" />
								{t("common.cancel", "Cancel")}
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
