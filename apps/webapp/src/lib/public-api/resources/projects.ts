import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { project, projectStatusEnum } from "@/db/schema";
import { defineEndpoint } from "../endpoint";
import { decodeCursor, invalidCursor, pageOf, pageQueryShape, pageSchema } from "../pagination";
import { idSchema } from "../schemas";

export const projectSchema = z
	.object({
		id: idSchema(),
		name: z.string(),
		status: z.enum(projectStatusEnum.enumValues),
		customerId: idSchema().nullable(),
	})
	.meta({ title: "Project" });

export const listProjects = defineEndpoint({
	method: "GET",
	path: "/api/v1/projects",
	operationId: "listProjects",
	tag: "Projects",
	summary: "List projects",
	description:
		"The organization's projects with their status and customer. Budgets, rates and members are never returned.",
	scope: "projects:read",
	query: z.object({
		...pageQueryShape,
		status: z
			.enum(projectStatusEnum.enumValues)
			.optional()
			.describe("Only projects with this status. All by default."),
		customerId: z.uuid().optional().describe("Only the projects of this customer."),
	}),
	response: pageSchema(projectSchema),
	async run({ principal, query, database }) {
		const after = query.cursor ? decodeCursor(query.cursor, ["uuid"]) : null;
		if (query.cursor && !after) return invalidCursor();
		const rows = await database
			.select({
				id: project.id,
				name: project.name,
				status: project.status,
				customerId: project.customerId,
			})
			.from(project)
			.where(
				and(
					eq(project.organizationId, principal.organizationId),
					query.status ? eq(project.status, query.status) : undefined,
					query.customerId ? eq(project.customerId, query.customerId) : undefined,
					after ? gt(project.id, String(after[0])) : undefined,
				),
			)
			.orderBy(asc(project.id))
			.limit(query.limit + 1);
		const page = pageOf(
			rows,
			query.limit,
			(row) => row,
			(row) => [row.id],
		);
		return { ok: true, body: page, rowCount: page.data.length };
	},
});
