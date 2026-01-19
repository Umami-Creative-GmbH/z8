/**
 * Business Logic Tracing Utilities
 *
 * Provides custom OpenTelemetry spans for key business operations.
 * Use these to gain visibility into critical workflows:
 * - Clock In/Out operations
 * - Approval workflows
 * - Report generation
 * - Data exports
 * - Vacation requests
 */

import { trace, SpanStatusCode, type Span, type SpanOptions } from "@opentelemetry/api";

// Create a tracer for business operations
const tracer = trace.getTracer("z8-business", "1.0.0");

/**
 * Standard attributes for business spans
 */
export interface BusinessSpanAttributes {
	"business.operation"?: string;
	"business.entity.type"?: string;
	"business.entity.id"?: string;
	"user.id"?: string;
	"organization.id"?: string;
	"employee.id"?: string;
	[key: string]: string | number | boolean | undefined;
}

/**
 * Wrap an async function with a traced span
 * Automatically handles errors and span lifecycle
 */
export async function withSpan<T>(
	name: string,
	attributes: BusinessSpanAttributes,
	fn: (span: Span) => Promise<T>,
	options?: SpanOptions,
): Promise<T> {
	return tracer.startActiveSpan(name, options ?? {}, async (span) => {
		// Set initial attributes
		for (const [key, value] of Object.entries(attributes)) {
			if (value !== undefined) {
				span.setAttribute(key, value);
			}
		}

		try {
			const result = await fn(span);
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (error) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: error instanceof Error ? error.message : "Unknown error",
			});
			span.recordException(error instanceof Error ? error : new Error(String(error)));
			throw error;
		} finally {
			span.end();
		}
	});
}

/**
 * Trace a clock-in operation
 */
export async function traceClockIn<T>(
	employeeId: string,
	organizationId: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withSpan(
		"clock-in",
		{
			"business.operation": "clock-in",
			"business.entity.type": "time_entry",
			"employee.id": employeeId,
			"organization.id": organizationId,
		},
		fn,
	);
}

/**
 * Trace a clock-out operation
 */
export async function traceClockOut<T>(
	employeeId: string,
	organizationId: string,
	workPeriodId: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withSpan(
		"clock-out",
		{
			"business.operation": "clock-out",
			"business.entity.type": "work_period",
			"business.entity.id": workPeriodId,
			"employee.id": employeeId,
			"organization.id": organizationId,
		},
		fn,
	);
}

/**
 * Trace an approval workflow action
 */
export async function traceApproval<T>(
	action: "approve" | "reject" | "request",
	requestId: string,
	organizationId: string,
	userId: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withSpan(
		`approval-${action}`,
		{
			"business.operation": `approval-${action}`,
			"business.entity.type": "approval_request",
			"business.entity.id": requestId,
			"organization.id": organizationId,
			"user.id": userId,
		},
		fn,
	);
}

/**
 * Trace report generation
 */
export async function traceReportGeneration<T>(
	reportType: string,
	organizationId: string,
	userId: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withSpan(
		"generate-report",
		{
			"business.operation": "generate-report",
			"business.entity.type": "report",
			"report.type": reportType,
			"organization.id": organizationId,
			"user.id": userId,
		},
		fn,
	);
}

/**
 * Trace data export
 */
export async function traceDataExport<T>(
	exportId: string,
	organizationId: string,
	categories: string[],
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withSpan(
		"data-export",
		{
			"business.operation": "data-export",
			"business.entity.type": "export",
			"business.entity.id": exportId,
			"organization.id": organizationId,
			"export.categories": categories.join(","),
		},
		fn,
	);
}

/**
 * Trace vacation request
 */
export async function traceVacationRequest<T>(
	action: "create" | "approve" | "reject" | "cancel",
	employeeId: string,
	organizationId: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withSpan(
		`vacation-${action}`,
		{
			"business.operation": `vacation-${action}`,
			"business.entity.type": "vacation_request",
			"employee.id": employeeId,
			"organization.id": organizationId,
		},
		fn,
	);
}

/**
 * Trace employee onboarding
 */
export async function traceOnboarding<T>(
	step: string,
	userId: string,
	organizationId: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withSpan(
		"onboarding",
		{
			"business.operation": "onboarding",
			"business.entity.type": "user",
			"onboarding.step": step,
			"user.id": userId,
			"organization.id": organizationId,
		},
		fn,
	);
}

/**
 * Add a custom event to the current span
 * Use this for notable events within a traced operation
 */
export function addSpanEvent(
	name: string,
	attributes?: Record<string, string | number | boolean>,
): void {
	const span = trace.getActiveSpan();
	if (span) {
		span.addEvent(name, attributes);
	}
}

/**
 * Set additional attributes on the current span
 */
export function setSpanAttributes(attributes: BusinessSpanAttributes): void {
	const span = trace.getActiveSpan();
	if (span) {
		for (const [key, value] of Object.entries(attributes)) {
			if (value !== undefined) {
				span.setAttribute(key, value);
			}
		}
	}
}
