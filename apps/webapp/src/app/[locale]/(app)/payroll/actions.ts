"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { db, employee, payrollExportConfig, payrollExportFormat } from "@/db";
import { getAuthContext, type AuthContext } from "@/lib/auth-helpers";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import {
	createExportJob,
	getFormatter,
	getPayrollExportConfig,
	type PayrollExportFilters,
	processExportJob,
} from "@/lib/payroll-export";
import {
	intersectPayrollScope,
	resolvePayrollAccessibleEmployeeIds,
} from "@/lib/payroll-access/permissions";
import {
	exportPayrollSummaryToPDF,
	generatePayrollPDFFilename,
} from "@/lib/payroll-workspace/pdf-exporter";
import { getPayrollWorkspaceSummary } from "@/lib/payroll-workspace/summary";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";

export interface PayrollWorkspaceRequest {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
}

export interface PayrollExportFormatOption {
	id: string;
	label: string;
}

const PAYROLL_WORKSPACE_EXPORT_FORMATS = ["datev_lohn", "lexware_lohn", "sage_lohn"] as const;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PayrollWorkspaceExportFormatId = (typeof PAYROLL_WORKSPACE_EXPORT_FORMATS)[number];
type PayrollWorkspaceActorRole = "admin" | "manager" | "employee";

export function resolveScopedPayrollEmployeeIdsForAction(input: {
	role: PayrollWorkspaceActorRole;
	requestedEmployeeIds?: string[];
	allowedEmployeeIds: string[];
}): string[] | undefined {
	if (input.role === "admin") {
		return input.requestedEmployeeIds;
	}

	return intersectPayrollScope({
		allowedEmployeeIds: input.allowedEmployeeIds,
		requestedEmployeeIds: input.requestedEmployeeIds,
	});
}

export async function getPayrollWorkspaceSummaryAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<PayrollWorkspaceSummary>> {
	return runPayrollWorkspaceAction(() => buildScopedPayrollWorkspaceSummary(request));
}

export async function exportPayrollPdfAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<{ filename: string; data: number[] }>> {
	return runPayrollWorkspaceAction(async () => {
		const summary = await buildScopedPayrollWorkspaceSummary(request);
		const pdfBytes = await exportPayrollSummaryToPDF(summary);

		return {
			filename: generatePayrollPDFFilename(summary),
			data: Array.from(pdfBytes),
		};
	});
}

export async function startScopedPayrollExportAction(
	request: PayrollWorkspaceRequest & { formatId: string },
): Promise<ServerActionResult<{ jobId: string; isAsync: boolean; fileContent?: string }>> {
	return runPayrollWorkspaceAction(async () => {
		const formatId = validateExportFormatId(request.formatId);
		const { authContext, period, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
			request,
		);

		const configuredFormat = await getPayrollExportConfig(
			authContext.employee.organizationId,
			formatId,
		);
		if (!configuredFormat) {
			throw new ValidationError({
				message: "Payroll export format is not configured",
				field: "formatId",
			});
		}

		const filters: PayrollExportFilters = {
			dateRange: {
				start: period.start,
				end: period.end,
			},
			employeeIds: scopedEmployeeIds,
		};

		const { jobId, isAsync } = await createExportJob({
			organizationId: authContext.employee.organizationId,
			formatId,
			requestedById: authContext.employee.id,
			filters,
		});

		if (isAsync) {
			return { jobId, isAsync };
		}

		const { result } = await processExportJob(jobId);
		const fileContent = result?.content
			? typeof result.content === "string"
				? result.content
				: result.content.toString("utf-8")
			: undefined;

		return { jobId, isAsync, fileContent };
	});
}

export async function getConfiguredPayrollExportFormatsAction(): Promise<
	ServerActionResult<PayrollExportFormatOption[]>
> {
	return runPayrollWorkspaceAction(async () => {
		const { authContext } = await resolvePayrollWorkspaceActionContext({
			startDate: "2000-01-01",
			endDate: "2000-01-01",
			label: "Format access check",
		});

		const configuredFormats = await db
			.select({ id: payrollExportFormat.id, label: payrollExportFormat.name })
			.from(payrollExportConfig)
			.innerJoin(payrollExportFormat, eq(payrollExportConfig.formatId, payrollExportFormat.id))
			.where(
				and(
					eq(payrollExportConfig.organizationId, authContext.employee.organizationId),
					eq(payrollExportConfig.isActive, true),
					eq(payrollExportFormat.isEnabled, true),
					inArray(payrollExportFormat.id, [...PAYROLL_WORKSPACE_EXPORT_FORMATS]),
				),
			);

		return configuredFormats.map((format) => ({ id: format.id, label: format.label }));
	});
}

