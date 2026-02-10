"use server";

import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	auditLog,
	complianceConfig,
	complianceFinding,
	employee,
	type ComplianceFindingSeverity,
	type ComplianceFindingStatus,
	type ComplianceFindingType,
} from "@/db/schema";
import {
	type AnyAppError,
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	ComplianceFindingsService,
	ComplianceFindingsServiceLive,
	type ComplianceFindingWithDetails,
	type ComplianceStats,
	type FindingsWithCount,
} from "@/lib/effect/services/compliance-findings.service";
import {
	onComplianceFindingAcknowledged,
	onComplianceFindingWaived,
} from "@/lib/notifications/compliance-radar-triggers";

// ============================================
// HELPERS
// ============================================

/**
 * Helper to wrap database/async operations with proper error typing
 */
function dbEffect<T>(
	operation: string,
	fn: () => Promise<T>,
): Effect.Effect<T, AnyAppError> {
	return Effect.tryPromise({
		try: fn,
		catch: (error) =>
			new DatabaseError({
				message: `Database operation failed: ${operation}`,
				operation,
				cause: error,
			}) as AnyAppError,
	});
}

/**
 * Helper to get current employee with proper Effect typing
 */
function getCurrentEmployeeEffect() {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const dbService = yield* _(DatabaseService);
		const session = yield* _(authService.getSession());

		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", () =>
				dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				}),
			),
		);

		if (!currentEmployee) {
			return yield* _(
				Effect.fail(
					new AuthenticationError({
						message: "Employee profile not found",
						userId: session.user.id,
					}),
				),
			);
		}

		return { employee: currentEmployee, user: session.user };
	});
}

// ============================================
// TYPES
// ============================================

export interface ComplianceConfigData {
	id: string;
	organizationId: string;
	detectRestPeriodViolations: boolean;
	detectMaxHoursDaily: boolean;
	detectMaxHoursWeekly: boolean;
	detectConsecutiveDays: boolean;
	restPeriodMinutes: number | null;
	maxDailyMinutes: number | null;
	maxWeeklyMinutes: number | null;
	maxConsecutiveDays: number | null;
	employeeVisibility: boolean;
	notifyManagers: boolean;
	notifyOnSeverity: ComplianceFindingSeverity;
	teamsDigestEnabled: boolean;
	autoResolveAfterDays: number;
}

export interface GetFindingsFilters {
	employeeIds?: string[];
	types?: ComplianceFindingType[];
	severities?: ComplianceFindingSeverity[];
	statuses?: ComplianceFindingStatus[];
	dateRange?: { start: string; end: string };
}

// ============================================
// GET CONFIG
// ============================================

export async function getComplianceConfig(): Promise<ServerActionResult<ComplianceConfigData | null>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const { employee: currentEmployee } = yield* _(getCurrentEmployeeEffect());

			// Check admin/manager access
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Only admins and managers can access compliance radar settings",
						}),
					),
				);
			}

			const config = yield* _(
				dbEffect("getComplianceConfig", () =>
					db.query.complianceConfig.findFirst({
						where: eq(complianceConfig.organizationId, currentEmployee.organizationId),
					}),
				),
			);

			if (!config) {
				return null;
			}

			return {
				id: config.id,
				organizationId: config.organizationId,
				detectRestPeriodViolations: config.detectRestPeriodViolations,
				detectMaxHoursDaily: config.detectMaxHoursDaily,
				detectMaxHoursWeekly: config.detectMaxHoursWeekly,
				detectConsecutiveDays: config.detectConsecutiveDays,
				restPeriodMinutes: config.restPeriodMinutes,
				maxDailyMinutes: config.maxDailyMinutes,
				maxWeeklyMinutes: config.maxWeeklyMinutes,
				maxConsecutiveDays: config.maxConsecutiveDays,
				employeeVisibility: config.employeeVisibility,
				notifyManagers: config.notifyManagers,
				notifyOnSeverity: config.notifyOnSeverity,
				teamsDigestEnabled: config.teamsDigestEnabled,
				autoResolveAfterDays: config.autoResolveAfterDays,
			};
		}).pipe(Effect.provide(AppLayer)),
	);
}

// ============================================
// SAVE CONFIG
// ============================================

export interface SaveConfigInput {
	detectRestPeriodViolations: boolean;
	detectMaxHoursDaily: boolean;
	detectMaxHoursWeekly: boolean;
	detectConsecutiveDays: boolean;
	restPeriodMinutes: number | null;
	maxDailyMinutes: number | null;
	maxWeeklyMinutes: number | null;
	maxConsecutiveDays: number | null;
	employeeVisibility: boolean;
	notifyManagers: boolean;
	notifyOnSeverity: ComplianceFindingSeverity;
	teamsDigestEnabled: boolean;
	autoResolveAfterDays: number;
}

