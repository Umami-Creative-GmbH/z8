"use client";
import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";
import {
	DrivingClassReason,
	DrivingClassStatusLabel,
	DrivingLicenceCheckEvidence,
	DrivingStatusLabel,
} from "./check-evidence";
import { DrivingDeadlineDate } from "./deadline-date";
import { DrivingLicenceHistoryPanel } from "./history-panel";
import { ReportDrivingImpediment } from "./report-impediment";

/** Each class with its state, valid-through date (in its saved zone) and restrictions. */
export function DrivingLicenceStatusSummary({
	record,
	audience = "employee",
}: {
	record: Pick<DrivingLicenceEmployeeRecord, "status" | "classes" | "personWideReason">;
	/** The verifier's check page (#1429) words the empty state for someone else's record. */
	audience?: "employee" | "verifier";
}) {
	const { t } = useTranslate();
	const titleId = useId();
	const explained = record.classes.filter((entry) => entry.status !== "active" && entry.reason);
	return (
		<Card role="region" aria-labelledby={titleId}>
			<CardHeader>
				<CardTitle>
					<h2 id={titleId} className="text-lg font-semibold">
						<DrivingStatusLabel status={record.status} />
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.status.explanation",
						"Organization driving authorization covers the listed classes and restrictions. It does not establish suitability for every vehicle. You can continue recording working time and actual vehicle use.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{record.personWideReason ? (
					<p className="text-sm font-medium">
						{t(
							"drivingLicence.summary.personWide",
							"An impediment suspends driving in every class until a verifier reinstates it. A new check alone does not lift it.",
						)}
					</p>
				) : null}
				{record.classes.length ? (
					<Table mobileLayout="stacked">
						<TableHeader>
							<TableRow>
								<TableHead>{t("drivingLicence.summary.class", "Class")}</TableHead>
								<TableHead>{t("drivingLicence.summary.status", "Status")}</TableHead>
								<TableHead>{t("drivingLicence.summary.validThrough", "Valid through")}</TableHead>
								<TableHead>{t("drivingLicence.summary.restrictions", "Restrictions")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{record.classes.map((entry) => (
								<TableRow key={entry.code}>
									<TableCell className="font-medium" translate="no">
										{entry.code}
									</TableCell>
									<TableCell>
										<DrivingClassStatusLabel status={entry.status} />
									</TableCell>
									<TableCell>
										<DrivingDeadlineDate
											validThrough={entry.validThrough}
											timezone={entry.deadlineTimezone}
										/>
									</TableCell>
									<TableCell className="break-words">{entry.restrictions || "—"}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				) : (
					<p className="text-sm text-muted-foreground">
						{audience === "verifier"
							? t("drivingLicence.summary.emptyForVerifier", "No class is authorized yet.")
							: t(
									"drivingLicence.summary.empty",
									"No class is authorized yet. A verifier records your first original check.",
								)}
					</p>
				)}
				{explained.length ? (
					<ul className="space-y-1 text-sm text-muted-foreground">
						{explained.map((entry) => (
							<li key={entry.code}>
								<strong className="text-foreground" translate="no">
									{entry.code}
								</strong>
								{": "}
								<DrivingClassReason reason={entry.reason ?? ""} />
							</li>
						))}
					</ul>
				) : null}
			</CardContent>
		</Card>
	);
}

/**
 * The My licence tab (#1428): the per-class status first, then the original check evidence,
 * the history with the evidence PDF export, and *Unable to drive?*. A former intended driver
 * whose records are retained gets the same records read-only, without the report.
 */
export function MyDrivingLicence({
	record,
	employeeId,
	intendedDriver,
}: {
	record: DrivingLicenceEmployeeRecord;
	employeeId: string;
	intendedDriver: boolean;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-6">
			{!intendedDriver ? (
				<Alert>
					<IconInfoCircle aria-hidden="true" />
					<AlertDescription>
						{t(
							"drivingLicence.myLicence.former",
							"You are no longer an intended driver. Your retained check records stay available to view and export.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{record.uncertainEmailCount > 0 ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"drivingLicence.delivery.uncertain",
						"Optional reminder emails to you have an uncertain delivery outcome ({count}). They will not be sent again automatically. Your in-app reminders remain available; email delivery does not confirm reading.",
						{ count: record.uncertainEmailCount },
					)}
				</p>
			) : null}
			<DrivingLicenceStatusSummary record={record} />
			<DrivingLicenceCheckEvidence record={record} />
			<DrivingLicenceHistoryPanel employeeId={employeeId} />
			{intendedDriver ? <ReportDrivingImpediment /> : null}
		</div>
	);
}
