/**
 * Minijob exceedance months for Settings → Contracts → Reviews & Conflicts (#1989). Org-admin
 * data: amounts are EUR cents. Covers the last 12 months through next month, so planned shifts
 * that would exceed the cap appear before they are worked.
 */
import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee, employeeEmploymentHistory } from "@/db/schema";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { attachAcknowledgementStates } from "../acknowledgements";
import type { StatutorySeverity } from "../finding";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import { addMonths, MINIJOB_MONTHLY_FINDING, type MinijobExceedanceStatus } from "./minijob-months";

export interface MinijobExceedanceReview {
	/** `StatutoryFinding.id`. */
	readonly id: string;
	readonly employeeId: string;
	readonly employeeName: string;
	readonly month: string;
	readonly severity: StatutorySeverity;
	readonly status: MinijobExceedanceStatus;
	readonly acknowledgeable: boolean;
	readonly totalCents: number;
	readonly capCents: number;
	readonly doubleCapCents: number | null;
	readonly externalCents: number;
	readonly plannedCents: number;
	readonly priorExceedanceMonths: readonly string[];
	readonly acknowledgement: {
		readonly status: "none" | "current" | "stale";
		readonly acknowledgedAt: Date | null;
		readonly acknowledgedBy: string | null;
		readonly reason: string | null;
	};
}

function personName(row: {
	firstName: string | null;
	lastName: string | null;
	userName: string | null;
	email: string | null;
	employeeId: string;
}): string {
	const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
	return full || row.userName || row.email || row.employeeId;
}

export async function loadMinijobExceedanceReviews(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly now: Instant;
		/** Include months already documented by a current acknowledgement. */
		readonly includeAcknowledged?: boolean;
	},
): Promise<MinijobExceedanceReview[]> {
	const candidates = await db
		.select({ employeeId: employeeEmploymentHistory.employeeId })
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				eq(employeeEmploymentHistory.employmentProfile, "minijob"),
			),
		);
	if (candidates.length === 0) return [];

	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	const preferences = await loadOrganizationStatutoryPreferences(db, input.organizationId);
	const currentMonth = plainDateAt(input.now, timezone).toString().slice(0, 7);
	const { findings } = await evaluateMinijobEarnings(db, {
		organizationId: input.organizationId,
		timezone,
		employeeIds: [...new Set(candidates.map((row) => row.employeeId))],
		months: { from: addMonths(currentMonth, -11), until: addMonths(currentMonth, 2) },
		preferences,
		now: input.now,
	});
	const exceedances = await attachAcknowledgementStates(
		db,
		input.organizationId,
		findings.filter((f) => f.kind === MINIJOB_MONTHLY_FINDING && f.acknowledgementKind !== null),
	);
	const shown = exceedances.filter(
		(f) => input.includeAcknowledged || f.adminDetail?.facts?.exceedanceStatus !== "acknowledged",
	);
	if (shown.length === 0) return [];

	const names = await db
		.select({
			employeeId: employee.id,
			firstName: user.firstName,
			lastName: user.lastName,
			userName: user.name,
			email: user.email,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, [...new Set(shown.map((f) => f.employeeId))]),
			),
		);
	const nameOf = new Map(names.map((row) => [row.employeeId, personName(row)]));

	return shown
		.map((finding): MinijobExceedanceReview => {
			const amounts = finding.adminDetail?.amountsCents ?? {};
			const facts = finding.adminDetail?.facts ?? {};
			const prior =
				typeof facts.priorExceedanceMonths === "string" ? facts.priorExceedanceMonths : "";
			return {
				id: finding.id,
				employeeId: finding.employeeId,
				employeeName: nameOf.get(finding.employeeId) ?? finding.employeeId,
				month: finding.subjectKey,
				severity: finding.severity,
				status: facts.exceedanceStatus as MinijobExceedanceStatus,
				acknowledgeable: facts.acknowledgeable === true,
				totalCents: amounts.total ?? 0,
				capCents: amounts.cap ?? 0,
				doubleCapCents: amounts.doubleCap ?? null,
				externalCents: amounts.external ?? 0,
				plannedCents: amounts.planned ?? 0,
				priorExceedanceMonths: prior ? prior.split(",") : [],
				acknowledgement: {
					status: finding.acknowledgement?.status ?? "none",
					acknowledgedAt: finding.acknowledgement?.acknowledgedAt ?? null,
					acknowledgedBy: finding.acknowledgement?.acknowledgedBy ?? null,
					reason: finding.acknowledgement?.reason ?? null,
				},
			};
		})
		.sort((a, b) =>
			a.month === b.month
				? a.employeeName.localeCompare(b.employeeName)
				: a.month < b.month
					? 1
					: -1,
		);
}
