/**
 * Project Report types and interfaces
 */

import type { DateRange, PeriodPreset } from "./types";

export interface ProjectInfo {
	id: string;
	name: string;
	description: string | null;
	status: "planned" | "active" | "paused" | "completed" | "archived";
	color: string | null;
	budgetHours: number | null;
	deadline: Date | null;
}

export interface ProjectSummary extends ProjectInfo {
	totalHours: number;
	totalMinutes: number;
	percentBudgetUsed: number | null;
	daysUntilDeadline: number | null;
	uniqueEmployees: number;
	workPeriodCount: number;
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
}

export interface ProjectTeamBreakdown {
	teamId: string;
	teamName: string;
	totalHours: number;
	totalMinutes: number;
	percentOfTotal: number;
	members: ProjectTeamMember[];
}

export interface ProjectDetailedReport {
	project: ProjectInfo;
	period: {
		startDate: Date;
		endDate: Date;
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
	};
	timeSeries: ProjectTimeSeriesPoint[];
	teamBreakdown: ProjectTeamBreakdown[];
	employeeBreakdown: ProjectTeamMember[];
}

export interface ProjectPortfolioData {
	projects: ProjectSummary[];
	totals: {
		totalProjects: number;
		activeProjects: number;
		totalHours: number;
		projectsOverBudget: number;
		projectsOverdue: number;
	};
}

export interface ProjectReportFilters {
	startDate: Date;
	endDate: Date;
	preset?: PeriodPreset;
	statusFilter?: ("planned" | "active" | "paused" | "completed" | "archived")[];
	teamId?: string;
	managerId?: string;
}

export type { DateRange, PeriodPreset };
