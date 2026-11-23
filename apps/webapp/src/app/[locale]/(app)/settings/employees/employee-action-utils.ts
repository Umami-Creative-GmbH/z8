import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { member, user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import { createLogger } from "@/lib/logger";
import {
	meetsSettingsAccess,
	type SettingsAccess,
	settingsAccessOf,
} from "@/lib/organization-action/settings-access";

const settingsAccessLogger = createLogger("EmployeeSettingsAccess");

/**
 * The caller's employee-settings tier for reads outside the settings actions:
 * the employee picker (`selectable-employees.ts`, also used by scheduling) and
 * the employee detail read API. Settings actions use `organizationAction`.
 */
export function getEmployeeSettingsActorContext(options?: {
	organizationId?: string;
	queryName?: string;
}) {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession(options?.organizationId);
		const dbService = yield* DatabaseService;
		const organizationId = options?.organizationId ?? session.session.activeOrganizationId;
		const queryName = options?.queryName ?? "getEmployeeSettingsActor";
		const logDenial = (
			reason:
				| "no_organization"
				| "no_approved_membership"
				| "inactive_employee"
				| "insufficient_role",
			membershipRecord: { role: string; status?: string | null } | null,
			employeeRecord: Pick<typeof employee.$inferSelect, "id" | "role" | "isActive"> | null,
			settingsAccess: SettingsAccess | null = null,
			membershipLookupFailed = false,
		) =>
			Effect.sync(() => {
				settingsAccessLogger.warn(
					{
						event: "employee_settings_access_denied",
						operation: queryName,
						reason,
						userId: session.user.id,
						organizationId,
						activeOrganizationId: session.session.activeOrganizationId,
						requestedOrganizationId: options?.organizationId ?? null,
						membershipRole: membershipRecord?.role ?? null,
						membershipStatus: membershipRecord?.status ?? null,
						membershipLookupFailed,
						employeeId: employeeRecord?.id ?? null,
						employeeRole: employeeRecord?.role ?? null,
						employeeIsActive: employeeRecord?.isActive ?? null,
						settingsAccess,
					},
					"[DEBUG-employee-settings-access] Authorization denied",
				);
			});

		if (!organizationId) {
			yield* logDenial("no_organization", null, null);
			return yield* Effect.fail(
				new AuthorizationError({
					message: "No active organization selected",
					userId: session.user.id,
					resource: "employee_settings",
					action: "access",
				}),
			);
		}

		const [membershipRecord, employeeRecord] = yield* Effect.all([
			dbService.query(
				`${options?.queryName ?? "getEmployeeSettingsActor"}:membership`,
				async () => {
					return await dbService.db.query.member.findFirst({
						where: and(
							eq(member.userId, session.user.id),
							eq(member.organizationId, organizationId),
							eq(member.status, "approved"),
						),
						columns: { role: true, status: true },
					});
				},
			),
			dbService.query(`${options?.queryName ?? "getEmployeeSettingsActor"}:employee`, async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, organizationId),
					),
					extras: {
						former: isFormerEmployee(employee).as("former"),
					},
				});
			}),
		]);

		if (!membershipRecord) {
			// The probe runs only after denial and cannot change its authorization result.
			const diagnostic = yield* dbService
				.query(queryName + ":deniedMembershipDiagnostic", async () => {
					return await dbService.db.query.member.findFirst({
						where: and(
							eq(member.userId, session.user.id),
							eq(member.organizationId, organizationId),
						),
						columns: { role: true, status: true },
					});
				})
				.pipe(
					Effect.map((record) => ({ record: record ?? null, failed: false })),
					Effect.catch(() => Effect.succeed({ record: null, failed: true })),
				);
			yield* logDenial(
				"no_approved_membership",
				diagnostic.record,
				employeeRecord ?? null,
				null,
				diagnostic.failed,
			);
			return yield* Effect.fail(
				new AuthorizationError({
					message: "You do not have access to employee settings",
					userId: session.user.id,
					resource: "employee_settings",
					action: "access",
				}),
			);
		}

		const employeeIsFormer = employeeRecord
			? Boolean(employeeRecord.former || employeeRecord.isActive === false)
			: false;

		if (employeeRecord && employeeIsFormer) {
			yield* logDenial("inactive_employee", membershipRecord, employeeRecord);
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Organization access is inactive",
					userId: session.user.id,
					resource: "employee_settings",
					action: "access",
				}),
			);
		}

		const settingsAccess = settingsAccessOf({
			membershipRole: membershipRecord.role,
			employee: employeeRecord
				? {
						id: employeeRecord.id,
						role: employeeRecord.role,
						former: employeeIsFormer,
					}
				: null,
		});

		if (!settingsAccess || !meetsSettingsAccess(settingsAccess, "scopedManager")) {
			yield* logDenial(
				"insufficient_role",
				membershipRecord,
				employeeRecord ?? null,
				settingsAccess,
			);
			return yield* Effect.fail(
				new AuthorizationError({
					message: "You do not have access to employee settings",
					userId: session.user.id,
					resource: "employee_settings",
					action: "access",
				}),
			);
		}

		return {
			session,
			dbService,
			organizationId,
			settingsAccess,
			currentEmployee: employeeRecord ? (employeeRecord as typeof employee.$inferSelect) : null,
		};
	});
}

export function getTargetUser(userId: string, queryName = "getTargetUser") {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		return yield* dbService
			.query(queryName, async () => {
				return await dbService.db.query.user.findFirst({
					where: eq(user.id, userId),
				});
			})
			.pipe(
				Effect.flatMap((value) =>
					value
						? Effect.succeed(value)
						: Effect.fail(
								new NotFoundError({
									message: "User not found",
									entityType: "user",
									entityId: userId,
								}),
							),
				),
			);
	});
}

export function parseHourlyRate(value?: string | null) {
	return value ? Number.parseFloat(value) : null;
}

export function revalidateEmployeesCache(organizationId: string) {
	revalidateTag(CACHE_TAGS.EMPLOYEES(organizationId), "max");
}
