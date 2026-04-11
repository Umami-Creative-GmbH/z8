import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

export class MobileApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export interface MobileSessionContext {
	session: AuthSession;
	activeOrganizationId: string | null;
	memberships: Array<{ organizationId: string }>;
}

export async function requireMobileSessionContext(request: Request): Promise<MobileSessionContext> {
	const authorization = request.headers.get("authorization");
	if (!authorization?.toLowerCase().startsWith("bearer ")) {
		throw new MobileApiError(401, "Bearer token required");
	}

	const appTypeHeader = request.headers.get("x-z8-app-type")?.toLowerCase();
	if (appTypeHeader !== "mobile") {
		throw new MobileApiError(403, "Mobile app access required");
	}

	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		throw new MobileApiError(401, "Unauthorized");
	}

	if (!(session.user.canUseMobile ?? true)) {
		throw new MobileApiError(403, "Mobile app access denied");
	}

	const memberships = await db.query.member.findMany({
		columns: {
			organizationId: true,
		},
		where: eq(member.userId, session.user.id),
	});

	return {
		session,
		activeOrganizationId: session.session.activeOrganizationId ?? null,
		memberships,
	};
}

export async function requireMobileEmployee(userId: string, organizationId: string) {
	const employeeRecord = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, organizationId),
			eq(employee.isActive, true),
		),
	});

	if (!employeeRecord) {
		throw new MobileApiError(403, "Employee record required for the active organization");
	}

	return employeeRecord;
}

export async function getMobileOrganizationSummary(userId: string, organizationId: string) {
	const [organizationRecord, employeeRecord] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: {
				id: true,
				name: true,
				slug: true,
			},
		}),
		db.query.employee.findFirst({
			where: and(
				eq(employee.userId, userId),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
			),
			columns: {
				id: true,
			},
		}),
	]);

	return {
		id: organizationRecord?.id ?? organizationId,
		name: organizationRecord?.name ?? "Unknown",
		slug: organizationRecord?.slug ?? "",
		hasEmployeeRecord: !!employeeRecord,
	};
}
