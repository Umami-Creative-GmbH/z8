import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	auditLog,
	employee,
	payrollAccessGrant,
	payrollExportBaseline,
	payrollExportJob,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import { parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthenticationError,
	AuthorizationError,
	ValidationError,
} from "@/lib/effect/errors";
import { listDepartedEmployeesCoveredForExport } from "@/lib/payroll-access/adjustment-coverage";
import { resolvePayrollAccessibleEmployeeIds } from "@/lib/payroll-access/permissions";
import { payrollBaselineDetail } from "./baseline-evidence";
import type {
	PayrollBaselineDetail,
	PayrollBaselineSummary,
} from "./baseline-types";

export type {
	PayrollBaselineDetail,
	PayrollBaselineEvidence,
	PayrollBaselineSummary,
} from "./baseline-types";

export async function requireBaselineActor() {
	const auth = await getAuthContext();
	if (!auth)
		throw new AuthenticationError({ message: "Authentication required" });
	const organizationId = auth.session.activeOrganizationId;
	if (
		!organizationId ||
		!auth.employee ||
		auth.employee.organizationId !== organizationId
	)
		throw denied(auth.user.id);
	const [actor, grant] = await Promise.all([
		db.query.employee.findFirst({
			where: and(
				eq(employee.id, auth.employee.id),
				eq(employee.organizationId, organizationId),
				eq(employee.userId, auth.user.id),
				eq(employee.isActive, true),
			),
			columns: { id: true },
		}),
		db.query.payrollAccessGrant.findFirst({
			where: and(
				eq(payrollAccessGrant.organizationId, organizationId),
				eq(payrollAccessGrant.payrollEmployeeId, auth.employee.id),
				eq(payrollAccessGrant.isActive, true),
			),
		}),
	]);
	if (!actor || !grant) throw denied(auth.user.id);
	const activeScope = await resolvePayrollAccessibleEmployeeIds({
		organizationId,
		payrollEmployeeId: actor.id,
	});
	return {
		organizationId,
		userId: auth.user.id,
		all: grant.scope === "all",
		activeScope,
	};
}
function denied(userId: string) {
	return new AuthorizationError({
		message: "Payroll baseline is unavailable",
		userId,
		resource: "payroll_baseline",
		action: "read",
	});
}
export async function canReadScope(
	actor: Awaited<ReturnType<typeof requireBaselineActor>>,
	employeeIds: string[],
	startDate: string,
): Promise<boolean> {
	if (
		!Array.isArray(employeeIds) ||
		employeeIds.some((id) => typeof id !== "string" || id.length === 0)
	)
		return false;
	if (actor.all) return true;
	if (employeeIds.every((id) => actor.activeScope.includes(id))) return true;
	try {
		parsePlainDate(startDate);
	} catch {
		return false;
	}
	const departed = await listDepartedEmployeesCoveredForExport(db, {
		organizationId: actor.organizationId,
		actorUserId: actor.userId,
		fromDate: startDate,
	});
	const allowed = new Set([...actor.activeScope, ...departed]);
	return employeeIds.every((id) => allowed.has(id));
}
async function audit(
	actor: Awaited<ReturnType<typeof requireBaselineActor>>,
	action: "list" | "inspect",
	ids: string[],
) {
	await db.insert(auditLog).values({
		organizationId: actor.organizationId,
		performedBy: actor.userId,
		entityType: "payroll_baseline",
		entityId: action === "inspect" ? ids[0] : actor.organizationId,
		action: `payroll_baseline.${action}`,
		metadata: JSON.stringify({ baselineIds: ids }),
	});
}
function validatePeriod(request: { startDate?: string; endDate?: string }) {
	for (const value of [request.startDate, request.endDate])
		if (value !== undefined) {
			try {
				parsePlainDate(value);
			} catch {
				throw new ValidationError({ message: "Invalid payroll period" });
			}
		}
	if (
		request.startDate &&
		request.endDate &&
		request.endDate < request.startDate
	)
		throw new ValidationError({ message: "Invalid payroll period" });
}
export async function listPayrollBaselines(
	request: { startDate?: string; endDate?: string } = {},
): Promise<PayrollBaselineSummary[]> {
	const actor = await requireBaselineActor();
	validatePeriod(request);
	const rows = await db.query.payrollExportBaseline.findMany({
		where: eq(payrollExportBaseline.organizationId, actor.organizationId),
		orderBy: [
			desc(payrollExportBaseline.completedAt),
			desc(payrollExportBaseline.id),
		],
	});
	const summaries: PayrollBaselineSummary[] = [];
	for (const row of rows) {
		const detail = payrollBaselineDetail(row, systemClock.nowInstant());
		const period = detail.summary.period;
		if (
			(request.startDate && request.startDate !== period.startDate) ||
			(request.endDate && request.endDate !== period.endDate)
		)
			continue;
		if (!(await canReadScope(actor, row.scopeEmployeeIds, period.startDate)))
			continue;
		summaries.push(
			payrollBaselineDetail(row, systemClock.nowInstant()).summary,
		);
	}
	// Legacy jobs are only identifiable as unavailable. Never reconstruct scope or output from current data.
	const jobs = await db.query.payrollExportJob.findMany({
		where: and(
			eq(payrollExportJob.organizationId, actor.organizationId),
			eq(payrollExportJob.status, "completed"),
		),
		with: { config: true },
		orderBy: [desc(payrollExportJob.completedAt), desc(payrollExportJob.id)],
	});
	const capturedJobs = new Set(rows.map((row) => row.jobId));
	for (const job of jobs) {
		if (
			capturedJobs.has(job.id) ||
			job.config.formatId !== "datev_lohn" ||
			!job.completedAt
		)
			continue;
		const period = {
			startDate: job.filters.dateRange.start,
			endDate: job.filters.dateRange.end,
		};
		if (
			(request.startDate && request.startDate !== period.startDate) ||
			(request.endDate && request.endDate !== period.endDate)
		)
			continue;
		const ids = job.filters.employeeIds;
		if (ids === undefined && !actor.all) continue;
		if (ids && !(await canReadScope(actor, ids, period.startDate))) continue;
		summaries.push({
			id: job.id,
			jobId: job.id,
			formatId: "datev_lohn",
			destination: {
				configId: job.configId,
				mandantennummer: "",
				beraternummer: "",
			},
			period,
			employeeIds: ids ?? [],
			createdAt: job.createdAt.toISOString(),
			completedAt: job.completedAt.toISOString(),
			expiresAt: "",
			availability: "legacy",
		});
	}
	summaries.sort(
		(a, b) =>
			b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id),
	);
	await audit(
		actor,
		"list",
		summaries.map((row) => row.id),
	);
	return summaries;
}
export async function inspectPayrollBaseline(
	baselineId: string,
): Promise<PayrollBaselineDetail | null> {
	const actor = await requireBaselineActor();
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			baselineId,
		)
	)
		return null;
	const row = await db.query.payrollExportBaseline.findFirst({
		where: and(
			eq(payrollExportBaseline.organizationId, actor.organizationId),
			eq(payrollExportBaseline.id, baselineId),
		),
	});
	if (!row) {
		const legacy = (await listPayrollBaselines()).find(
			(summary) =>
				summary.id === baselineId && summary.availability === "legacy",
		);
		return legacy ? { summary: legacy, evidence: null } : null;
	}
	if (
		!(await canReadScope(
			actor,
			row.scopeEmployeeIds,
			payrollBaselineDetail(row, systemClock.nowInstant()).summary.period
				.startDate,
		))
	)
		return null;
	const detail = payrollBaselineDetail(row, systemClock.nowInstant());
	await audit(actor, "inspect", [row.id]);
	return detail;
}
