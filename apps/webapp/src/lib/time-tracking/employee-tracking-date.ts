import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { employee, employeeTrackingSettings, organizationTrackingSettings } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { AbsenceDaysDatabase } from "@/lib/absences/absence-days-resolver";
import type { WorkBalanceDatabase, WorkBalanceDbClient } from "@/lib/work-balance/db-client";
import {
	assertTrackingDateAdministrator,
	commitReviewedTrackingChange,
	loadTrackingDateImpact,
	type ReviewScope,
} from "./tracking-date-review";
import { TrackingDateRefusal, type TrackingDateImpact } from "./tracking-date-review-types";
import { loadEmployeeTrackingContext } from "./tracking-start";

export type EmployeeTrackingProposal = { employeeId: string; trackingStartDate: string | null };
export interface EmployeeTrackingDateSettings {
	employmentStartDate: string | null;
	organizationTrackingStartDate: string | null;
	employeeTrackingStartDate: string | null;
	effectiveTrackingStartDate: string | null;
	active: boolean;
	revision: number;
}
export async function loadEmployeeTrackingDateSettings(
	client: WorkBalanceDbClient,
	input: { organizationId: string; employeeId: string },
): Promise<EmployeeTrackingDateSettings> {
	const [row] = await client
		.select({
			employmentStart: employee.startDate,
			organizationDate: organizationTrackingSettings.trackingStartDate,
			activatedAt: organizationTrackingSettings.activatedAt,
			exception: employeeTrackingSettings.trackingStartDate,
			revision: employeeTrackingSettings.revision,
		})
		.from(employee)
		.leftJoin(
			organizationTrackingSettings,
			eq(organizationTrackingSettings.organizationId, employee.organizationId),
		)
		.leftJoin(
			employeeTrackingSettings,
			and(
				eq(employeeTrackingSettings.organizationId, employee.organizationId),
				eq(employeeTrackingSettings.employeeId, employee.id),
			),
		)
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
		);
	if (!row) throw new TrackingDateRefusal("not_permitted", "This employee is not available.");
	const context = await loadEmployeeTrackingContext(client, input);
	return {
		employmentStartDate: row.employmentStart
			? plainDateAt(instantFromDate(row.employmentStart), "UTC").toString()
			: null,
		organizationTrackingStartDate: row.activatedAt ? row.organizationDate : null,
		employeeTrackingStartDate: row.exception,
		effectiveTrackingStartDate: context?.startDate ?? null,
		active: !!row.activatedAt,
		revision: row.revision ?? 0,
	};
}
function parseProposal(input: EmployeeTrackingProposal): EmployeeTrackingProposal {
	if (
		typeof input.employeeId !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.employeeId)
	)
		throw new TrackingDateRefusal("not_permitted", "This employee is not available.");
	try {
		return {
			employeeId: input.employeeId,
			trackingStartDate:
				input.trackingStartDate === null
					? null
					: parsePlainDate(input.trackingStartDate).toString(),
		};
	} catch {
		throw new TrackingDateRefusal(
			"invalid_input",
			"Choose a valid calendar date or use the organization default.",
		);
	}
}
async function planEmployeeTrackingDate(
	client: AbsenceDaysDatabase,
	input: ReviewScope & EmployeeTrackingProposal,
): Promise<TrackingDateImpact> {
	const settings = await loadEmployeeTrackingDateSettings(client, input);
	if (!settings.active || !settings.organizationTrackingStartDate)
		throw new TrackingDateRefusal(
			"invalid_input",
			"Activate explicit organization tracking before setting an employee exception.",
		);
	const minimum =
		settings.employmentStartDate &&
		settings.employmentStartDate > settings.organizationTrackingStartDate
			? settings.employmentStartDate
			: settings.organizationTrackingStartDate;
	if (input.trackingStartDate && input.trackingStartDate < minimum)
		throw new TrackingDateRefusal(
			"invalid_input",
			`The employee exception cannot be before ${minimum}, the later of organization tracking and actual employment start.`,
		);
	return loadTrackingDateImpact(client, {
		...input,
		trackingStartDate: settings.organizationTrackingStartDate,
		employeeTrackingStartDateOverride: input.trackingStartDate,
	});
}
export async function previewEmployeeTrackingDate(
	database: WorkBalanceDatabase,
	input: ReviewScope & EmployeeTrackingProposal,
): Promise<TrackingDateImpact> {
	const proposal = parseProposal(input);
	return database.transaction(
		async (tx) => {
			await assertTrackingDateAdministrator(tx, input);
			return planEmployeeTrackingDate(tx, { ...input, ...proposal });
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}
export async function commitEmployeeTrackingDate(
	database: WorkBalanceDatabase,
	input: ReviewScope & EmployeeTrackingProposal & { fingerprint: string; reason: string },
): Promise<TrackingDateImpact> {
	const proposal = parseProposal(input);
	if (typeof input.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.fingerprint))
		throw new TrackingDateRefusal(
			"invalid_input",
			"Review the employee tracking date before saving.",
		);
	const reason = typeof input.reason === "string" ? input.reason.trim() : "";
	if (!reason || reason.length > 1000)
		throw new TrackingDateRefusal("invalid_input", "Enter a reason of at most 1,000 characters.");
	return commitReviewedTrackingChange(database, {
		...input,
		plan: (client) => planEmployeeTrackingDate(client, { ...input, ...proposal }),
		write: async (client, impact, audit) => {
			const before = await loadEmployeeTrackingDateSettings(client, input);
			const timestamp = dateFromInstant(input.now);
			await client
				.insert(employeeTrackingSettings)
				.values({
					organizationId: input.organizationId,
					employeeId: proposal.employeeId,
					trackingStartDate: proposal.trackingStartDate,
					updatedAt: timestamp,
					updatedBy: input.actorUserId,
				})
				.onConflictDoUpdate({
					target: [employeeTrackingSettings.organizationId, employeeTrackingSettings.employeeId],
					set: {
						trackingStartDate: proposal.trackingStartDate,
						revision: sql`${employeeTrackingSettings.revision}+1`,
						updatedAt: timestamp,
						updatedBy: input.actorUserId,
					},
				});
			await audit.record(client, {
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				targetType: "employee",
				targetId: proposal.employeeId,
				action: AuditAction.EMPLOYEE_TRACKING_DATE_CHANGED,
				changes: {
					from: {
						trackingStartDate: before.employeeTrackingStartDate,
						effectiveTrackingStartDate: before.effectiveTrackingStartDate,
					},
					to: {
						trackingStartDate: proposal.trackingStartDate,
						effectiveTrackingStartDate: impact.employees[0]?.proposedBoundary,
					},
				},
				metadata: {
					reason,
					fingerprint: input.fingerprint,
					source: "reviewed_employee_tracking_date",
				},
			});
		},
	});
}
