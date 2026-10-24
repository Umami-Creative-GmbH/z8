import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeEmployeeInvitationDraftId } from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import {
	getEmployeeAction,
	listEmployeesAction,
	listEmployeesForSelectAction,
} from "@/app/[locale]/(app)/settings/employees/employee-queries.actions";
import { listEmployeeEmploymentHistoryAction } from "@/app/[locale]/(app)/settings/employees/employment-history-actions";
import {
	getEmployeeEffectiveScheduleDetails,
	getWorkPolicies,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { env } from "@/env";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import { getRequestSession } from "@/lib/auth/request-session";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import type {
	EmployeeReadData,
	EmployeeReadDataset,
	EmployeeReadScope,
} from "@/lib/organization/employee-read-types";
import { superJsonResponse } from "@/lib/superjson";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

const headers = { "Cache-Control": "private, no-store" };
const directoryQuery = z.object({
	search: z.string().max(2000).optional(),
	role: z.enum(["admin", "manager", "employee", "all"]).optional(),
	status: z
		.enum(["current", "former", "draft", "all", "active", "inactive"])
		.optional(),
	limit: z.coerce.number().int().min(1).max(1000).optional(),
	offset: z.coerce.number().int().min(0).optional(),
});

const errorResponse = (error: string, status: number) =>
	NextResponse.json({ error }, { status, headers });

async function authorize(
	request: Request,
): Promise<EmployeeReadScope | NextResponse> {
	const actor = await getCurrentSettingsRouteContext();
	if (!actor) return errorResponse("Authentication required", 401);
	if (actor.accessTier === "member")
		return errorResponse("Employee settings access required", 403);
	const context = actor.authContext;
	const organizationId = context.session.activeOrganizationId;
	if (!organizationId)
		return errorResponse("No active organization selected", 403);
	if (
		request.headers.get(ORGANIZATION_CONTEXT_HEADERS.user) !==
			context.user.id ||
		request.headers.get(ORGANIZATION_CONTEXT_HEADERS.organization) !==
			organizationId
	) {
		return errorResponse("Employee context changed. Refresh to continue.", 409);
	}
	if (env.BILLING_ENABLED === "true") {
		const { requireBillingForMutation, createBillingForbiddenResponse } =
			await import("@/lib/billing/guard");
		const access = await requireBillingForMutation(organizationId);
		if (!access.canAccess) {
			const response = createBillingForbiddenResponse(access);
			response.headers.set("Cache-Control", headers["Cache-Control"]);
			return response;
		}
	}
	// The business reader separately enforces approved membership, settings tier,
	// current employee access and target/manager scope. Display headers grant none.
	return { userId: context.user.id, organizationId };
}

async function scopeIsCurrent(scope: EmployeeReadScope) {
	const session = await getRequestSession();
	return (
		session?.user.id === scope.userId &&
		session.session.activeOrganizationId === scope.organizationId &&
		!("ssoRequired" in session && session.ssoRequired === true) &&
		!("mfaRequired" in session && !!session.mfaRequired)
	);
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ dataset: string }> },
) {
	try {
		const scope = await authorize(request);
		if (scope instanceof NextResponse) return scope;
		const { dataset } = await params;
		const query = new URL(request.url).searchParams;
		let result: ServerActionResult<EmployeeReadData[EmployeeReadDataset]>;
		if (dataset === "directory") {
			const parsed = directoryQuery.safeParse(Object.fromEntries(query));
			if (!parsed.success) return errorResponse("Invalid employee query", 400);
			result = await listEmployeesAction(parsed.data);
		} else if (dataset === "work-policies") {
			const policies = await getWorkPolicies(scope.organizationId);
			result = policies.success
				? {
						success: true,
						data: policies.data.map(({ id, name }) => ({ id, name })),
					}
				: policies;
		} else {
			if (
				!["detail", "schedule", "managers", "employment-history"].includes(
					dataset,
				)
			)
				return errorResponse("Unknown employee dataset", 404);
			const employeeId = query.get("employeeId");
			let validId = false;
			try {
				validId =
					isCanonicalUuid(employeeId) ||
					(dataset === "detail" &&
						employeeId !== null &&
						isCanonicalUuid(decodeEmployeeInvitationDraftId(employeeId)));
			} catch {
				/* Malformed percent encoding is an invalid target, not a server failure. */
			}
			if (!employeeId || !validId)
				return errorResponse("Invalid employee target", 400);
			if (dataset === "detail") result = await getEmployeeAction(employeeId);
			else if (dataset === "schedule")
				result = await getEmployeeEffectiveScheduleDetails(employeeId);
			else if (dataset === "employment-history")
				result = await listEmployeeEmploymentHistoryAction(employeeId);
			else {
				const managers = await listEmployeesForSelectAction({
					roles: ["admin", "manager"],
					excludeIds: [employeeId],
					limit: 1000,
					status: "current",
				});
				result = managers.success
					? { success: true, data: managers.data.employees }
					: managers;
			}
		}
		if (!(await scopeIsCurrent(scope)))
			return errorResponse(
				"Employee context changed. Refresh to continue.",
				409,
			);
		if (!result.success) {
			const status =
				result.code === "AuthenticationError"
					? 401
					: result.code === "AuthorizationError"
						? 403
						: result.code === "NotFoundError"
							? 404
							: result.code === "ValidationError"
								? 400
								: 500;
			return errorResponse(
				status === 500 ? "Employee data could not be loaded" : result.error,
				status,
			);
		}
		return superJsonResponse(
			{ scope, data: result.data, updatedAt: Date.now() },
			{ headers },
		);
	} catch {
		return errorResponse("Employee data could not be loaded", 500);
	}
}
