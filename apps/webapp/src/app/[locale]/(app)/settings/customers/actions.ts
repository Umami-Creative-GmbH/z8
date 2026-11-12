"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { customer, project } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import {
	keepCustomFieldRefusal,
	saveFormCustomFieldValues,
} from "@/lib/organization/custom-fields/form-values";
import { findRecordsMissingRequiredValues } from "@/lib/organization/custom-fields/values";
import {
	getManagedCustomerIdsForSettingsActor,
	reachesCustomer,
	reachesProject,
} from "../projects/project-scope";
import {
	customFieldValuesSchema,
	loadOrganizationCustomer,
	loadOrganizationProject,
	projectSettingsActorOf,
} from "../projects/project-settings-actor";

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

const customerNameSchema = z.string().trim().min(1, "Customer name is required");

const createCustomerSchema = z.strictObject({
	name: customerNameSchema,
	/** The project the new customer is attached to; a scoped manager must name one they manage. */
	projectId: z.string().min(1).optional(),
	address: z.string().optional(),
	vatId: z.string().optional(),
	email: z.string().optional(),
	contactPerson: z.string().optional(),
	phone: z.string().optional(),
	website: z.string().optional(),
	/** The dialog's custom field values (#818); required fields are enforced when present. */
	customFieldValues: customFieldValuesSchema.optional(),
});

const customerChangesSchema = z.strictObject({
	customerId: z.string().min(1),
	name: customerNameSchema.optional(),
	address: z.string().nullable().optional(),
	vatId: z.string().nullable().optional(),
	email: z.string().nullable().optional(),
	contactPerson: z.string().nullable().optional(),
	phone: z.string().nullable().optional(),
	website: z.string().nullable().optional(),
	/** The dialog's custom field values (#818); required fields are enforced when present. */
	customFieldValues: customFieldValuesSchema.optional(),
});

export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
/** The customer dialog's changes; fields left out keep their value. */
export type UpdateCustomerInput = Omit<z.input<typeof customerChangesSchema>, "customerId">;

/**
 * Get the organization's active customers: an org admin's all, a scoped
 * manager's those only their managed projects use.
 */
export const getCustomers = organizationAction(
	{ name: "customers.list", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const managedCustomerIds = yield* getManagedCustomerIdsForSettingsActor(projectActor);
			const dbService = yield* DatabaseService;

			const customers = yield* dbService.query("getCustomers", async () => {
				return await dbService.db.query.customer.findMany({
					where: and(eq(customer.organizationId, organizationId), eq(customer.isActive, true)),
					orderBy: [desc(customer.createdAt)],
				});
			});

			const visibleCustomers = managedCustomerIds
				? customers.filter((customerRecord) => managedCustomerIds.has(customerRecord.id))
				: customers;
			const missingRequired = yield* dbService.query("customFields.customersMissingRequired", () =>
				findRecordsMissingRequiredValues(dbService.db, {
					organizationId,
					entity: "customer",
					recordIds: visibleCustomers.map((customerRecord) => customerRecord.id),
					viewer: { kind: "actor", userId: actor.userId },
				}),
			);

			return visibleCustomers.map(
				(customerRecord): CustomerData => ({
					...(customerRecord as CustomerData),
					missingRequiredCustomFields: missingRequired.has(customerRecord.id),
				}),
			);
		}),
);

/**
 * Create a new customer. A scoped manager creates one only for a project they
 * manage, which it is attached to.
 */
export const createCustomer = organizationAction(
	{ name: "customers.create", requires: "scopedManager", schema: createCustomerSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			if (projectActor.accessTier !== "orgAdmin" && !input.projectId) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Managers can only create customers for managed projects",
						userId: actor.userId,
						resource: "customer",
						action: "create",
					}),
				);
			}

			const scopedProject = input.projectId
				? yield* loadOrganizationProject(organizationId, input.projectId)
				: null;
			if (scopedProject) {
				yield* refuseUnless(yield* reachesProject(projectActor, scopedProject), {
					userId: projectActor.session.user.id,
					message: "You do not have access to create customers for this project",
					resource: "customer",
					action: "create",
				});
			}

			// Duplicate names are refused among active customers only.
			const existing = yield* dbService.query("checkDuplicate", async () => {
				return await dbService.db.query.customer.findFirst({
					where: and(
						eq(customer.organizationId, organizationId),
						eq(customer.name, input.name),
						eq(customer.isActive, true),
					),
				});
			});

			if (existing) {
				return yield* Effect.fail(
					new ValidationError({
						message: "A customer with this name already exists",
						field: "name",
					}),
				);
			}

			const created = yield* dbService
				.query("customer.create", async () => {
					return await dbService.db.transaction(async (tx) => {
						const [newCustomer] = await tx
							.insert(customer)
							.values({
								organizationId,
								name: input.name,
								address: input.address || null,
								vatId: input.vatId || null,
								email: input.email || null,
								contactPerson: input.contactPerson || null,
								phone: input.phone || null,
								website: input.website || null,
								isActive: true,
								createdBy: actor.userId,
								updatedAt: new Date(),
							})
							.returning();

						if (scopedProject) {
							await tx
								.update(project)
								.set({ customerId: newCustomer.id, updatedBy: actor.userId })
								.where(
									and(eq(project.id, scopedProject.id), eq(project.organizationId, organizationId)),
								);
						}

						await saveFormCustomFieldValues(tx, {
							organizationId,
							actorUserId: actor.userId,
							entity: "customer",
							recordId: newCustomer.id,
							values: input.customFieldValues,
						});

						return newCustomer;
					});
				})
				.pipe(keepCustomFieldRefusal);

			logAudit({
				action: AuditAction.CUSTOMER_CREATED,
				actorId: actor.userId,
				targetId: created.id,
				targetType: "customer",
				organizationId,
				changes: { name: input.name },
				metadata: { customerName: input.name },
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/customers");
			return { id: created.id };
		}),
);

