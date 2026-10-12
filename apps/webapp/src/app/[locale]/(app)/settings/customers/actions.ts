"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customer, project } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import {
	keepCustomFieldRefusal,
	saveFormCustomFieldValues,
} from "@/lib/organization/custom-fields/form-values";
import type { CustomFieldValuesInput } from "@/lib/organization/custom-fields/value-rules";
import { findRecordsMissingRequiredValues } from "@/lib/organization/custom-fields/values";
import {
	ensureSettingsActorCanAccessCustomerTarget,
	ensureSettingsActorCanAccessProjectTarget,
	getManagedCustomerIdsForSettingsActor,
	getProjectSettingsActorContext,
	getProjectTarget,
} from "../projects/project-scope";

// Types
export interface CustomerData {
	id: string;
	organizationId: string;
	name: string;
	address: string | null;
	vatId: string | null;
	email: string | null;
	contactPerson: string | null;
	phone: string | null;
	website: string | null;
	isActive: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string | null;
	/** A required custom field the viewer sees has no value (#818). */
	missingRequiredCustomFields?: boolean;
}

export interface CreateCustomerInput {
	organizationId: string;
	name: string;
	projectId?: string;
	address?: string;
	vatId?: string;
	email?: string;
	contactPerson?: string;
	phone?: string;
	website?: string;
	/** The dialog's custom field values (#818); required fields are enforced when present. */
	customFieldValues?: CustomFieldValuesInput;
}

export interface UpdateCustomerInput {
	name?: string;
	address?: string | null;
	vatId?: string | null;
	email?: string | null;
	contactPerson?: string | null;
	phone?: string | null;
	website?: string | null;
	/** The dialog's custom field values (#818); required fields are enforced when present. */
	customFieldValues?: CustomFieldValuesInput;
}

/**
 * Get all customers for an organization
 */
