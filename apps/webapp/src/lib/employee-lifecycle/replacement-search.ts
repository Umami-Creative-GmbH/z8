import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { onCurrentRoster } from "./current-roster";
import type { ReplacementEmployeeOption, SearchReplacementEmployeesResult } from "./view-types";

type ReplacementReader = Pick<typeof rootDatabase, "select">;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const replacementSortName = sql<string>`
	lower(
		coalesce(
			nullif(btrim(concat_ws(' ', ${user.firstName}, ${user.lastName})), ''),
			nullif(btrim(${user.name}), ''),
			lower(${user.email})
		)
	)
`;

const replacementDisplayName = sql<string>`
	coalesce(
		nullif(btrim(concat_ws(' ', ${user.firstName}, ${user.lastName})), ''),
		nullif(btrim(${user.name}), ''),
		${user.email}
	)
`;

interface DecodedCursor {
	sortName: string;
	id: string;
}

function encodeCursor(cursor: DecodedCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): DecodedCursor | null {
	if (!cursor) return null;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as { sortName?: unknown }).sortName === "string" &&
			typeof (parsed as { id?: unknown }).id === "string" &&
			isCanonicalUuid((parsed as { id: string }).id)
		) {
			return {
				sortName: (parsed as { sortName: string }).sortName,
				id: (parsed as { id: string }).id,
			};
		}
		return null;
	} catch {
		return null;
	}
}

function escapeLikePattern(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export interface SearchReplacementEmployeesInput {
	organizationId: string;
	/** Departing employee ID to exclude from replacement choices. */
	excludeEmployeeId?: string | null;
	search?: string | null;
	/** Opaque keyset cursor returned by the previous page. */
	cursor?: string | null;
	/** Bounded page size (default 20, max 50). */
	limit?: number;
	now?: Instant;
}

/**
 * Scalable, cursor-paginated, search-bounded lookup of eligible approval
 * replacement employees in one organization.
 *
 * Eligibility mirrors departure handover authority:
 * - Same organization
 * - On the current roster (`is_active = true` and not past a due departure)
 * - Approved organization membership
 * - Employee role `admin` or `manager`
 * - Not the departing employee (`excludeEmployeeId`)
 */
export async function searchReplacementEmployees(
	database: ReplacementReader,
	input: SearchReplacementEmployeesInput,
): Promise<SearchReplacementEmployeesResult> {
	const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
	const decodedCursor = decodeCursor(input.cursor);
	const normalizedSearch = input.search?.trim() ?? "";

	const conditions = [
		onCurrentRoster(input.organizationId, employee, input.now),
		eq(member.status, "approved"),
		inArray(employee.role, ["admin", "manager"]),
	];

	if (input.excludeEmployeeId && isCanonicalUuid(input.excludeEmployeeId)) {
		conditions.push(ne(employee.id, input.excludeEmployeeId));
	}

	if (normalizedSearch.length > 0) {
		const pattern = `%${escapeLikePattern(normalizedSearch)}%`;
		const searchMatch = or(
			ilike(user.name, pattern),
			ilike(user.firstName, pattern),
			ilike(user.lastName, pattern),
			ilike(user.email, pattern),
			ilike(employee.position, pattern),
			ilike(employee.employeeNumber, pattern),
		);
		if (searchMatch) conditions.push(searchMatch);
	}

	if (decodedCursor) {
		conditions.push(
			sql`(${replacementSortName}, ${employee.id}) > (${decodedCursor.sortName}, ${decodedCursor.id}::uuid)`,
		);
	}

	const rows = await database
		.select({
			employeeId: employee.id,
			userId: employee.userId,
			name: replacementDisplayName,
			sortName: replacementSortName,
			email: user.email,
			role: employee.role,
			position: employee.position,
			teamName: team.name,
			image: user.image,
		})
		.from(employee)
		.innerJoin(
			member,
			and(eq(member.userId, employee.userId), eq(member.organizationId, employee.organizationId)),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			team,
			and(eq(team.id, employee.teamId), eq(team.organizationId, employee.organizationId)),
		)
		.where(and(...conditions))
		.orderBy(asc(replacementSortName), asc(employee.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const last = page.at(-1);

	return {
		items: page.map((row) => ({
			employeeId: row.employeeId,
			userId: row.userId,
			name: row.name,
			email: row.email,
			role: row.role as "admin" | "manager",
			position: row.position,
			teamName: row.teamName ?? null,
			image: row.image,
		})),
		nextCursor:
			hasMore && last ? encodeCursor({ sortName: last.sortName, id: last.employeeId }) : null,
		hasMore,
	};
}

/**
 * Bounded point lookup for displaying an already-selected replacement employee
 * without loading the organization roster.
 */
export async function getReplacementEmployeeById(
	database: ReplacementReader,
	input: {
		organizationId: string;
		employeeId: string;
		now?: Instant;
	},
): Promise<ReplacementEmployeeOption | null> {
	if (!isCanonicalUuid(input.employeeId)) return null;
	const [row] = await database
		.select({
			employeeId: employee.id,
			userId: employee.userId,
			name: replacementDisplayName,
			email: user.email,
			role: employee.role,
			position: employee.position,
			teamName: team.name,
			image: user.image,
		})
		.from(employee)
		.innerJoin(
			member,
			and(eq(member.userId, employee.userId), eq(member.organizationId, employee.organizationId)),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			team,
			and(eq(team.id, employee.teamId), eq(team.organizationId, employee.organizationId)),
		)
		.where(
			and(
				eq(employee.id, input.employeeId),
				onCurrentRoster(input.organizationId, employee, input.now),
				eq(member.status, "approved"),
				inArray(employee.role, ["admin", "manager"]),
			),
		)
		.limit(1);

	if (!row) return null;
	return {
		employeeId: row.employeeId,
		userId: row.userId,
		name: row.name,
		email: row.email,
		role: row.role as "admin" | "manager",
		position: row.position,
		teamName: row.teamName ?? null,
		image: row.image,
	};
}

/** Point eligibility check for a chosen replacement without loading the roster. */
export async function isEligibleReplacementEmployee(
	database: ReplacementReader,
	input: {
		organizationId: string;
		excludeEmployeeId: string;
		replacementEmployeeId: string;
		now?: Instant;
	},
): Promise<boolean> {
	if (
		!isCanonicalUuid(input.replacementEmployeeId) ||
		input.replacementEmployeeId === input.excludeEmployeeId
	) {
		return false;
	}
	const [row] = await database
		.select({ id: employee.id })
		.from(employee)
		.innerJoin(
			member,
			and(eq(member.userId, employee.userId), eq(member.organizationId, employee.organizationId)),
		)
		.where(
			and(
				eq(employee.id, input.replacementEmployeeId),
				onCurrentRoster(input.organizationId, employee, input.now),
				eq(member.status, "approved"),
				inArray(employee.role, ["admin", "manager"]),
			),
		)
		.limit(1);
	return Boolean(row);
}
