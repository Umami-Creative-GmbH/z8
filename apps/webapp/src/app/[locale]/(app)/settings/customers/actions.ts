"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customer, employee } from "@/db/schema";
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
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can manage customers",
										userId: session.user.id,
										resource: "customer",
										action: "read",
									}),
								),
					),
				);

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
				return customers as CustomerData[];
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
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, input.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can create customers",
										userId: session.user.id,
										resource: "customer",
										action: "create",
									}),
								),
					),
				);

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

				// Create the customer
				const [created] = yield* _(
					Effect.tryPromise({
						try: async () => {
							return await db
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
						},
						catch: (error) =>
							new DatabaseError({
								message: error instanceof Error ? error.message : "Failed to create customer",
								operation: "insert",
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
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
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

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, existingCustomer.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can update customers",
										userId: session.user.id,
										resource: "customer",
										action: "update",
									}),
								),
					),
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
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
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

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, existingCustomer.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can delete customers",
										userId: session.user.id,
										resource: "customer",
										action: "delete",
									}),
								),
					),
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
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Verify the user belongs to this organization
				yield* _(
					dbService.query("verifyOrgMembership", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Not a member of this organization",
										userId: session.user.id,
										resource: "customer",
										action: "read",
									}),
								),
					),
				);

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
				return customers;
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
