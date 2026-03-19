"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customer, employee, project } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import {
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { AuthService, AuthServiceLive } from "@/lib/effect/services/auth.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
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
}

export interface UpdateCustomerInput {
	name?: string;
	address?: string | null;
	vatId?: string | null;
	email?: string | null;
	contactPerson?: string | null;
	phone?: string | null;
	website?: string | null;
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
			return Effect.gen(function* (_) {
				const actor = yield* _(
					getProjectSettingsActorContext({ organizationId, queryName: "getCustomers:actor" }),
				);
				const managedCustomerIds = yield* _(getManagedCustomerIdsForSettingsActor(actor));
				const dbService = actor.dbService;

				// Fetch all active customers
				const customers = yield* _(
					dbService.query("getCustomers", async () => {
						return await db.query.customer.findMany({
							where: and(
								eq(customer.organizationId, organizationId),
								eq(customer.isActive, true),
							),
							orderBy: [desc(customer.createdAt)],
						});
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return managedCustomerIds
					? (customers.filter((customerRecord) => managedCustomerIds.has(customerRecord.id)) as CustomerData[])
					: (customers as CustomerData[]);
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get customers");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then((data) => ({ success: true as const, data }))
		.catch((error) => ({
			success: false as const,
			error: error?.message || "Failed to get customers",
		}));
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
			return Effect.gen(function* (_) {
				const actor = yield* _(
					getProjectSettingsActorContext({ organizationId: input.organizationId, queryName: "createCustomer:actor" }),
				);
				const session = actor.session;
				const dbService = actor.dbService;

				let scopedProjectId: string | null = null;
				let scopedProjectOrganizationId: string | null = null;

				if (actor.accessTier !== "orgAdmin") {
					const projectId = input.projectId;

					if (!projectId) {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Managers can only create customers for managed projects",
									userId: session.user.id,
									resource: "customer",
									action: "create",
								}),
							),
						);
					}

					const scopedProject = yield* _(getProjectTarget(projectId, "createCustomer:getProject"));

					yield* _(
						ensureSettingsActorCanAccessProjectTarget(actor, scopedProject, {
							message: "You do not have access to create customers for this project",
							resource: "customer",
							action: "create",
						}),
					);

					scopedProjectId = scopedProject.id;
					scopedProjectOrganizationId = scopedProject.organizationId;
				} else if (input.projectId) {
					const scopedProject = yield* _(getProjectTarget(input.projectId, "createCustomer:getProjectForOrgAdmin"));

					if (scopedProject.organizationId !== input.organizationId) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Project not found",
									field: "projectId",
								}),
							),
						);
					}

					scopedProjectId = scopedProject.id;
					scopedProjectOrganizationId = scopedProject.organizationId;
				}

				// Check for duplicate name (only among active customers)
				const existing = yield* _(
					dbService.query("checkDuplicate", async () => {
						return await db.query.customer.findFirst({
							where: and(
								eq(customer.organizationId, input.organizationId),
								eq(customer.name, input.name),
								eq(customer.isActive, true),
							),
						});
					}),
				);

				if (existing) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "A customer with this name already exists",
								field: "name",
							}),
						),
					);
				}

				const created = yield* _(
					Effect.tryPromise({
						try: async () => {
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

								return newCustomer;
							});
						},
						catch: (error) =>
							new DatabaseError({
								message: error instanceof Error ? error.message : "Failed to create customer",
								operation: "transaction",
								table: "customer",
							}),
					}),
				);

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, input }, "Failed to create customer");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then((data) => ({ success: true as const, data }))
		.catch((error) => ({
			success: false as const,
			error: error?.message || "Failed to create customer",
		}));
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
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);

				// Get the customer and verify access
				const existingCustomer = yield* _(
					dbService.query("getCustomer", async () => {
						return await db.query.customer.findFirst({
							where: eq(customer.id, customerId),
						});
					}),
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

				const actor = yield* _(
					getProjectSettingsActorContext({
						organizationId: existingCustomer.organizationId,
						queryName: "updateCustomer:actor",
					}),
				);
				const session = actor.session;

				yield* _(
					ensureSettingsActorCanAccessCustomerTarget(actor, existingCustomer, {
						message: "You do not have access to update this customer",
						resource: "customer",
						action: "update",
					}),
				);

				// Check for duplicate name if updating name (only among active customers)
				if (input.name && input.name !== existingCustomer.name) {
					const duplicate = yield* _(
						dbService.query("checkDuplicate", async () => {
							return await db.query.customer.findFirst({
								where: and(
									eq(customer.organizationId, existingCustomer.organizationId),
									eq(customer.name, input.name!),
									eq(customer.isActive, true),
								),
							});
						}),
					);

					if (duplicate) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "A customer with this name already exists",
									field: "name",
								}),
							),
						);
					}
				}

				// Build update object
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

				// Update the customer
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.update(customer).set(updateData).where(eq(customer.id, customerId));
						},
						catch: (error) =>
							new DatabaseError({
								message: error instanceof Error ? error.message : "Failed to update customer",
								operation: "update",
								table: "customer",
							}),
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.CUSTOMER_UPDATED,
					actorId: session.user.id,
					targetId: customerId,
					targetType: "customer",
					organizationId: existingCustomer.organizationId,
					changes: input as Record<string, unknown>,
					metadata: { previousName: existingCustomer.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/customers");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, customerId, input }, "Failed to update customer");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then(() => ({ success: true as const, data: undefined }))
		.catch((error) => ({
			success: false as const,
			error: error?.message || "Failed to update customer",
		}));
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
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);

				// Get the customer
				const existingCustomer = yield* _(
					dbService.query("getCustomer", async () => {
						return await db.query.customer.findFirst({
							where: eq(customer.id, customerId),
						});
					}),
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

				const actor = yield* _(
					getProjectSettingsActorContext({
						organizationId: existingCustomer.organizationId,
						queryName: "deleteCustomer:actor",
					}),
				);
				const session = actor.session;

				yield* _(
					ensureSettingsActorCanAccessCustomerTarget(actor, existingCustomer, {
						message: "You do not have access to delete this customer",
						resource: "customer",
						action: "delete",
					}),
				);

				// Soft delete
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.update(customer)
								.set({ isActive: false, updatedBy: session.user.id })
								.where(eq(customer.id, customerId));
						},
						catch: (error) =>
							new DatabaseError({
								message: error instanceof Error ? error.message : "Failed to delete customer",
								operation: "update",
								table: "customer",
							}),
					}),
				);

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, customerId }, "Failed to delete customer");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then(() => ({ success: true as const, data: undefined }))
		.catch((error) => ({
			success: false as const,
			error: error?.message || "Failed to delete customer",
		}));
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
			return Effect.gen(function* (_) {
				const actor = yield* _(
					getProjectSettingsActorContext({ organizationId, queryName: "getCustomersForSelection:actor" }),
				);
				const managedCustomerIds = yield* _(getManagedCustomerIdsForSettingsActor(actor));
				const dbService = actor.dbService;

				const customers = yield* _(
					dbService.query("getCustomersForSelection", async () => {
						return await db.query.customer.findMany({
							where: and(
								eq(customer.organizationId, organizationId),
								eq(customer.isActive, true),
							),
							columns: { id: true, name: true },
							orderBy: [customer.name],
						});
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return managedCustomerIds
					? customers.filter((customerRecord) => managedCustomerIds.has(customerRecord.id))
					: customers;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get customers for selection");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then((data) => ({ success: true as const, data }))
		.catch((error) => ({
			success: false as const,
			error: error?.message || "Failed to get customers",
		}));
}
