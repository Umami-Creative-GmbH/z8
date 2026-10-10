/**
 * Project Report types and interfaces
 */

import type { BillableFigures, BillableFiguresAccess } from "@/lib/billable-time/report-figures";
import type { CustomFieldReportValue, PeriodPreset, ReportDateRange } from "./types";

export type { BillableFigures, BillableFiguresAccess };

/**
 * Billable Time context of a report (#902), present while the module is on and
 * the viewer sees any Billable Time figures.
 *
 * Figure groups: Billable Time figures hang off report rows under their own
 * optional key (`billable`), next to the hours every report row has. Later
 * groups (invoiced and un-invoiced figures, #903) add their own optional key to
 * the same rows and their columns to the export figure groups
 * (`lib/reports/project-report-export.ts`), without forking these types.
 */
export interface BillableTimeReportContext {
	/** The billable currency every amount is in. */
	currency: string;
	/**
	 * When the rates were read (ISO instant). Revenue and cost use the rates in
	 * effect then; the same report can change after a rate edit (ADR 0001).
	 */
	ratesResolvedAt: string;
}

export interface ProjectCustomerInfo {
	id: string;
	name: string;
	/**
	 * The customer's active custom fields the reader sees, in order, as of the
	 * report period's last day (#820). Only the detailed project report sets it.
	 */
	customFields?: CustomFieldReportValue[];
}

export type ProjectHealthSeverity = "none" | "warning" | "critical";

export type ProjectBudgetAlertType = "budget_70" | "budget_90" | "budget_100";

export type ProjectDeadlineAlertType =
	| "deadline_14d"
	| "deadline_7d"
	| "deadline_1d"
	| "deadline_today"
	| "deadline_overdue";

export interface ProjectHealthFields {
	budgetSeverity: ProjectHealthSeverity;
	budgetAlertType: ProjectBudgetAlertType | null;
	deadlineSeverity: ProjectHealthSeverity;
	deadlineAlertType: ProjectDeadlineAlertType | null;
	forecastSeverity: ProjectHealthSeverity;
	forecastBudgetExhaustionDate: Date | null;
	forecastMessage: string | null;
}

export interface ProjectBudgetHealthTotals {
	projectsAtOrAbove70Budget: number;
	projectsAtOrAbove90Budget: number;
	projectsOverBudget: number;
	projectsForecastAtRisk: number;
}

export interface ProjectInfo {
	id: string;
	name: string;
	description: string | null;
	status: "planned" | "active" | "paused" | "completed" | "archived";
	color: string | null;
	budgetHours: number | null;
	deadline: Date | null;
	/** The project's current customer, if it has one. */
	customer?: ProjectCustomerInfo | null;
	/**
	 * The project's active custom fields the reader sees, in order, as of the
	 * report period's last day (#820). Only the detailed project report sets it.
	 */
	customFields?: CustomFieldReportValue[];
}
export interface ProjectSummary extends ProjectInfo, ProjectHealthFields {
	totalHours: number;
	totalMinutes: number;
	percentBudgetUsed: number | null;
	daysUntilDeadline: number | null;
	uniqueEmployees: number;
	workPeriodCount: number;
	/** Billable Time figures for the range, when the viewer may see them. */
	billable?: BillableFigures;
}

export interface ProjectTimeSeriesPoint {
	date: string; // ISO date
	hours: number;
	cumulativeHours: number;
}

export interface ProjectTeamMember {
	employeeId: string;
	employeeName: string;
	totalHours: number;
	totalMinutes: number;
	workPeriodCount: number;
	percentOfTotal: number;
	/** This employee's Billable Time figures on the project, when the viewer may see them. */
	billable?: BillableFigures;
}

export interface ProjectTeamBreakdown {
	teamId: string;
	teamName: string;
	totalHours: number;
	totalMinutes: number;
	percentOfTotal: number;
	members: ProjectTeamMember[];
}

/**
 * One row of the project report's "By task" section. The rows of a report
 * add up to its summary total: time booked without a task is the "No task" row.
 */
export interface ProjectTaskBreakdownRow {
	/** null = the "No task" row. */
	taskId: string | null;
	taskName: string | null;
	state: "open" | "done" | null;
	totalHours: number;
	totalMinutes: number;
	workPeriodCount: number;
	percentOfTotal: number;
	/**
	 * Progress against the task estimate, only for a task that has one. It
	 * compares every hour ever booked to the task, not only the report period.
	 */
	estimate: { estimateHours: number; bookedHours: number; percentUsed: number } | null;
}

export interface ProjectDetailedReport {
	project: ProjectInfo;
	period: {
		startDate: string;
		endDate: string;
		label: string;
	};
	summary: {
		totalHours: number;
		totalMinutes: number;
		budgetHours: number | null;
		percentBudgetUsed: number | null;
		remainingBudgetHours: number | null;
		uniqueEmployees: number;
		workPeriodCount: number;
		averageHoursPerDay: number;
		billable?: BillableFigures;
	};
	/** Days are the employee-local day each work period started on. */
	timeSeries: ProjectTimeSeriesPoint[];
	teamBreakdown: ProjectTeamBreakdown[];
	employeeBreakdown: ProjectTeamMember[];
	billableTime?: BillableTimeReportContext;
	taskBreakdown: ProjectTaskBreakdownRow[];
}

export interface ProjectPortfolioData {
	projects: ProjectSummary[];
	totals: {
		totalProjects: number;
		activeProjects: number;
		totalHours: number;
		projectsOverBudget: number;
		projectsOverdue: number;
		budgetHealth: ProjectBudgetHealthTotals;
		/**
		 * The sum of the projects' Billable Time figures; only present when every
		 * listed project has them, so a total never mixes in hidden projects.
		 */
		billable?: BillableFigures;
	};
	billableTime?: BillableTimeReportContext;
}

/** One project in the customer view (#902). */
export interface CustomerProjectSummary {
	project: ProjectInfo;
	totalHours: number;
	totalMinutes: number;
	workPeriodCount: number;
	billable: BillableFigures;
}

/** One customer in the customer view: the sum of its projects. */
export interface CustomerBillableSummary {
	customer: ProjectCustomerInfo;
	totalHours: number;
	totalMinutes: number;
	workPeriodCount: number;
	billable: BillableFigures;
	projects: CustomerProjectSummary[];
}

/**
 * The customer view (#902): Billable Time figures rolled up per customer, with
 * its projects to drill into. A customer's totals are the sum of the projects
 * listed under it, and the report totals the sum of its customers.
 */
export interface CustomerBillableReport {
	period: {
		startDate: string;
		endDate: string;
	};
	access: BillableFiguresAccess;
	billableTime: BillableTimeReportContext;
	customers: CustomerBillableSummary[];
	/**
	 * Projects without an (active) customer whose work is in the range: their
	 * billable work shows as *without customer*, never under a customer. Null
	 * when there are none.
	 */
	withoutCustomer: Omit<CustomerBillableSummary, "customer"> | null;
	/** The sum of the customers and the without-customer group. */
	totals: {
		totalHours: number;
		totalMinutes: number;
		workPeriodCount: number;
		billable: BillableFigures;
	};
}

export interface ProjectReportFilters {
	startDate: string;
	endDate: string;
	preset?: PeriodPreset;
	statusFilter?: ("planned" | "active" | "paused" | "completed" | "archived")[];
	teamId?: string;
	managerId?: string;
}

export type { PeriodPreset, ReportDateRange };
