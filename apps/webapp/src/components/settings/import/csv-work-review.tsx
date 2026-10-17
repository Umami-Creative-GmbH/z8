"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useState, useTransition } from "react";
import { Temporal } from "temporal-polyfill";
import {
	commitCsvWorkAction,
	decideCsvWorkAction,
	refreshCsvWorkAction,
} from "@/app/[locale]/(app)/settings/import/csv-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useRouter } from "@/navigation";
import { CsvWorkMapping } from "./csv-work-mapping";
import {
	type ImportReviewPaging,
	ImportReviewPagingNav,
} from "./import-review-paging";

export interface CsvReviewRow {
	id: string;
	rowStatus: string;
	issueSeverity: string;
	sourcePayload: Record<string, unknown>;
	normalizedPayload: Record<string, unknown>;
	commitError: string | null;
	decisionReason: string | null;
	commitTargetId: string | null;
}
export interface CsvWorkReviewData {
	batch: {
		status: string;
		selectedScope: Record<string, unknown>;
		errorMessage: string | null;
	};
	summary: {
		total: number;
		accepted: number;
		imported: number;
		skipped: number;
		rejected: number;
		unresolved: number;
	};
	rows: CsvReviewRow[];
	people: { id: string; number: string | null; name: string }[];
	vehicles: { id: string; licencePlate: string; name: string }[];
}
function source(row: CsvReviewRow): Record<string, unknown> {
	const values = row.sourcePayload.values;
	return values && typeof values === "object" && !Array.isArray(values)
		? (values as Record<string, unknown>)
		: {};
}
function endpointText(value: unknown, fallback: unknown): string {
	try {
		if (!value || typeof value !== "object") return String(fallback ?? "—");
		const endpoint = value as { at: string; capture: { timezone: string } };
		return Temporal.Instant.from(endpoint.at)
			.toZonedDateTimeISO(endpoint.capture.timezone)
			.toString({ timeZoneName: "never" });
	} catch {
		return String(fallback ?? "—");
	}
}
const states: Record<string, { key: string; fallback: string }> = {
	staged: {
		key: "settings.import.csv.status.staged",
		fallback: "Awaiting review",
	},
	accepted: {
		key: "settings.import.csv.status.accepted",
		fallback: "Accepted",
	},
	rejected: {
		key: "settings.import.csv.status.rejected",
		fallback: "Rejected",
	},
	needs_mapping: {
		key: "settings.import.csv.status.needs_mapping",
		fallback: "Needs attention",
	},
	blocked: {
		key: "settings.import.csv.status.blocked",
		fallback: "Needs attention",
	},
	committed: {
		key: "settings.import.csv.status.committed",
		fallback: "Imported",
	},
	committing: {
		key: "settings.import.csv.status.committing",
		fallback: "Importing",
	},
	commit_failed: {
		key: "settings.import.csv.status.commit_failed",
		fallback: "Needs attention",
	},
};
const warnings: Record<string, { key: string; fallback: string }> = {
	duplicate_will_skip: {
		key: "settings.import.csv.warning.duplicate_will_skip",
		fallback: "Identical work will be skipped",
	},
	driving_details_missing: {
		key: "settings.import.csv.warning.driving_details_missing",
		fallback: "Driving details missing",
	},
	start_below_last_end: {
		key: "settings.import.csv.warning.start_below_last_end",
		fallback: "Start reading is below the last recorded end reading",
	},
	vehicle_on_other_live_work: {
		key: "settings.import.csv.warning.vehicle_on_other_live_work",
		fallback: "Vehicle is on another employee’s live work",
	},
	speed_above_limit: {
		key: "settings.import.csv.warning.speed_above_limit",
		fallback: "Implied average speed is above 150 km/h",
	},
	distance_above_limit: {
		key: "settings.import.csv.warning.distance_above_limit",
		fallback: "Distance is above 1,500 km",
	},
};

