import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { customer } from "@/db/schema";
import { defineEndpoint } from "../endpoint";
import { decodeCursor, invalidCursor, pageOf, pageQueryShape, pageSchema } from "../pagination";
import { idSchema } from "../schemas";

const customerStatus = z
	.enum(["active", "inactive"])
	.describe("`inactive` once the customer was removed in Z8; its projects and work keep it.");

export const customerSchema = z
	.object({
		id: idSchema(),
		name: z.string(),
		status: customerStatus,
	})
	.meta({ title: "Customer" });

export const listCustomers = defineEndpoint({
	method: "GET",
	path: "/api/v1/customers",
	operationId: "listCustomers",
	tag: "Customers",
	summary: "List customers",
	description:
		"The organization's customers, active and inactive. Contact details and tax data are never returned.",
	scope: "customers:read",
	query: z.object({
		...pageQueryShape,
		status: customerStatus.optional().describe("Only customers with this status. Both by default."),
	}),
	response: pageSchema(customerSchema),
	async run({ principal, query, database }) {
		const after = query.cursor ? decodeCursor(query.cursor, ["uuid"]) : null;
		if (query.cursor && !after) return invalidCursor();
		const rows = await database
			.select({ id: customer.id, name: customer.name, isActive: customer.isActive })
			.from(customer)
			.where(
				and(
					eq(customer.organizationId, principal.organizationId),
					query.status ? eq(customer.isActive, query.status === "active") : undefined,
					after ? gt(customer.id, String(after[0])) : undefined,
				),
			)
			.orderBy(asc(customer.id))
			.limit(query.limit + 1);
		const page = pageOf(
			rows,
			query.limit,
			(row) => ({
				id: row.id,
				name: row.name,
				status: row.isActive ? ("active" as const) : ("inactive" as const),
			}),
			(row) => [row.id],
		);
		return { ok: true, body: page, rowCount: page.data.length };
	},
});
