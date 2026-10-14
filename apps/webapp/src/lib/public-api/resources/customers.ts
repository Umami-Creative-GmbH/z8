import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { customer } from "@/db/schema";
import { defineEndpoint } from "../endpoint";
import { decodeCursor, invalidCursor, pageOf, pageQueryShape, pageSchema } from "../pagination";
import { idSchema } from "../schemas";
import {
	asOfQueryShape,
	asOfResponseShape,
	customFieldsSchema,
	readPageCustomFields,
} from "./custom-fields";

const customerStatus = z
	.enum(["active", "inactive"])
	.describe("`inactive` once the customer was removed in Z8; its projects and work keep it.");

export const customerSchema = z
	.object({
		id: idSchema(),
		name: z.string(),
		status: customerStatus,
		customFields: customFieldsSchema,
	})
	.meta({ title: "Customer" });

export const listCustomers = defineEndpoint({
	method: "GET",
	path: "/api/v1/customers",
	operationId: "listCustomers",
	tag: "Customers",
	summary: "List customers",
	description: [
		"The organization's customers, active and inactive. Contact details and tax data are never returned.",
		"",
		"Each customer carries its custom field values as of `asOf` in `customFields`, keyed by field id; `GET /api/v1/customers/custom-fields` describes the fields.",
	].join("\n"),
	scope: "customers:read",
	query: z.object({
		...pageQueryShape,
		status: customerStatus.optional().describe("Only customers with this status. Both by default."),
		...asOfQueryShape,
	}),
	response: pageSchema(customerSchema).extend(asOfResponseShape),
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
		const customFields = await readPageCustomFields(database, {
			principal,
			entity: "customer",
			recordIds: rows.slice(0, query.limit).map((row) => row.id),
			asOf: query.asOf,
		});
		const page = pageOf(
			rows,
			query.limit,
			(row) => ({
				id: row.id,
				name: row.name,
				status: row.isActive ? ("active" as const) : ("inactive" as const),
				customFields: customFields.of(row.id),
			}),
			(row) => [row.id],
		);
		return {
			ok: true,
			body: { ...page, asOf: customFields.asOf },
			rowCount: page.data.length,
		};
	},
});
