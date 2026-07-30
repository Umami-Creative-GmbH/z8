"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { z } from "zod";
import { db, payrollExportConfig, payrollExportFormat } from "@/db";
import { payrollBlockerDismissal } from "@/db/schema";
import { type AuthContext, getAuthContext } from "@/lib/auth-helpers";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { resolvePayrollAccessibleEmployeeIds } from "@/lib/payroll-access/permissions";
import {
	createExportJob,
	enqueuePayrollExportJob,
	getFormatter,
	getPayrollExportConfig,
	type PayrollExportFilters,
	processExportJob,
} from "@/lib/payroll-export";
import {
	exportPayrollSummaryToPDF,
	generatePayrollPDFFilename,
} from "@/lib/payroll-workspace/pdf-exporter";
import { getPayrollWorkspaceSummary } from "@/lib/payroll-workspace/summary";
import type {
	PayrollBlockerType,
	PayrollWorkspaceSummary,
} from "@/lib/payroll-workspace/types";
import { getTranslate } from "@/tolgee/server";
import { mapPayrollWorkspaceActionError } from "./action-errors";
import { resolveScopedPayrollEmployeeIdsForAction } from "./action-helpers";

type PayrollTranslate = Awaited<ReturnType<typeof getTranslate>>;

export interface PayrollWorkspaceRequest {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
}

export interface DismissPayrollBlockerRequest extends PayrollWorkspaceRequest {
	blockerId: string;
	blockerType: PayrollBlockerType;
}

export interface PayrollExportFormatOption {
	id: string;
	label: string;
}

const PAYROLL_WORKSPACE_EXPORT_FORMATS = ["datev_lohn", "lexware_lohn", "sage_lohn"] as const;
const PAYROLL_BLOCKER_TYPES = [
	"missing_clock_out",
	"pending_absence",
	"pending_time_correction",
] as const satisfies readonly PayrollBlockerType[];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PayrollWorkspaceExportFormatId = (typeof PAYROLL_WORKSPACE_EXPORT_FORMATS)[number];
export async function getPayrollWorkspaceSummaryAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<PayrollWorkspaceSummary>> {
	return runPayrollWorkspaceAction((t) => buildScopedPayrollWorkspaceSummary(t, request));
}

export async function dismissPayrollBlockerAction(
	request: DismissPayrollBlockerRequest,
): Promise<ServerActionResult<{ dismissed: true }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const authenticatedContext = await requireActiveOrganizationEmployee(t);
		const { blockerId, blockerType } = validatePayrollBlockerDismissalRequest(t, request);
		const { authContext, period, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
			t,
			request,
			authenticatedContext,
		);
		const organizationId = authContext.employee.organizationId;
		const findExistingDismissal = () =>
			db.query.payrollBlockerDismissal.findFirst({
				columns: {
					organizationId: true,
					blockerType: true,
					sourceId: true,
					employeeId: true,
				},
				where: and(
					eq(payrollBlockerDismissal.organizationId, organizationId),
					eq(payrollBlockerDismissal.blockerType, blockerType),
					eq(payrollBlockerDismissal.sourceId, blockerId),
				),
			});
		const dismissalIsInScope = (
			dismissal: Awaited<ReturnType<typeof findExistingDismissal>>,
		) =>
			dismissal?.organizationId === organizationId &&
			dismissal.blockerType === blockerType &&
			dismissal.sourceId === blockerId &&
			scopedEmployeeIds.includes(dismissal.employeeId);

		const existingDismissal = await findExistingDismissal();

		if (existingDismissal) {
			if (dismissalIsInScope(existingDismissal)) {
				return { dismissed: true };
			}

			throwPayrollBlockerAuthorizationError(t, authContext.user.id);
		}

		const summary = await getPayrollWorkspaceSummary({
			organizationId,
			allowedEmployeeIds: scopedEmployeeIds,
			period,
			generatedBy: {
				id: authContext.employee.id,
				name: authContext.user.name || authContext.user.email,
			},
		});
		const blocker = summary.blockers.find(
			(candidate) => candidate.id === blockerId && candidate.type === blockerType,
		);

		if (!blocker) {
			if (dismissalIsInScope(await findExistingDismissal())) {
				return { dismissed: true };
			}

			throwPayrollBlockerAuthorizationError(t, authContext.user.id);
		}

		if (!scopedEmployeeIds.includes(blocker.employeeId)) {
			throwPayrollBlockerAuthorizationError(t, authContext.user.id);
		}

		await db
			.insert(payrollBlockerDismissal)
			.values({
				organizationId,
				blockerType,
				sourceId: blockerId,
				employeeId: blocker.employeeId,
				dismissedByEmployeeId: authContext.employee.id,
			})
			.onConflictDoNothing();

		return { dismissed: true };
	});
}

