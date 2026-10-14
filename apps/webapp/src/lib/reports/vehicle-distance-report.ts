/**
 * Distance per vehicle report (#1129, spec #807): driven kilometres per vehicle
 * and per employee per month. Every own vehicle counts as one "own vehicle";
 * archived organization vehicles stay in the months they were driven. A work
 * period counts in the month of its event-local start day (the offset stored on
 * its clock-in entry), never the viewer's zone. Client-safe: the server loader
 * is `vehicle-distance-work.ts`.
 */

import { Temporal } from "temporal-polyfill";
import type { PlainDate } from "@/lib/datetime/temporal-core";
import type { ReportDocument } from "./exporters/report-document";

export type VehicleDistanceVehicle =
	| { kind: "own" }
	| { kind: "organization"; id: string; name: string; licencePlate: string; archived: boolean };

/** One completed work period with a driven distance. */
export interface VehicleDistanceWork {
	employeeId: string;
	employeeName: string;
	vehicle: VehicleDistanceVehicle;
	/** The event-local day the work started on. */
	workDay: PlainDate;
	distanceKm: number;
}

export interface VehicleDistanceEmployeeRow {
	employeeId: string;
	employeeName: string;
	/** Kilometres per month, aligned with `VehicleDistanceReport.months`. */
	monthlyKm: number[];
	totalKm: number;
}

export interface VehicleDistanceGroup {
	vehicle: VehicleDistanceVehicle;
	monthlyKm: number[];
	totalKm: number;
	employees: VehicleDistanceEmployeeRow[];
}

export interface VehicleDistanceReport {
	period: { fromDay: string; toDay: string };
	/** Every month of the period as `YYYY-MM`, also months without driving. */
	months: string[];
	vehicles: VehicleDistanceGroup[];
	monthlyKm: number[];
	totalKm: number;
}

const OWN_VEHICLE_KEY = "own";

function vehicleKey(vehicle: VehicleDistanceVehicle): string {
	return vehicle.kind === "own" ? OWN_VEHICLE_KEY : `organization:${vehicle.id}`;
}

/** The months from the first day's month to the last day's month, as `YYYY-MM`. */
export function reportMonths(fromDay: PlainDate, toDay: PlainDate): string[] {
	const months: string[] = [];
	const last = toDay.toPlainYearMonth();
	for (
		let month = fromDay.toPlainYearMonth();
		Temporal.PlainYearMonth.compare(month, last) <= 0;
		month = month.add({ months: 1 })
	) {
		months.push(month.toString());
	}
	return months;
}

function compareVehicles(a: VehicleDistanceVehicle, b: VehicleDistanceVehicle): number {
	if (a.kind === "own" || b.kind === "own") {
		return (a.kind === "own" ? 1 : 0) - (b.kind === "own" ? 1 : 0);
	}
	return (
		a.name.localeCompare(b.name) ||
		a.licencePlate.localeCompare(b.licencePlate) ||
		a.id.localeCompare(b.id)
	);
}

export function buildVehicleDistanceReport(input: {
	fromDay: PlainDate;
	toDay: PlainDate;
	work: readonly VehicleDistanceWork[];
}): VehicleDistanceReport {
	const months = reportMonths(input.fromDay, input.toDay);
	const monthIndex = new Map(months.map((month, index) => [month, index]));
	const zeros = () => months.map(() => 0);
	const groups = new Map<
		string,
		{ vehicle: VehicleDistanceVehicle; employees: Map<string, VehicleDistanceEmployeeRow> }
	>();

	for (const item of input.work) {
		const index = monthIndex.get(item.workDay.toPlainYearMonth().toString());
		if (index === undefined) continue;
		const key = vehicleKey(item.vehicle);
		let group = groups.get(key);
		if (!group) {
			group = { vehicle: item.vehicle, employees: new Map() };
			groups.set(key, group);
		}
		let row = group.employees.get(item.employeeId);
		if (!row) {
			row = {
				employeeId: item.employeeId,
				employeeName: item.employeeName,
				monthlyKm: zeros(),
				totalKm: 0,
			};
			group.employees.set(item.employeeId, row);
		}
		row.monthlyKm[index] += item.distanceKm;
		row.totalKm += item.distanceKm;
	}

	const vehicles = [...groups.values()]
		.map((group): VehicleDistanceGroup => {
			const employees = [...group.employees.values()].sort(
				(a, b) =>
					a.employeeName.localeCompare(b.employeeName) || a.employeeId.localeCompare(b.employeeId),
			);
			const monthlyKm = zeros();
			for (const row of employees) {
				row.monthlyKm.forEach((km, index) => {
					monthlyKm[index] += km;
				});
			}
			return {
				vehicle: group.vehicle,
				monthlyKm,
				totalKm: employees.reduce((sum, row) => sum + row.totalKm, 0),
				employees,
			};
		})
		.sort((a, b) => compareVehicles(a.vehicle, b.vehicle));

	const monthlyKm = zeros();
	for (const group of vehicles) {
		group.monthlyKm.forEach((km, index) => {
			monthlyKm[index] += km;
		});
	}
	return {
		period: { fromDay: input.fromDay.toString(), toDay: input.toDay.toString() },
		months,
		vehicles,
		monthlyKm,
		totalKm: vehicles.reduce((sum, group) => sum + group.totalKm, 0),
	};
}

/** The export's text in the viewer's language. */
export interface VehicleDistanceExportLabels {
	title: string;
	period: string;
	generatedAt: string;
	table: string;
	vehicle: string;
	licencePlate: string;
	employee: string;
	total: string;
	ownVehicle: string;
	archived: string;
	note: string;
	footer: string;
	/** A `YYYY-MM` month as a column header. */
	monthLabel: (month: string) => string;
}

export function vehicleDistanceVehicleName(
	vehicle: VehicleDistanceVehicle,
	labels: Pick<VehicleDistanceExportLabels, "ownVehicle" | "archived">,
): string {
	if (vehicle.kind === "own") return labels.ownVehicle;
	return vehicle.archived ? `${vehicle.name} (${labels.archived})` : vehicle.name;
}

/** The report as a CSV/Excel/PDF document: one row per vehicle and employee. */
export function buildVehicleDistanceReportDocument(
	report: VehicleDistanceReport,
	context: { labels: VehicleDistanceExportLabels; periodLabel: string; generatedAt: string },
): ReportDocument {
	const { labels } = context;
	return {
		title: labels.title,
		facts: [
			{ label: labels.period, value: context.periodLabel },
			{ label: labels.generatedAt, value: context.generatedAt },
		],
		tables: [
			{
				title: labels.table,
				columns: [
					{ key: "vehicle", header: labels.vehicle, kind: "text" },
					{ key: "licencePlate", header: labels.licencePlate, kind: "text" },
					{ key: "employee", header: labels.employee, kind: "text" },
					...report.months.map((month) => ({
						key: month,
						header: labels.monthLabel(month),
						kind: "count" as const,
					})),
					{ key: "total", header: labels.total, kind: "count" },
				],
				rows: report.vehicles.flatMap((group) =>
					group.employees.map((row) => [
						vehicleDistanceVehicleName(group.vehicle, labels),
						group.vehicle.kind === "own" ? "" : group.vehicle.licencePlate,
						row.employeeName,
						...row.monthlyKm,
						row.totalKm,
					]),
				),
				totals: [labels.total, "", "", ...report.monthlyKm, report.totalKm],
			},
		],
		notes: [labels.note],
		unknownLabel: "",
		fileStem: labels.title,
		footer: `${labels.footer} | ${context.generatedAt}`,
	};
}