async function buildScopedPayrollWorkspaceSummary(
	request: PayrollWorkspaceRequest,
): Promise<PayrollWorkspaceSummary> {
	const { authContext, period, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(request);

	return getPayrollWorkspaceSummary({
		organizationId: authContext.employee.organizationId,
		allowedEmployeeIds: scopedEmployeeIds ?? (await getActiveOrganizationEmployeeIds(authContext)),
		period,
		generatedBy: {
			id: authContext.employee.id,
			name: authContext.user.name || authContext.user.email,
		},
	});
}

async function resolvePayrollWorkspaceActionContext(request: PayrollWorkspaceRequest): Promise<{
	authContext: AuthContext & { employee: NonNullable<AuthContext["employee"]> };
	period: { start: DateTime; end: DateTime; label: string };
	scopedEmployeeIds: string[] | undefined;
}> {
	const authContext = await requireActiveOrganizationEmployee();
	const period = validatePayrollWorkspaceRequest(request);
	const requestedEmployeeIds = validateRequestedEmployeeIds(request.employeeIds);
	const allowedEmployeeIds =
		authContext.employee.role === "admin"
			? []
			: await resolvePayrollAccessibleEmployeeIds({
					organizationId: authContext.employee.organizationId,
					payrollEmployeeId: authContext.employee.id,
				});

	if (authContext.employee.role !== "admin" && allowedEmployeeIds.length === 0) {
		throw new AuthorizationError({
			message: "No payroll employees are assigned to your access scope",
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	return {
		authContext,
		period,
		scopedEmployeeIds: resolveScopedPayrollEmployeeIdsForAction({
			role: authContext.employee.role,
			requestedEmployeeIds,
			allowedEmployeeIds,
		}),
	};
}

async function requireActiveOrganizationEmployee(): Promise<
	AuthContext & { employee: NonNullable<AuthContext["employee"]> }
> {
	const authContext = await getAuthContext();
	if (!authContext?.employee || !authContext.session.activeOrganizationId) {
		throw new AuthenticationError({ message: "Authentication required" });
	}

	if (authContext.employee.organizationId !== authContext.session.activeOrganizationId) {
		throw new AuthorizationError({
			message: "Active organization employee context is required",
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	return authContext as AuthContext & { employee: NonNullable<AuthContext["employee"]> };
}

function validatePayrollWorkspaceRequest(request: PayrollWorkspaceRequest): {
	start: DateTime;
	end: DateTime;
	label: string;
} {
	const start = parseISODate(request.startDate, "startDate");
	const end = parseISODate(request.endDate, "endDate");

	if (end < start) {
		throw new ValidationError({
			message: "End date must be on or after start date",
			field: "endDate",
			value: request.endDate,
		});
	}

	if (typeof request.label !== "string" || request.label.trim().length === 0) {
		throw new ValidationError({ message: "Payroll period label is required", field: "label" });
	}

	return { start, end, label: request.label.trim() };
}

function parseISODate(value: string, field: string): DateTime {
	if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
		throw new ValidationError({ message: `${field} must be an ISO date`, field, value });
	}

	const parsed = DateTime.fromISO(value, { zone: "utc" });
	if (!parsed.isValid || parsed.toISODate() !== value) {
		throw new ValidationError({ message: `${field} must be a valid ISO date`, field, value });
	}

	return parsed;
}

function validateRequestedEmployeeIds(employeeIds: string[] | undefined): string[] | undefined {
	if (employeeIds === undefined) return undefined;
	if (!Array.isArray(employeeIds)) {
		throw new ValidationError({ message: "employeeIds must be an array", field: "employeeIds" });
	}

	const uniqueEmployeeIds = [...new Set(employeeIds)];
	if (uniqueEmployeeIds.some((employeeId) => typeof employeeId !== "string" || !employeeId.trim())) {
		throw new ValidationError({
			message: "employeeIds must contain only strings",
			field: "employeeIds",
		});
	}

	return uniqueEmployeeIds;
}

function validateExportFormatId(formatId: string): PayrollWorkspaceExportFormatId {
	if (
		typeof formatId !== "string" ||
		!PAYROLL_WORKSPACE_EXPORT_FORMATS.includes(formatId as PayrollWorkspaceExportFormatId) ||
		!getFormatter(formatId)
	) {
		throw new ValidationError({ message: "Unknown payroll export format", field: "formatId" });
	}

	return formatId as PayrollWorkspaceExportFormatId;
}

async function getActiveOrganizationEmployeeIds(
	authContext: AuthContext & { employee: NonNullable<AuthContext["employee"]> },
): Promise<string[]> {
	const rows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.organizationId, authContext.employee.organizationId), eq(employee.isActive, true)));

	return rows.map((row) => row.id).sort();
}

async function runPayrollWorkspaceAction<T>(
	action: () => Promise<T>,
): Promise<ServerActionResult<T>> {
	return runServerActionSafe(
		Effect.tryPromise({
			try: action,
			catch: (error) => {
				if (isAppError(error)) return error;

				return new ValidationError({
					message: "Payroll workspace action failed",
				});
			},
		}),
	);
}

function isAppError(error: unknown): error is ValidationError | AuthenticationError | AuthorizationError {
	return (
		error instanceof ValidationError ||
		error instanceof AuthenticationError ||
		error instanceof AuthorizationError
	);
}
