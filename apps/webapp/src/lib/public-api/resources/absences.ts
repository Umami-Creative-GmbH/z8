import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
	absenceCategory,
	absenceEntry,
	absenceTypeEnum,
	dayPeriodEnum,
	employee,
	sickDetailEnum,
} from "@/db/schema";
import { defineEndpoint } from "../endpoint";
import { decodeCursor, invalidCursor, pageOf, pageQueryShape, pageSchema } from "../pagination";
import { idSchema, localDateSchema } from "../schemas";
import { checkDateRange, dateRangeShape } from "./date-range";

/** Absences the API returns: rejected ones are left out (cancelled ones no longer exist). */
const RETURNED_STATUSES = ["approved", "pending"] as const;

const dayPeriod = z
	.enum(dayPeriodEnum.enumValues)
	.describe("`full_day`, or the half day (`am`, `pm`) the absence starts or ends with.");

export const absenceSchema = z
	.object({
		id: idSchema(),
		employeeId: idSchema(),
		status: z.enum(RETURNED_STATUSES),
		startDate: localDateSchema(),
		startPeriod: dayPeriod,
		endDate: localDateSchema(),
		endPeriod: dayPeriod,
		type: z
			.enum([...absenceTypeEnum.enumValues, "absent"])
			.describe(
				"The absence category's type. A sick absence read without the key scope `absences:read-health` is plain `absent`.",
			),
		category: z
			.object({ id: idSchema(), name: z.string() })
			.nullable()
			.describe("Null for a sick absence read without `absences:read-health`."),
		sickDetail: z
			.enum(sickDetailEnum.enumValues)
			.nullable()
			.describe("The kind of sick leave. Only with `absences:read-health`, else null."),
	})
	.meta({ title: "Absence" });

type PublicAbsence = z.infer<typeof absenceSchema>;

export const listAbsences = defineEndpoint({
	method: "GET",
	path: "/api/v1/absences",
	operationId: "listAbsences",
	tag: "Absences",
	summary: "List absences",
	description: [
		"Approved and pending absences that overlap the `from`/`to` range, each with its status. Rejected and cancelled absences are left out.",
		"",
		"Dates are local calendar dates with the half day where one applies; they are never instants.",
		"",
		"Health detail: without the key scope `absences:read-health`, a sick absence is returned as `absent`, with no category and no sick detail.",
	].join("\n"),
	scope: "absences:read",
	query: z
		.object({
			...dateRangeShape,
			employeeId: z.uuid().optional().describe("Only this employee's absences."),
			status: z.enum(RETURNED_STATUSES).optional().describe("Only absences with this status."),
			...pageQueryShape,
		})
		.superRefine(checkDateRange),
	response: pageSchema(absenceSchema),
	async run({ principal, query, database }) {
		const after = query.cursor ? decodeCursor(query.cursor, ["date", "uuid"]) : null;
		if (query.cursor && !after) return invalidCursor();
		const healthDetail = principal.scopes.includes("absences:read-health");
		const rows = await database
			.select({
				id: absenceEntry.id,
				employeeId: absenceEntry.employeeId,
				status: absenceEntry.status,
				startDate: absenceEntry.startDate,
				startPeriod: absenceEntry.startPeriod,
				endDate: absenceEntry.endDate,
				endPeriod: absenceEntry.endPeriod,
				sickDetail: absenceEntry.sickDetail,
				categoryId: absenceCategory.id,
				categoryName: absenceCategory.name,
				categoryType: absenceCategory.type,
			})
			.from(absenceEntry)
			// The absence's organization is its employee's.
			.innerJoin(
				employee,
				and(
					eq(employee.id, absenceEntry.employeeId),
					eq(employee.organizationId, principal.organizationId),
				),
			)
			.innerJoin(absenceCategory, eq(absenceCategory.id, absenceEntry.categoryId))
			.where(
				and(
					inArray(absenceEntry.status, query.status ? [query.status] : [...RETURNED_STATUSES]),
					lte(absenceEntry.startDate, query.to),
					gte(absenceEntry.endDate, query.from),
					query.employeeId ? eq(absenceEntry.employeeId, query.employeeId) : undefined,
					after
						? sql`(${absenceEntry.startDate}, ${absenceEntry.id}) > (${String(after[0])}::date, ${String(after[1])}::uuid)`
						: undefined,
				),
			)
			.orderBy(asc(absenceEntry.startDate), asc(absenceEntry.id))
			.limit(query.limit + 1);

		const page = pageOf(
			rows,
			query.limit,
			(row): PublicAbsence => {
				const hidden = row.categoryType === "sick" && !healthDetail;
				return {
					id: row.id,
					employeeId: row.employeeId,
					status: row.status === "pending" ? "pending" : "approved",
					startDate: row.startDate,
					startPeriod: row.startPeriod,
					endDate: row.endDate,
					endPeriod: row.endPeriod,
					type: hidden ? "absent" : row.categoryType,
					category: hidden ? null : { id: row.categoryId, name: row.categoryName },
					sickDetail: row.categoryType === "sick" && healthDetail ? row.sickDetail : null,
				};
			},
			(row) => [row.startDate, row.id],
		);
		return { ok: true, body: page, rowCount: page.data.length };
	},
});
