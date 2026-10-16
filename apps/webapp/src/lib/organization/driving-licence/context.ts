import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { getAuthContext } from "@/lib/auth-helpers";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
export type DrivingLicenceActor = { organizationId: string; userId: string; memberId: string; employeeId: string | null; isAdministrator: boolean };
export async function requireDrivingLicenceActor(): Promise<DrivingLicenceActor> {
 const auth = await getAuthContext();
 const organizationId = auth?.session.activeOrganizationId;
 if (!auth || !organizationId) throw new Error("forbidden");
 const [[membership], access] = await Promise.all([
  db.select().from(member).where(and(eq(member.organizationId, organizationId), eq(member.userId, auth.user.id), eq(member.status, "approved"))).limit(1),
  resolveEmployeeOrganizationAccess(db, { organizationId, userId: auth.user.id }),
 ]);
 if (!membership || !access.allowed) throw new Error("forbidden");
 return { organizationId, userId: auth.user.id, memberId: membership.id, employeeId: access.employeeId, isAdministrator: hasOrganizationRole(membership.role, "owner") || hasOrganizationRole(membership.role, "admin") };
}
export async function requireDrivingLicenceAdministrator(): Promise<DrivingLicenceActor> {
 const actor = await requireDrivingLicenceActor();
 if (!actor.isAdministrator) throw new Error("forbidden");
 return actor;
}