export async function saveComplianceConfig(
	input: SaveConfigInput,
): Promise<ServerActionResult<{ id: string }>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const { employee: currentEmployee, user } = yield* _(getCurrentEmployeeEffect());

			// Only admins can modify config
			if (currentEmployee.role !== "admin") {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Only admins can modify compliance radar configuration",
						}),
					),
				);
			}

			// Upsert config
			const existingConfig = yield* _(
				dbEffect("findExistingComplianceConfig", () =>
					db.query.complianceConfig.findFirst({
						where: eq(complianceConfig.organizationId, currentEmployee.organizationId),
					}),
				),
			);

			let configId: string;

			if (existingConfig) {
				yield* _(
					dbEffect("updateComplianceConfig", () =>
						db
							.update(complianceConfig)
							.set({
								...input,
								updatedBy: user.id,
							})
							.where(eq(complianceConfig.id, existingConfig.id)),
					),
				);
				configId = existingConfig.id;
			} else {
				const [created] = yield* _(
					dbEffect("insertComplianceConfig", () =>
						db
							.insert(complianceConfig)
							.values({
								organizationId: currentEmployee.organizationId,
								...input,
								createdBy: user.id,
							})
							.returning({ id: complianceConfig.id }),
					),
				);
				configId = created.id;
			}

			// Audit log
			yield* _(
				dbEffect("insertComplianceConfigAuditLog", () =>
					db.insert(auditLog).values({
						organizationId: currentEmployee.organizationId,
						entityType: "compliance_config",
						entityId: configId,
						action: existingConfig ? "compliance_config_updated" : "compliance_config_created",
						performedBy: user.id,
						changes: JSON.stringify({ changes: input }),
					}),
				),
			);

			revalidatePath("/settings/compliance-radar");

			return { id: configId };
		}).pipe(Effect.provide(AppLayer)),
	);
}

// ============================================
// GET FINDINGS
// ============================================

export async function getComplianceFindings(
	filters?: GetFindingsFilters,
	pagination?: { limit: number; offset: number },
): Promise<ServerActionResult<FindingsWithCount>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const findingsService = yield* _(ComplianceFindingsService);
			const { employee: currentEmployee } = yield* _(getCurrentEmployeeEffect());

			// Check admin/manager access
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Only admins and managers can view compliance findings",
						}),
					),
				);
			}

			// For managers, filter to their direct reports unless admin
			let employeeFilter = filters?.employeeIds;
			if (currentEmployee.role === "manager") {
				const subordinates = yield* _(
					dbEffect("getManagerSubordinates", () =>
						db.query.employee.findMany({
							where: eq(employee.managerId, currentEmployee.id),
							columns: { id: true },
						}),
					),
				);
				const subordinateIds = subordinates.map((s) => s.id);

				if (employeeFilter) {
					// Intersect with their subordinates
					employeeFilter = employeeFilter.filter((id) => subordinateIds.includes(id));
				} else {
					employeeFilter = subordinateIds;
				}
			}

			const dateRange = filters?.dateRange
				? {
						start: new Date(filters.dateRange.start),
						end: new Date(filters.dateRange.end),
					}
				: undefined;

			return yield* _(
				findingsService.getFindings({
					organizationId: currentEmployee.organizationId,
					filters: {
						employeeIds: employeeFilter,
						types: filters?.types,
						severities: filters?.severities,
						statuses: filters?.statuses,
						dateRange,
					},
					pagination,
				}),
			);
		}).pipe(Effect.provide(AppLayer.pipe(Layer.provide(ComplianceFindingsServiceLive)))),
	);
}

// ============================================
// GET STATS
// ============================================

export async function getComplianceStats(): Promise<ServerActionResult<ComplianceStats>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const findingsService = yield* _(ComplianceFindingsService);
			const { employee: currentEmployee } = yield* _(getCurrentEmployeeEffect());

			// Check admin/manager access
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Only admins and managers can view compliance stats",
						}),
					),
				);
			}

			return yield* _(findingsService.getStats(currentEmployee.organizationId));
		}).pipe(Effect.provide(AppLayer.pipe(Layer.provide(ComplianceFindingsServiceLive)))),
	);
}

// ============================================
// ACKNOWLEDGE FINDING
// ============================================

