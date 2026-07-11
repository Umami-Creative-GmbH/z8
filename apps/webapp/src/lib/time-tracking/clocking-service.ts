import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";

type ClockingEmployee = Pick<typeof employee.$inferSelect, "id" | "organizationId">;

export class ClockingAccessError extends Error {
	constructor(readonly code: "active_membership_required" | "employee_required") {
		super(
			code === "active_membership_required"
				? "Approved active organization membership required"
				: "Active employee record required for the organization",
		);
	}
}

export function createClockingService(dependencies: {
	findApprovedMembership: (userId: string, organizationId: string) => Promise<boolean>;
	findActiveEmployee: (userId: string, organizationId: string) => Promise<ClockingEmployee | null>;
}) {
	return {
		async requireActor(input: { userId: string; activeOrganizationId: string | null | undefined }) {
			if (!input.activeOrganizationId) {
				throw new ClockingAccessError("active_membership_required");
			}

			const organizationId = input.activeOrganizationId;
			if (!(await dependencies.findApprovedMembership(input.userId, organizationId))) {
				throw new ClockingAccessError("active_membership_required");
			}

			const employeeRecord = await dependencies.findActiveEmployee(input.userId, organizationId);
			if (!employeeRecord || employeeRecord.organizationId !== organizationId) {
				throw new ClockingAccessError("employee_required");
			}

			return { employee: employeeRecord, organizationId, userId: input.userId };
		},
	};
}

export const clockingService = createClockingService({
	async findApprovedMembership(userId, organizationId) {
		const membership = await db.query.member.findFirst({
			columns: { id: true },
			where: and(
				eq(member.userId, userId),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		});
		return Boolean(membership);
	},
	async findActiveEmployee(userId, organizationId) {
		return (
			(await db.query.employee.findFirst({
			columns: { id: true, organizationId: true },
			where: and(
				eq(employee.userId, userId),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
			),
			})) ?? null
		);
	},
});