export async function getCustomers(
	organizationId: string,
): Promise<ServerActionResult<CustomerData[]>> {
	const tracer = trace.getTracer("customers");

	const effect = tracer.startActiveSpan(
		"getCustomers",
		{
			attributes: { "organization.id": organizationId },
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					organizationId,
					queryName: "getCustomers:actor",
				});
				const managedCustomerIds = yield* getManagedCustomerIdsForSettingsActor(actor);
				const dbService = actor.dbService;

				// Fetch all active customers
				const customers = yield* dbService.query("getCustomers", async () => {
					return await db.query.customer.findMany({
						where: and(eq(customer.organizationId, organizationId), eq(customer.isActive, true)),
						orderBy: [desc(customer.createdAt)],
					});
				});

				const visibleCustomers = managedCustomerIds
					? customers.filter((customerRecord) => managedCustomerIds.has(customerRecord.id))
					: customers;
				const missingRequired = yield* dbService.query(
					"customFields.customersMissingRequired",
					() =>
						findRecordsMissingRequiredValues(dbService.db, {
							organizationId,
							entity: "customer",
							recordIds: visibleCustomers.map((customerRecord) => customerRecord.id),
							viewer: { kind: "actor", userId: actor.session.user.id },
						}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return visibleCustomers.map(
					(customerRecord): CustomerData => ({
						...(customerRecord as CustomerData),
						missingRequiredCustomFields: missingRequired.has(customerRecord.id),
					}),
				);
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get customers");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Create a new customer
 */
export async function createCustomer(
	input: CreateCustomerInput,
): Promise<ServerActionResult<{ id: string }>> {
	const tracer = trace.getTracer("customers");

	const effect = tracer.startActiveSpan(
		"createCustomer",
		{
			attributes: {
				"organization.id": input.organizationId,
				"customer.name": input.name,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					organizationId: input.organizationId,
					queryName: "createCustomer:actor",
				});
				const session = actor.session;
				const dbService = actor.dbService;

				let scopedProjectId: string | null = null;
				let scopedProjectOrganizationId: string | null = null;

				if (actor.accessTier !== "orgAdmin") {
					const projectId = input.projectId;

					if (!projectId) {
						return yield* Effect.fail(
							new AuthorizationError({
								message: "Managers can only create customers for managed projects",
								userId: session.user.id,
								resource: "customer",
								action: "create",
							}),
						);
					}

					const scopedProject = yield* getProjectTarget(projectId, "createCustomer:getProject");

					yield* ensureSettingsActorCanAccessProjectTarget(actor, scopedProject, {
						message: "You do not have access to create customers for this project",
						resource: "customer",
						action: "create",
					});

					scopedProjectId = scopedProject.id;
					scopedProjectOrganizationId = scopedProject.organizationId;
				} else if (input.projectId) {
					const scopedProject = yield* getProjectTarget(
						input.projectId,
						"createCustomer:getProjectForOrgAdmin",
					);

					if (scopedProject.organizationId !== input.organizationId) {
						yield* Effect.fail(
							new ValidationError({
								message: "Project not found",
								field: "projectId",
							}),
						);
					}

					scopedProjectId = scopedProject.id;
					scopedProjectOrganizationId = scopedProject.organizationId;
				}

				// Check for duplicate name (only among active customers)
				const existing = yield* dbService.query("checkDuplicate", async () => {
					return await db.query.customer.findFirst({
						where: and(
							eq(customer.organizationId, input.organizationId),
							eq(customer.name, input.name),
							eq(customer.isActive, true),
						),
					});
				});

				if (existing) {
					yield* Effect.fail(
						new ValidationError({
							message: "A customer with this name already exists",
							field: "name",
						}),
					);
				}

				const created = yield* dbService
					.query("customer.create", async () => {
						return await db.transaction(async (tx) => {
							const [newCustomer] = await tx
								.insert(customer)
								.values({
									organizationId: input.organizationId,
									name: input.name,
									address: input.address || null,
									vatId: input.vatId || null,
									email: input.email || null,
									contactPerson: input.contactPerson || null,
									phone: input.phone || null,
									website: input.website || null,
									isActive: true,
									createdBy: session.user.id,
									updatedAt: new Date(),
								})
								.returning();

							if (scopedProjectId && scopedProjectOrganizationId === input.organizationId) {
								await tx
									.update(project)
									.set({ customerId: newCustomer.id, updatedBy: session.user.id })
									.where(eq(project.id, scopedProjectId));
							}

							await saveFormCustomFieldValues(tx, {
								organizationId: input.organizationId,
								actorUserId: session.user.id,
								entity: "customer",
								recordId: newCustomer.id,
								values: input.customFieldValues,
							});

							return newCustomer;
						});
					})
					.pipe(keepCustomFieldRefusal);

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.CUSTOMER_CREATED,
					actorId: session.user.id,
					targetId: created.id,
					targetType: "customer",
					organizationId: input.organizationId,
					changes: { name: input.name },
					metadata: { customerName: input.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/customers");
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, input }, "Failed to create customer");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Update a customer
 */
export async function updateCustomer(
	customerId: string,
	input: UpdateCustomerInput,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("customers");

	const effect = tracer.startActiveSpan(
		"updateCustomer",
		{
			attributes: { "customer.id": customerId },
		},
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Get the customer and verify access
				const existingCustomer = yield* dbService
					.query("getCustomer", async () => {
						return await db.query.customer.findFirst({
							where: eq(customer.id, customerId),
						});
					})
					.pipe(
						Effect.flatMap((c) =>
							c
								? Effect.succeed(c)
								: Effect.fail(
										new NotFoundError({
											message: "Customer not found",
											entityType: "customer",
										}),
									),
						),
					);

				const actor = yield* getProjectSettingsActorContext({
					organizationId: existingCustomer.organizationId,
					queryName: "updateCustomer:actor",
				});
				const session = actor.session;

				yield* ensureSettingsActorCanAccessCustomerTarget(actor, existingCustomer, {
					message: "You do not have access to update this customer",
					resource: "customer",
					action: "update",
				});

				// Check for duplicate name if updating name (only among active customers)
				if (input.name && input.name !== existingCustomer.name) {
					const duplicate = yield* dbService.query("checkDuplicate", async () => {
						return await db.query.customer.findFirst({
							where: and(
								eq(customer.organizationId, existingCustomer.organizationId),
								eq(customer.name, input.name!),
								eq(customer.isActive, true),
							),
						});
					});

					if (duplicate) {
						yield* Effect.fail(
							new ValidationError({
								message: "A customer with this name already exists",
								field: "name",
							}),
						);
					}
				}

				// Build update object
				const { customFieldValues: _customFieldValues, ...customerChanges } = input;
				const updateData: Partial<typeof customer.$inferInsert> = {
					updatedBy: session.user.id,
				};

				if (input.name !== undefined) updateData.name = input.name;
				if (input.address !== undefined) updateData.address = input.address;
				if (input.vatId !== undefined) updateData.vatId = input.vatId;
				if (input.email !== undefined) updateData.email = input.email;
				if (input.contactPerson !== undefined) updateData.contactPerson = input.contactPerson;
				if (input.phone !== undefined) updateData.phone = input.phone;
				if (input.website !== undefined) updateData.website = input.website;

				// Update the customer, with the dialog's custom field values (#818) in the same transaction.
				yield* dbService
					.query("customer.update", async () => {
						await dbService.db.transaction(async (tx) => {
							await tx
								.update(customer)
								.set(updateData)
								.where(
									and(
										eq(customer.id, customerId),
										eq(customer.organizationId, existingCustomer.organizationId),
									),
								);
							await saveFormCustomFieldValues(tx, {
								organizationId: existingCustomer.organizationId,
								actorUserId: session.user.id,
								entity: "customer",
								recordId: customerId,
								values: input.customFieldValues,
							});
						});
					})
					.pipe(keepCustomFieldRefusal);

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.CUSTOMER_UPDATED,
					actorId: session.user.id,
					targetId: customerId,
					targetType: "customer",
					organizationId: existingCustomer.organizationId,
					changes: customerChanges as Record<string, unknown>,
					metadata: { previousName: existingCustomer.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/customers");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, customerId, input }, "Failed to update customer");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Delete a customer (soft delete via isActive flag)
 */
export async function deleteCustomer(customerId: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("customers");

	const effect = tracer.startActiveSpan(
		"deleteCustomer",
		{
			attributes: { "customer.id": customerId },
		},
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Get the customer
				const existingCustomer = yield* dbService
					.query("getCustomer", async () => {
						return await db.query.customer.findFirst({
							where: eq(customer.id, customerId),
						});
					})
					.pipe(
						Effect.flatMap((c) =>
							c
								? Effect.succeed(c)
								: Effect.fail(
										new NotFoundError({
											message: "Customer not found",
											entityType: "customer",
										}),
									),
						),
					);

				const actor = yield* getProjectSettingsActorContext({
					organizationId: existingCustomer.organizationId,
					queryName: "deleteCustomer:actor",
				});
				const session = actor.session;

				yield* ensureSettingsActorCanAccessCustomerTarget(actor, existingCustomer, {
					message: "You do not have access to delete this customer",
					resource: "customer",
					action: "delete",
				});

				// Soft delete. Its projects are now without customer (Billable Time, #768),
				// so their billable default switches off with it; existing work is unchanged.
				yield* dbService.query("customer.delete", async () => {
					await dbService.db.transaction(async (tx) => {
						await tx
							.update(customer)
							.set({ isActive: false, updatedBy: session.user.id })
							.where(
								and(
									eq(customer.id, customerId),
									eq(customer.organizationId, existingCustomer.organizationId),
								),
							);
						await tx
							.update(project)
							.set({ billableDefault: false, updatedBy: session.user.id })
							.where(
								and(
									eq(project.customerId, customerId),
									eq(project.organizationId, existingCustomer.organizationId),
									eq(project.billableDefault, true),
								),
							);
					});
				});

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.CUSTOMER_DELETED,
					actorId: session.user.id,
					targetId: customerId,
					targetType: "customer",
					organizationId: existingCustomer.organizationId,
					changes: { isActive: false },
					metadata: { customerName: existingCustomer.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/customers");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, customerId }, "Failed to delete customer");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get customers for selection (lightweight, for project dialog dropdown)
 * Available to any authenticated user in the organization.
 */
export async function getCustomersForSelection(
	organizationId: string,
): Promise<ServerActionResult<{ id: string; name: string }[]>> {
	const tracer = trace.getTracer("customers");

	const effect = tracer.startActiveSpan(
		"getCustomersForSelection",
		{
			attributes: { "organization.id": organizationId },
		},
		(span) => {
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					organizationId,
					queryName: "getCustomersForSelection:actor",
				});
				const managedCustomerIds = yield* getManagedCustomerIdsForSettingsActor(actor);
				const dbService = actor.dbService;

				const customers = yield* dbService.query("getCustomersForSelection", async () => {
					return await db.query.customer.findMany({
						where: and(eq(customer.organizationId, organizationId), eq(customer.isActive, true)),
						columns: { id: true, name: true },
						orderBy: [customer.name],
					});
				});

				span.setStatus({ code: SpanStatusCode.OK });
				return managedCustomerIds
					? customers.filter((customerRecord) => managedCustomerIds.has(customerRecord.id))
					: customers;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get customers for selection");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}