export function CsvWorkReview({
	organizationId,
	batchId,
	view,
	paging,
}: {
	organizationId: string;
	batchId: string;
	view: CsvWorkReviewData;
	paging?: ImportReviewPaging;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const editable = view.batch.status === "needs_review" && !pending;
	const selectedRows = view.rows.filter(
		(row) =>
			selected.includes(row.id) &&
			row.rowStatus !== "committed" &&
			row.rowStatus !== "rejected",
	);
	const validSelected = selectedRows.filter(
		(row) => row.issueSeverity !== "blocking",
	);
	function decide(decision: "accepted" | "rejected") {
		startTransition(async () => {
			setError(null);
			const rowIds = (
				decision === "accepted" ? validSelected : selectedRows
			).map((row) => row.id);
			const result = await decideCsvWorkAction({
				organizationId,
				batchId,
				rowIds,
				decision,
			});
			if (result.success) {
				setSelected([]);
				router.refresh();
			} else setError(result.error);
		});
	}
	const busy =
		view.batch.status === "scanning" || view.batch.status === "committing";
	useEffect(() => {
		if (!busy) return;
		const timer = setInterval(() => router.refresh(), 2000);
		return () => clearInterval(timer);
	}, [busy, router]);
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold">
						{t("settings.import.csv.reviewTitle", "Review CSV completed work")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{String(view.batch.selectedScope.fileName ?? "CSV")} ·{" "}
						{t(
							"settings.import.csv.fileTimezone",
							"Timezone for local timestamps",
						)}
						:{" "}
						{String(
							view.batch.selectedScope.timezone ??
								t("settings.import.csv.offsetsOnly", "explicit offsets only"),
						)}
					</p>
				</div>
				<Button
					disabled={
						pending ||
						view.batch.status !== "needs_review" ||
						view.summary.accepted === 0
					}
					onClick={() =>
						startTransition(async () => {
							setError(null);
							const result = await commitCsvWorkAction({
								organizationId,
								batchId,
							});
							if (!result.success) setError(result.error);
							else router.refresh();
						})
					}
				>
					{t("settings.import.csv.commit", "Commit accepted rows")}
				</Button>
			</div>
			{busy ? (
				<p role="status">
					{view.batch.status === "scanning"
						? t("settings.import.csv.scanning", "Preparing the review…")
						: t("settings.import.csv.committing", "Importing accepted rows…")}
				</p>
			) : null}
			{error || view.batch.errorMessage ? (
				<p role="alert" className="text-sm text-destructive">
					{error ?? view.batch.errorMessage}
				</p>
			) : null}
			<div className="grid grid-cols-2 gap-3 md:grid-cols-6">
				{(
					[
						{
							name: "total",
							key: "settings.import.csv.summary.total",
							fallback: "Total rows",
						},
						{
							name: "accepted",
							key: "settings.import.csv.summary.accepted",
							fallback: "Accepted",
						},
						{
							name: "imported",
							key: "settings.import.csv.summary.imported",
							fallback: "Imported",
						},
						{
							name: "skipped",
							key: "settings.import.csv.summary.skipped",
							fallback: "Skipped duplicates",
						},
						{
							name: "rejected",
							key: "settings.import.csv.summary.rejected",
							fallback: "Rejected",
						},
						{
							name: "unresolved",
							key: "settings.import.csv.summary.unresolved",
							fallback: "Unresolved",
						},
					] as const
				).map((item) => (
					<Card key={item.name} className="gap-2 py-4 shadow-none">
						<CardHeader className="px-4">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								{t(item.key, item.fallback)}
							</CardTitle>
						</CardHeader>
						<CardContent className="px-4 text-2xl font-semibold tabular-nums">
							{view.summary[item.name]}
						</CardContent>
					</Card>
				))}
			</div>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.import.csv.partialHelp",
					"Accepted valid rows can be imported while other rows remain unresolved. Correct malformed timestamps or numbers in the CSV and re-upload; work already imported will be skipped.",
				)}
			</p>
			<CsvWorkMapping
				organizationId={organizationId}
				batchId={batchId}
				view={view}
				disabled={!editable}
				onSuccess={() => {
					setSelected([]);
					setError(null);
					router.refresh();
				}}
				onError={setError}
			/>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					disabled={!editable || validSelected.length === 0}
					onClick={() => decide("accepted")}
				>
					{t(
						"settings.import.csv.acceptSelected",
						"Accept selected valid rows",
					)}
				</Button>
				<Button
					variant="outline"
					disabled={!editable || selectedRows.length === 0}
					onClick={() => decide("rejected")}
				>
					{t("settings.import.csv.rejectSelected", "Reject selected rows")}
				</Button>
				<Button
					variant="outline"
					disabled={pending || busy || view.summary.unresolved === 0}
					onClick={() =>
						startTransition(async () => {
							setError(null);
							const result = await refreshCsvWorkAction({
								organizationId,
								batchId,
							});
							if (result.success) {
								setSelected([]);
								router.refresh();
							} else setError(result.error);
						})
					}
				>
					{t("settings.import.csv.recheck", "Recheck unresolved rows")}
				</Button>
			</div>
			<div className="overflow-x-auto rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>
								<input
									type="checkbox"
									aria-label={t(
										"settings.import.csv.selectPage",
										"Select all rows on this page",
									)}
									disabled={
										!editable ||
										!view.rows.some(
											(row) =>
												row.rowStatus !== "committed" &&
												row.rowStatus !== "rejected",
										)
									}
									checked={
										view.rows.some(
											(row) =>
												row.rowStatus !== "committed" &&
												row.rowStatus !== "rejected",
										) &&
										view.rows
											.filter(
												(row) =>
													row.rowStatus !== "committed" &&
													row.rowStatus !== "rejected",
											)
											.every((row) => selected.includes(row.id))
									}
									onChange={(event) =>
										setSelected(
											event.target.checked
												? view.rows
														.filter(
															(row) =>
																row.rowStatus !== "committed" &&
																row.rowStatus !== "rejected",
														)
														.map((row) => row.id)
												: [],
										)
									}
								/>
							</TableHead>
							<TableHead>{t("settings.import.csv.row", "CSV row")}</TableHead>
							<TableHead>
								{t("settings.import.csv.person", "Employee")}
							</TableHead>
							<TableHead>
								{t("settings.import.csv.interval", "Event-local start and end")}
							</TableHead>
							<TableHead>
								{t("settings.import.csv.vehicle", "Vehicle use")}
							</TableHead>
							<TableHead>
								{t("settings.import.csv.outcome", "Status and issues")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{view.rows.map((row) => {
							const values = source(row);
							const person = view.people.find(
								(candidate) =>
									candidate.id === row.normalizedPayload.employeeId,
							);
							const rowWarnings = Array.isArray(row.normalizedPayload.warnings)
								? row.normalizedPayload.warnings
								: [];
							const use =
								row.normalizedPayload.vehicleUse &&
								typeof row.normalizedPayload.vehicleUse === "object"
									? (row.normalizedPayload.vehicleUse as {
											vehicle?: { kind?: string; vehicleId?: string };
											distanceKm?: number | null;
										})
									: null;
							const vehicle = view.vehicles.find(
								(candidate) => candidate.id === use?.vehicle?.vehicleId,
							);
							return (
								<TableRow key={row.id}>
									<TableCell>
										<input
											type="checkbox"
											aria-label={`${t("settings.import.csv.selectRow", "Select CSV row")} ${String(row.sourcePayload.rowNumber)}`}
											disabled={
												!editable ||
												row.rowStatus === "committed" ||
												row.rowStatus === "rejected"
											}
											checked={selected.includes(row.id)}
											onChange={(event) =>
												setSelected((previous) =>
													event.target.checked
														? [...previous, row.id]
														: previous.filter((id) => id !== row.id),
												)
											}
										/>
									</TableCell>
									<TableCell className="tabular-nums">
										{String(row.sourcePayload.rowNumber ?? "—")}
									</TableCell>
									<TableCell>
										<div>
											{person?.name ?? String(values.personnel_number ?? "—")}
										</div>
										{person ? (
											<div className="text-xs text-muted-foreground">
												{String(values.personnel_number)}
											</div>
										) : null}
									</TableCell>
									<TableCell className="whitespace-nowrap text-xs">
										<div>
											{endpointText(
												row.normalizedPayload.start,
												values.starts_at,
											)}
										</div>
										<div>
											{endpointText(row.normalizedPayload.end, values.ends_at)}
										</div>
									</TableCell>
									<TableCell className="text-xs">
										<div>
											{values.vehicle_kind === "own"
												? t("settings.import.csv.ownVehicle", "Own vehicle")
												: vehicle
													? `${vehicle.name} · ${vehicle.licencePlate}`
													: String(values.licence_plate || "—")}
										</div>
										<div>
											{String(values.odometer_start_km || "—")} →{" "}
											{String(values.odometer_end_km || "—")} km
											{(use?.distanceKm ?? values.distance_km) !== null &&
											(use?.distanceKm ?? values.distance_km) !== undefined &&
											(use?.distanceKm ?? values.distance_km) !== ""
												? ` · ${String(use?.distanceKm ?? values.distance_km)} km`
												: ""}
											{vehicle &&
											values.licence_plate !== vehicle.licencePlate ? (
												<div className="text-muted-foreground">
													{t("settings.import.csv.sourcePlate", "Source plate")}
													: {String(values.licence_plate)}
												</div>
											) : null}
										</div>
									</TableCell>
									<TableCell className="max-w-sm whitespace-normal text-sm">
										<div>
											{row.decisionReason === "duplicate"
												? t(
														"settings.import.csv.duplicateSkipped",
														"Skipped duplicate",
													)
												: t(
														(states[row.rowStatus] ?? states.needs_mapping).key,
														(states[row.rowStatus] ?? states.needs_mapping)
															.fallback,
													)}
										</div>
										{row.commitError ? (
											<p
												className={
													row.issueSeverity === "blocking"
														? "text-destructive"
														: "text-muted-foreground"
												}
											>
												{row.commitError}
											</p>
										) : null}
										{rowWarnings.map((warning) => {
											const code =
												warning &&
												typeof warning === "object" &&
												"code" in warning
													? String(warning.code)
													: "";
											return (
												<p key={code} className="text-xs text-muted-foreground">
													{t(
														(warnings[code] ?? warnings.driving_details_missing)
															.key,
														(warnings[code] ?? warnings.driving_details_missing)
															.fallback,
													)}
												</p>
											);
										})}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
			<ImportReviewPagingNav
				batchId={batchId}
				paging={paging}
				label={t("settings.import.csv.pages", "CSV review pages")}
			/>
		</div>
	);
}