/**
 * Update a customer.
 */
export const updateCustomer = organizationAction(
	{ name: "customers.update", requires: "scopedManager", schema: customerChangesSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { customerId, customFieldValues, ...customerChanges } = input;
			const existingCustomer = yield* loadOrganizationCustomer(organizationId, customerId);
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			yield* refuseUnless(yield* reachesCustomer(projectActor, existingCustomer), {
				userId: projectActor.session.user.id,
				message: "You do not have access to update this customer",
				resource: "customer",
				action: "update",
			});

			// Duplicate names are refused among active customers only.
			if (input.name && input.name !== existingCustomer.name) {
				const duplicate = yield* dbService.query("checkDuplicate", async () => {
					return await dbService.db.query.customer.findFirst({
						where: and(
							eq(customer.organizationId, organizationId),
							eq(customer.name, input.name!),
							eq(customer.isActive, true),
						),
					});
				});

				if (duplicate) {
					return yield* Effect.fail(
						new ValidationError({
							message: "A customer with this name already exists",
							field: "name",
						}),
					);
				}
			}

			const updateData: Partial<typeof customer.$inferInsert> = {
				updatedBy: actor.userId,
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
							.where(and(eq(customer.id, customerId), eq(customer.organizationId, organizationId)));
						await saveFormCustomFieldValues(tx, {
							organizationId,
							actorUserId: actor.userId,
							entity: "customer",
							recordId: customerId,
							values: customFieldValues,
						});
					});
				})
				.pipe(keepCustomFieldRefusal);

			logAudit({
				action: AuditAction.CUSTOMER_UPDATED,
				actorId: actor.userId,
				targetId: customerId,
				targetType: "customer",
				organizationId,
				changes: customerChanges as Record<string, unknown>,
				metadata: { previousName: existingCustomer.name },
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/customers");
		}),
);

/**
 * Delete a customer (soft delete via isActive flag).
 */
export const deleteCustomer = organizationAction(
	{
		name: "customers.delete",
		requires: "scopedManager",
		schema: z.strictObject({ customerId: z.string().min(1) }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { customerId } = input;
			const existingCustomer = yield* loadOrganizationCustomer(organizationId, customerId);
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			yield* refuseUnless(yield* reachesCustomer(projectActor, existingCustomer), {
				userId: projectActor.session.user.id,
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
						.set({ isActive: false, updatedBy: actor.userId })
						.where(and(eq(customer.id, customerId), eq(customer.organizationId, organizationId)));
					await tx
						.update(project)
						.set({ billableDefault: false, updatedBy: actor.userId })
						.where(
							and(
								eq(project.customerId, customerId),
								eq(project.organizationId, organizationId),
								eq(project.billableDefault, true),
							),
						);
				});
			});

			logAudit({
				action: AuditAction.CUSTOMER_DELETED,
				actorId: actor.userId,
				targetId: customerId,
				targetType: "customer",
				organizationId,
				changes: { isActive: false },
				metadata: { customerName: existingCustomer.name },
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/customers");
		}),
);

/**
 * Get customers for selection (lightweight, for the project dialog dropdown),
 * in the caller's customer scope.
 */
export const getCustomersForSelection = organizationAction(
	{ name: "customers.forSelection", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const managedCustomerIds = yield* getManagedCustomerIdsForSettingsActor(projectActor);
			const dbService = yield* DatabaseService;

			const customers = yield* dbService.query("getCustomersForSelection", async () => {
				return await dbService.db.query.customer.findMany({
					where: and(eq(customer.organizationId, organizationId), eq(customer.isActive, true)),
					columns: { id: true, name: true },
					orderBy: [customer.name],
				});
			});

			return managedCustomerIds
				? customers.filter((customerRecord) => managedCustomerIds.has(customerRecord.id))
				: customers;
		}),
);
