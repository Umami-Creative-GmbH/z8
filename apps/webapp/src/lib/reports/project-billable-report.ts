import "server-only";

import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { member } from "@/db/auth-schema";
import { projectManager } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	type BillableFigures,
	type BillableFiguresAccess,
	billableFigures,
	type ReportedWork,
	sumBillableFigures,
	tallyReportedWork,
} from "@/lib/billable-time/report-figures";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { billableFiguresAccessFor, type ProjectReportViewer } from "./project-report-access";
import { loadReportRates } from "./project-report-work";
import type {
	BillableTimeReportContext,
	CustomerBillableReport,
	CustomerBillableSummary,
	CustomerProjectSummary,
	ProjectCustomerInfo,
	ProjectInfo,
} from "./project-types";

type Reader = Pick<typeof db, "select">;

/**
 * Who reads a project report: the employee role, whether they are an owner or
 * admin of the organization (membership role), and the projects they manage.
 */
export async function loadProjectReportViewer(
	reader: Reader,
	input: {
		organizationId: string;
		userId: string;
		employee: { id: string; role: "admin" | "manager" | "employee" };
	},
): Promise<ProjectReportViewer> {
	const [memberships, managed] = await Promise.all([
		reader
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.userId, input.userId),
					eq(member.organizationId, input.organizationId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		reader
			.select({ projectId: projectManager.projectId })
			.from(projectManager)
			.where(eq(projectManager.employeeId, input.employee.id)),
	]);
	const role = memberships[0]?.role;
	return {
		employeeRole: input.employee.role,
		isOrganizationAdmin: hasOrganizationRole(role, "owner") || hasOrganizationRole(role, "admin"),
		managedProjectIds: new Set(managed.map((row) => row.projectId)),
	};
}

/** Prices report work for one viewer; created by `prepareBillableReportPricing`. */
export interface BillableReportPricing {
	context: BillableTimeReportContext;
	accessFor(projectId: string): BillableFiguresAccess | null;
	/**
	 * The figures of one figure set (a project, one employee on a project) at the
	 * viewer's access for `projectId`, or undefined when they see none.
	 */
	figures(projectId: string, work: readonly ReportedWork[]): BillableFigures | undefined;
}

/**
 * Loads what a report needs to show Billable Time figures to `viewer`: the
 * module settings and, for the projects the viewer may see figures of, the
 * billable rates (and cost rates only for owners and admins), read now.
 * Null while the module is off or when the viewer sees no figures for any of
 * `projectIds` (an empty list still prices, for an empty customer view).
 */
export async function prepareBillableReportPricing(
	reader: Reader,
	organizationId: string,
	input: {
		viewer: ProjectReportViewer;
		projectIds: readonly string[];
		work: readonly ReportedWork[];
		now?: Instant;
	},
): Promise<BillableReportPricing | null> {
	const settings = await getBillableTimeSettings(organizationId, reader);
	if (!settings.enabled || settings.currency === null) return null;
	const currency = settings.currency;
	const accessFor = (projectId: string) => billableFiguresAccessFor(input.viewer, projectId);
	const accesses = input.projectIds.map(accessFor);
	if (accesses.length > 0 && accesses.every((access) => access === null)) return null;

	const pricedWork = input.work.filter((item) => accessFor(item.projectId) !== null);
	const rates = await loadReportRates(reader, organizationId, pricedWork, {
		includeCost: accesses.includes("full"),
	});
	return {
		context: {
			currency,
			ratesResolvedAt: (input.now ?? systemClock.nowInstant()).toString(),
		},
		accessFor,
		figures(projectId, work) {
			const access = accessFor(projectId);
			if (access === null) return undefined;
			return billableFigures(tallyReportedWork(work, rates), { access, currency });
		},
	};
}

/**
 * The sum of the figures of several figure sets, when every set has figures
 * and they share one access level; otherwise undefined.
 */
export function sumVisibleBillableFigures(
	parts: readonly (BillableFigures | undefined)[],
	currency: string,
): BillableFigures | undefined {
	if (parts.length === 0) return undefined;
	const visible = parts.filter((part): part is BillableFigures => part !== undefined);
	if (visible.length !== parts.length) return undefined;
	const access = visible.some((part) => part.access === "revenue") ? "revenue" : "full";
	return sumBillableFigures(visible, { access, currency });
}

export interface CustomerViewProject {
	project: ProjectInfo & { customer: ProjectCustomerInfo };
	work: readonly ReportedWork[];
}

/**
 * The customer view (#902) of the projects the viewer sees figures for:
 * projects with counted work, grouped by their current customer. Each
 * customer's figures are the sum of its projects' figures, and the totals the
 * sum of the customers', so totals always equal the sum of what is listed.
 */
export function buildCustomerBillableReport(input: {
	period: CustomerBillableReport["period"];
	pricing: BillableReportPricing;
	access: BillableFiguresAccess;
	projects: readonly CustomerViewProject[];
}): CustomerBillableReport {
	const { currency } = input.pricing.context;
	const byCustomer = new Map<string, CustomerBillableSummary>();
	for (const entry of input.projects) {
		if (entry.work.length === 0) continue;
		const figures = input.pricing.figures(entry.project.id, entry.work);
		if (!figures) continue;
		const totalMinutes = entry.work.reduce((sum, item) => sum + item.durationMinutes, 0);
		const row: CustomerProjectSummary = {
			project: entry.project,
			totalHours: totalMinutes / 60,
			totalMinutes,
			workPeriodCount: entry.work.length,
			billable: figures,
		};
		const customer = entry.project.customer;
		const existing = byCustomer.get(customer.id);
		if (existing) {
			existing.projects.push(row);
		} else {
			byCustomer.set(customer.id, {
				customer,
				totalHours: 0,
				totalMinutes: 0,
				workPeriodCount: 0,
				billable: row.billable,
				projects: [row],
			});
		}
	}

	const customers = [...byCustomer.values()]
		.map((summary): CustomerBillableSummary => {
			const projects = [...summary.projects].sort((left, right) =>
				left.project.name.localeCompare(right.project.name),
			);
			const totalMinutes = projects.reduce((sum, row) => sum + row.totalMinutes, 0);
			return {
				customer: summary.customer,
				totalHours: totalMinutes / 60,
				totalMinutes,
				workPeriodCount: projects.reduce((sum, row) => sum + row.workPeriodCount, 0),
				billable: sumBillableFigures(
					projects.map((row) => row.billable),
					{ access: input.access, currency },
				),
				projects,
			};
		})
		.sort((left, right) => left.customer.name.localeCompare(right.customer.name));

	const totalMinutes = customers.reduce((sum, row) => sum + row.totalMinutes, 0);
	return {
		period: input.period,
		access: input.access,
		billableTime: input.pricing.context,
		customers,
		totals: {
			totalHours: totalMinutes / 60,
			totalMinutes,
			workPeriodCount: customers.reduce((sum, row) => sum + row.workPeriodCount, 0),
			billable: sumBillableFigures(
				customers.map((row) => row.billable),
				{ access: input.access, currency },
			),
		},
	};
}