export async function exportPayrollPdfAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<{ filename: string; data: number[] }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const summary = await buildScopedPayrollWorkspaceSummary(t, request);
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
	return runPayrollWorkspaceAction(async (t) => {
		const formatId = validateExportFormatId(t, request.formatId);
		const { authContext, period, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
			t,
			request,
		);

		const configuredFormat = await getPayrollExportConfig(
			authContext.employee.organizationId,
			formatId,
		);
		if (!configuredFormat) {
			throw new ValidationError({
				message: t(
					"payroll.errors.exportFormatNotConfigured",
					"Payroll export format is not configured",
				),
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
			await enqueuePayrollExportJob({
				jobId,
				organizationId: authContext.employee.organizationId,
			});
			return { jobId, isAsync };
		}

		const { result } = await processExportJob({
			jobId,
			organizationId: authContext.employee.organizationId,
		});
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
	return runPayrollWorkspaceAction(async (t) => {
		const { authContext } = await resolvePayrollWorkspaceActionContext(t, {
			startDate: "2000-01-01",
			endDate: "2000-01-01",
			label: t("payroll.export.formatAccessCheck", "Format access check"),
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
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
): Promise<PayrollWorkspaceSummary> {
	const { authContext, period, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
		t,
		request,
	);

	return getPayrollWorkspaceSummary({
		organizationId: authContext.employee.organizationId,
		allowedEmployeeIds: scopedEmployeeIds,
		period,
		generatedBy: {
			id: authContext.employee.id,
			name: authContext.user.name || authContext.user.email,
		},
	});
}

async function resolvePayrollWorkspaceActionContext(
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
	authenticatedContext?: AuthContext & { employee: NonNullable<AuthContext["employee"]> },
): Promise<{
	authContext: AuthContext & { employee: NonNullable<AuthContext["employee"]> };
	period: { start: DateTime; end: DateTime; label: string };
	scopedEmployeeIds: string[];
}> {
	const authContext = authenticatedContext ?? (await requireActiveOrganizationEmployee(t));
	const period = validatePayrollWorkspaceRequest(t, request);
	const requestedEmployeeIds = validateRequestedEmployeeIds(t, request.employeeIds);
	const allowedEmployeeIds = await resolvePayrollAccessibleEmployeeIds({
		organizationId: authContext.employee.organizationId,
		payrollEmployeeId: authContext.employee.id,
	});

	if (allowedEmployeeIds.length === 0) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.noAssignedEmployees",
				"No payroll employees are assigned to your access scope",
			),
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	const scopedResult = resolveScopedPayrollEmployeeIdsForAction({
		role: authContext.employee.role,
		requestedEmployeeIds,
		allowedEmployeeIds,
	});

	if (!scopedResult.hasScope) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.noAvailableEmployees",
				"No payroll employees are available in your access scope",
			),
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	return {
		authContext,
		period,
		scopedEmployeeIds: scopedResult.employeeIds,
	};
}

function validatePayrollBlockerDismissalRequest(
	t: PayrollTranslate,
	request: DismissPayrollBlockerRequest,
): { blockerId: string; blockerType: PayrollBlockerType } {
	if (!z.uuid().safeParse(request.blockerId).success) {
		throw new ValidationError({
			message: t("payroll.errors.invalidBlockerId", "Invalid payroll blocker ID"),
			field: "blockerId",
		});
	}

	if (
		typeof request.blockerType !== "string" ||
		!PAYROLL_BLOCKER_TYPES.includes(request.blockerType as PayrollBlockerType)
	) {
		throw new ValidationError({
			message: t("payroll.errors.invalidBlockerType", "Invalid payroll blocker type"),
			field: "blockerType",
		});
	}

	return { blockerId: request.blockerId, blockerType: request.blockerType };
}

function throwPayrollBlockerAuthorizationError(t: PayrollTranslate, userId: string): never {
	throw new AuthorizationError({
		message: t(
			"payroll.errors.blockerNotDismissible",
			"Payroll blocker cannot be dismissed",
		),
		userId,
		resource: "payroll_workspace",
		action: "write",
	});
}

async function requireActiveOrganizationEmployee(
	t: PayrollTranslate,
): Promise<AuthContext & { employee: NonNullable<AuthContext["employee"]> }> {
	const authContext = await getAuthContext();
	if (!authContext?.employee || !authContext.session.activeOrganizationId) {
		throw new AuthenticationError({
			message: t("payroll.errors.authenticationRequired", "Authentication required"),
		});
	}

	if (authContext.employee.organizationId !== authContext.session.activeOrganizationId) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.activeOrganizationEmployeeRequired",
				"Active organization employee context is required",
			),
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	return authContext as AuthContext & { employee: NonNullable<AuthContext["employee"]> };
}

function validatePayrollWorkspaceRequest(
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
): {
	start: DateTime;
	end: DateTime;
	label: string;
} {
	const start = parseISODate(t, request.startDate, "startDate");
	const end = parseISODate(t, request.endDate, "endDate");

	if (end < start) {
		throw new ValidationError({
			message: t("payroll.errors.endDateAfterStart", "End date must be on or after start date"),
			field: "endDate",
			value: request.endDate,
		});
	}

	if (typeof request.label !== "string" || request.label.trim().length === 0) {
		throw new ValidationError({
			message: t("payroll.errors.periodLabelRequired", "Payroll period label is required"),
			field: "label",
		});
	}

	return { start, end, label: request.label.trim() };
}

function parseISODate(t: PayrollTranslate, value: string, field: string): DateTime {
	if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
		throw new ValidationError({
			message: t("payroll.errors.mustBeIsoDate", "{field} must be an ISO date", { field }),
			field,
			value,
		});
	}

	const parsed = DateTime.fromISO(value, { zone: "utc" });
	if (!parsed.isValid || parsed.toISODate() !== value) {
		throw new ValidationError({
			message: t("payroll.errors.mustBeValidIsoDate", "{field} must be a valid ISO date", {
				field,
			}),
			field,
			value,
		});
	}

	return parsed;
}

function validateRequestedEmployeeIds(
	t: PayrollTranslate,
	employeeIds: string[] | undefined,
): string[] | undefined {
	if (employeeIds === undefined) return undefined;
	if (!Array.isArray(employeeIds)) {
		throw new ValidationError({
			message: t("payroll.errors.employeeIdsMustBeArray", "employeeIds must be an array"),
			field: "employeeIds",
		});
	}

	const uniqueEmployeeIds = [...new Set(employeeIds)];
	if (
		uniqueEmployeeIds.some((employeeId) => typeof employeeId !== "string" || !employeeId.trim())
	) {
		throw new ValidationError({
			message: t(
				"payroll.errors.employeeIdsMustContainOnlyStrings",
				"employeeIds must contain only strings",
			),
			field: "employeeIds",
		});
	}

	return uniqueEmployeeIds;
}

function validateExportFormatId(
	t: PayrollTranslate,
	formatId: string,
): PayrollWorkspaceExportFormatId {
	if (
		typeof formatId !== "string" ||
		!PAYROLL_WORKSPACE_EXPORT_FORMATS.includes(formatId as PayrollWorkspaceExportFormatId) ||
		!getFormatter(formatId)
	) {
		throw new ValidationError({
			message: t("payroll.errors.unknownExportFormat", "Unknown payroll export format"),
			field: "formatId",
		});
	}

	return formatId as PayrollWorkspaceExportFormatId;
}

async function runPayrollWorkspaceAction<T>(
	action: (t: PayrollTranslate) => Promise<T>,
): Promise<ServerActionResult<T>> {
	const t = await getTranslate();

	return runServerActionSafe(
		Effect.tryPromise({
			try: () => action(t),
			catch: (error) => mapPayrollWorkspaceActionError(error, t),
		}),
	);
}
