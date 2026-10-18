"use client";

import { useTranslate } from "@tolgee/react";
import type { Dispatch, SetStateAction } from "react";
import { Temporal } from "temporal-polyfill";
import { TableCell, TableRow } from "@/components/ui/table";
import type { CsvReviewRow, CsvWorkReviewData } from "./csv-work-review";

type SourceValues = Record<string, unknown>;
interface CsvVehicleUse {
	vehicle?: { kind?: string; vehicleId?: string };
	distanceKm?: number | null;
}

function source(row: CsvReviewRow): SourceValues {
	const values = row.sourcePayload.values;
	return values && typeof values === "object" && !Array.isArray(values)
		? (values as SourceValues)
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

function warningCode(warning: unknown): string {
	return warning && typeof warning === "object" && "code" in warning ? String(warning.code) : "";
}

export function CsvWorkReviewRow({
	row,
	view,
	editable,
	checked,
	setSelected,
}: {
	row: CsvReviewRow;
	view: CsvWorkReviewData;
	editable: boolean;
	checked: boolean;
	setSelected: Dispatch<SetStateAction<string[]>>;
}) {
	const { t } = useTranslate();
	const values = source(row);
	const person = view.people.find((candidate) => candidate.id === row.normalizedPayload.employeeId);
	const use =
		row.normalizedPayload.vehicleUse && typeof row.normalizedPayload.vehicleUse === "object"
			? (row.normalizedPayload.vehicleUse as CsvVehicleUse)
			: null;
	const vehicle = view.vehicles.find((candidate) => candidate.id === use?.vehicle?.vehicleId);
	return (
		<TableRow>
			<TableCell>
				<input
					type="checkbox"
					aria-label={`${t("settings.import.csv.selectRow", "Select CSV row")} ${String(row.sourcePayload.rowNumber)}`}
					disabled={!editable || row.rowStatus === "committed" || row.rowStatus === "rejected"}
					checked={checked}
					onChange={(event) =>
						setSelected((previous) =>
							event.target.checked ? [...previous, row.id] : previous.filter((id) => id !== row.id),
						)
					}
				/>
			</TableCell>
			<TableCell className="tabular-nums">{String(row.sourcePayload.rowNumber ?? "—")}</TableCell>
			<CsvRowPersonCell values={values} person={person} />
			<TableCell className="whitespace-nowrap text-xs">
				<div>{endpointText(row.normalizedPayload.start, values.starts_at)}</div>
				<div>{endpointText(row.normalizedPayload.end, values.ends_at)}</div>
			</TableCell>
			<CsvRowVehicleCell values={values} use={use} vehicle={vehicle} />
			<CsvRowOutcomeCell row={row} />
		</TableRow>
	);
}

function CsvRowPersonCell({
	values,
	person,
}: {
	values: SourceValues;
	person: CsvWorkReviewData["people"][number] | undefined;
}) {
	return (
		<TableCell>
			<div>{person?.name ?? String(values.personnel_number ?? "—")}</div>
			{person ? (
				<div className="text-xs text-muted-foreground">{String(values.personnel_number)}</div>
			) : null}
		</TableCell>
	);
}

function CsvRowVehicleCell({
	values,
	use,
	vehicle,
}: {
	values: SourceValues;
	use: CsvVehicleUse | null;
	vehicle: CsvWorkReviewData["vehicles"][number] | undefined;
}) {
	const { t } = useTranslate();
	const distance = use?.distanceKm ?? values.distance_km;
	return (
		<TableCell className="text-xs">
			<div>
				{values.vehicle_kind === "own"
					? t("settings.import.csv.ownVehicle", "Own vehicle")
					: vehicle
						? `${vehicle.name} · ${vehicle.licencePlate}`
						: String(values.licence_plate || "—")}
			</div>
			<div>
				{String(values.odometer_start_km || "—")} → {String(values.odometer_end_km || "—")} km
				{distance !== null && distance !== undefined && distance !== ""
					? ` · ${String(distance)} km`
					: ""}
				{vehicle && values.licence_plate !== vehicle.licencePlate ? (
					<div className="text-muted-foreground">
						{t("settings.import.csv.sourcePlate", "Source plate")}: {String(values.licence_plate)}
					</div>
				) : null}
			</div>
		</TableCell>
	);
}

function CsvRowOutcomeCell({ row }: { row: CsvReviewRow }) {
	const { t } = useTranslate();
	const state = states[row.rowStatus] ?? states.needs_mapping;
	const rowWarnings = Array.isArray(row.normalizedPayload.warnings)
		? row.normalizedPayload.warnings
		: [];
	return (
		<TableCell className="max-w-sm whitespace-normal text-sm">
			<div>
				{row.decisionReason === "duplicate"
					? t("settings.import.csv.duplicateSkipped", "Skipped duplicate")
					: t(state.key, state.fallback)}
			</div>
			{row.commitError ? (
				<p
					className={
						row.issueSeverity === "blocking" ? "text-destructive" : "text-muted-foreground"
					}
				>
					{row.commitError}
				</p>
			) : null}
			{rowWarnings.map((warning) => {
				const code = warningCode(warning);
				const entry = warnings[code] ?? warnings.driving_details_missing;
				return (
					<p key={code} className="text-xs text-muted-foreground">
						{t(entry.key, entry.fallback)}
					</p>
				);
			})}
		</TableCell>
	);
}
