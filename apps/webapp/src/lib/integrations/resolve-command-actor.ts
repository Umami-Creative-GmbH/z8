import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";

type CommandActorDb = Pick<typeof db, "query">;

export async function resolveCommandActorEmployee(
	userId: string,
	organizationId: string,
	dbClient: CommandActorDb = db,
) {
	const [membership, employeeRecord] = await Promise.all([
		dbClient.query.member.findFirst({
			where: and(
				eq(member.userId, userId),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
			columns: { id: true },
		}),
		dbClient.query.employee.findFirst({
			where: and(
				eq(employee.userId, userId),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
			),
			columns: { id: true, isActive: true },
		}),
	]);

	return membership && employeeRecord?.isActive === true
		? employeeRecord
		: null;
}
