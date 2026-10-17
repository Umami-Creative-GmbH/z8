"use client";
import { useTranslate } from "@tolgee/react";
import { VacationPolicyConfigurationMessage } from "@/components/absences/vacation-policy-configuration-message";
import { OrganizationTrackingImpact } from "@/components/organization/organization-tracking-impact";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { EmploymentDateUploadOutcome } from "@/lib/employee-lifecycle/employment-date-upload-types";
export function EmploymentDateUploadReview({ outcome }: { outcome: EmploymentDateUploadOutcome }) {
	const { t } = useTranslate();
	if (outcome.status === "invalid_file")
		return (
			<p role="alert" className="text-sm text-destructive">
				{fileError(outcome.code, t)}
				{outcome.missingColumns?.length ? ` ${outcome.missingColumns.join(", ")}` : ""}
			</p>
		);
	const hasErrors = outcome.status === "has_errors";
	return (
		<section
			className="space-y-4"
			aria-label={t("settings.employmentUpload.review-title", "Bulk employment correction review")}
		>
			{hasErrors ? (
				<p role="alert" className="text-sm text-destructive">
					{t(
						"settings.employmentUpload.row-errors",
						"Nothing has been saved. Resolve every row error and blocker, then upload and review the file again.",
					)}
				</p>
			) : (
				<p className="text-sm">
					{t(
						"settings.employmentUpload.review-explanation",
						"Review every supplied joining date and its impact below. The batch saves all rows together; work and absence history, employee tracking exceptions and explicit opening checkpoints are preserved.",
					)}
				</p>
			)}
			<div className="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">{t("settings.employmentUpload.row", "Row")}</TableHead>
							<TableHead scope="col">
								{t("settings.employmentUpload.personnel-number", "Personnel number / employee")}
							</TableHead>
							<TableHead scope="col">
								{t("settings.employmentUpload.old-date", "Current actual joining date")}
							</TableHead>
							<TableHead scope="col">
								{t("settings.employmentUpload.new-date", "Supplied actual joining date")}
							</TableHead>
							<TableHead scope="col">
								{t("settings.employmentUpload.tracking", "Effective tracking start")}
							</TableHead>
							<TableHead scope="col">
								{t("settings.employmentUpload.result", "Review result")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{outcome.rows.map((row) => (
							<TableRow key={row.row}>
								<TableCell>{row.row}</TableCell>
								<TableCell>
									<p className="font-medium">{row.employeeNumber || "—"}</p>
									<p>
										{row.employee?.name ??
											t("settings.employmentUpload.no-match", "No unique match")}
									</p>
									{row.employee && !row.employee.isActive ? (
										<p className="text-muted-foreground">
											{t("settings.employmentUpload.inactive", "Inactive employee")}
										</p>
									) : null}
								</TableCell>
								<TableCell>
									{row.employee?.employmentStartDate ??
										row.impact?.previousEmploymentStartDate ??
										"—"}
								</TableCell>
								<TableCell>{row.suppliedEmploymentStartDate || "—"}</TableCell>
								<TableCell>
									{row.impact?.employees[0]?.oldBoundary ?? "—"} →{" "}
									{row.impact?.employees[0]?.proposedBoundary ?? "—"}
								</TableCell>
								<TableCell>
									{row.errors.length ? (
										<ul
											aria-label={t(
												"settings.employmentUpload.errors-for-row",
												"Errors for row {row}",
												{ row: row.row },
											)}
											className="list-disc pl-4 text-destructive"
										>
											{row.errors.map((error) => (
												<li key={`${error.code}:${error.message}`}>{error.message}</li>
											))}
										</ul>
									) : (
										t("settings.employmentUpload.ready", "Ready for review")
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			{outcome.rows
				.filter((row) => row.impact)
				.map((row) => (
					<details
						key={row.row}
						className="rounded-md border p-3 text-sm"
						open={outcome.rows.length === 1}
					>
						<summary className="cursor-pointer font-medium">
							{t(
								"settings.employmentUpload.employee-impact",
								"Row {row}: {employee} — balance and vacation impact",
								{ row: row.row, employee: row.employee?.name ?? row.employeeNumber },
							)}
						</summary>
						<div className="mt-3 space-y-4">
							<p>
								{t("settings.employmentUpload.provenance", "Reason / source:")} {row.reason}
							</p>
							{row.impact?.vacation.map((vacation) => (
								<div key={vacation.year} className="rounded border p-3">
									<h3 className="font-medium">
										{vacation.year} ·{" "}
										{t("settings.employmentUpload.vacation-days", "Vacation (days)")}
									</h3>
								<VacationPolicyConfigurationMessage
									configuration={vacation.beforeConfiguration}
									label={t("organization.tracking.before", "Before")}
									className="mt-1 text-muted-foreground"
								/>
								<VacationPolicyConfigurationMessage
									configuration={vacation.afterConfiguration}
									label={t("organization.tracking.after", "After")}
									className="mt-1 text-muted-foreground"
								/>

									<dl className="mt-2 grid gap-3 sm:grid-cols-3">
										<div>
											<dt>{t("settings.employmentUpload.allowance", "Annual allowance")}</dt>
											<dd>
												{vacation.before?.allowanceDays ?? "—"} →{" "}
												{vacation.after?.allowanceDays ?? "—"}
											</dd>
										</div>
										<div>
											<dt>{t("settings.employmentUpload.total", "Total before usage")}</dt>
											<dd>
												{vacation.before?.totalDays ?? "—"} → {vacation.after?.totalDays ?? "—"}
											</dd>
										</div>
										<div>
											<dt>{t("settings.employmentUpload.remaining", "Remaining vacation")}</dt>
											<dd>
												{vacation.before?.remainingDays ?? "—"} →{" "}
												{vacation.after?.remainingDays ?? "—"}
											</dd>
										</div>
									</dl>
								</div>
							))}
							{row.impact ? (
								<OrganizationTrackingImpact
									impact={{
										...row.impact,
										employees: row.impact.employees.map((employee) => ({
											...employee,
											vacation: [],
										})),
									}}
									description={t(
										"settings.employmentUpload.work-impact",
										"Review before and after required time, work balances and closed months. Tracking dates and recorded opening checkpoints remain explicit.",
									)}
								/>
							) : null}
						</div>
					</details>
				))}
		</section>
	);
}
function fileError(code: string, t: ReturnType<typeof useTranslate>["t"]): string {
	switch (code) {
		case "missing_columns":
			return t("settings.employmentUpload.missing-columns", "The CSV is missing required columns:");
		case "file_too_large":
			return t(
				"settings.employmentUpload.too-large",
				"The CSV is too large. Use a file of at most 500,000 characters.",
			);
		case "too_many_rows":
			return t(
				"settings.employmentUpload.too-many-rows",
				"Upload at most 200 employees at a time.",
			);
		case "malformed_csv":
			return t(
				"settings.employmentUpload.malformed",
				"The CSV could not be read. Check separators, headers and quoted cells.",
			);
		default:
			return t("settings.employmentUpload.empty", "The CSV has no correction rows.");
	}
}