export async function acknowledgeFinding(
	findingId: string,
	note?: string,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const findingsService = yield* _(ComplianceFindingsService);
			const { employee: currentEmployee, user } = yield* _(getCurrentEmployeeEffect());

			// Check admin/manager access
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Only admins and managers can acknowledge findings",
						}),
					),
				);
			}

			// Verify finding belongs to this org
			const finding = yield* _(
				dbEffect("getComplianceFindingForAcknowledge", () =>
					db.query.complianceFinding.findFirst({
						where: and(
							eq(complianceFinding.id, findingId),
							eq(complianceFinding.organizationId, currentEmployee.organizationId),
						),
						with: {
							employee: {
								columns: { id: true, firstName: true, lastName: true, userId: true },
							},
						},
					}),
				),
			);

			if (!finding) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Finding not found",
							entityType: "complianceFinding",
							entityId: findingId,
						}),
					),
				);
			}

			yield* _(
				findingsService.acknowledgeFinding({
					findingId,
					acknowledgedBy: currentEmployee.id,
					note,
				}),
			);

			// Audit log
			yield* _(
				dbEffect("insertAcknowledgeAuditLog", () =>
					db.insert(auditLog).values({
						organizationId: currentEmployee.organizationId,
						entityType: "compliance_finding",
						entityId: findingId,
						action: "compliance_finding_acknowledged",
						performedBy: user.id,
						changes: JSON.stringify({ note }),
					}),
				),
			);

			// Notify employee
			if (finding.employee?.userId) {
				yield* _(
					dbEffect("notifyAcknowledgeFinding", () =>
						onComplianceFindingAcknowledged({
							findingId,
							organizationId: currentEmployee.organizationId,
							employeeUserId: finding.employee.userId,
							employeeName: `${finding.employee.firstName ?? ""} ${finding.employee.lastName ?? ""}`.trim(),
							type: finding.type,
							acknowledgerName: `${currentEmployee.firstName ?? ""} ${currentEmployee.lastName ?? ""}`.trim(),
						}),
					),
				);
			}

			revalidatePath("/settings/compliance-radar");
		}).pipe(Effect.provide(AppLayer.pipe(Layer.provide(ComplianceFindingsServiceLive)))),
	);
}

// ============================================
// WAIVE FINDING
// ============================================

export async function waiveFinding(
	findingId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const findingsService = yield* _(ComplianceFindingsService);
			const { employee: currentEmployee, user } = yield* _(getCurrentEmployeeEffect());

			// Only admins can waive
			if (currentEmployee.role !== "admin") {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Only admins can waive compliance findings",
						}),
					),
				);
			}

			if (!reason.trim()) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: "Waiver reason is required",
						}),
					),
				);
			}

			// Verify finding belongs to this org
			const finding = yield* _(
				dbEffect("getComplianceFindingForWaive", () =>
					db.query.complianceFinding.findFirst({
						where: and(
							eq(complianceFinding.id, findingId),
							eq(complianceFinding.organizationId, currentEmployee.organizationId),
						),
						with: {
							employee: {
								columns: { id: true, firstName: true, lastName: true, userId: true },
							},
						},
					}),
				),
			);

			if (!finding) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Finding not found",
							entityType: "complianceFinding",
							entityId: findingId,
						}),
					),
				);
			}

			yield* _(
				findingsService.waiveFinding({
					findingId,
					waivedBy: currentEmployee.id,
					reason,
				}),
			);

			// Audit log
			yield* _(
				dbEffect("insertWaiveAuditLog", () =>
					db.insert(auditLog).values({
						organizationId: currentEmployee.organizationId,
						entityType: "compliance_finding",
						entityId: findingId,
						action: "compliance_finding_waived",
						performedBy: user.id,
						changes: JSON.stringify({ reason }),
					}),
				),
			);

			// Notify employee
			if (finding.employee?.userId) {
				yield* _(
					dbEffect("notifyWaiveFinding", () =>
						onComplianceFindingWaived({
							findingId,
							organizationId: currentEmployee.organizationId,
							employeeUserId: finding.employee.userId,
							employeeName: `${finding.employee.firstName ?? ""} ${finding.employee.lastName ?? ""}`.trim(),
							type: finding.type,
							waiverName: `${currentEmployee.firstName ?? ""} ${currentEmployee.lastName ?? ""}`.trim(),
							waiverReason: reason,
						}),
					),
				);
			}

			revalidatePath("/settings/compliance-radar");
		}).pipe(Effect.provide(AppLayer.pipe(Layer.provide(ComplianceFindingsServiceLive)))),
	);
}

// ============================================
// RESOLVE FINDING
// ============================================

export async function resolveFinding(
	findingId: string,
	note?: string,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* (_) {
			const findingsService = yield* _(ComplianceFindingsService);
			const { employee: currentEmployee, user } = yield* _(getCurrentEmployeeEffect());

			// Check admin/manager access
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Only admins and managers can resolve findings",
						}),
					),
				);
			}

			// Verify finding belongs to this org
			const finding = yield* _(
				dbEffect("getComplianceFindingForResolve", () =>
					db.query.complianceFinding.findFirst({
						where: and(
							eq(complianceFinding.id, findingId),
							eq(complianceFinding.organizationId, currentEmployee.organizationId),
						),
					}),
				),
			);

			if (!finding) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Finding not found",
							entityType: "complianceFinding",
							entityId: findingId,
						}),
					),
				);
			}

			yield* _(
				findingsService.resolveFinding({
					findingId,
					resolvedBy: currentEmployee.id,
					note,
				}),
			);

			// Audit log
			yield* _(
				dbEffect("insertResolveAuditLog", () =>
					db.insert(auditLog).values({
						organizationId: currentEmployee.organizationId,
						entityType: "compliance_finding",
						entityId: findingId,
						action: "compliance_finding_resolved",
						performedBy: user.id,
						changes: JSON.stringify({ note }),
					}),
				),
			);

			revalidatePath("/settings/compliance-radar");
		}).pipe(Effect.provide(AppLayer.pipe(Layer.provide(ComplianceFindingsServiceLive)))),
	);
}
