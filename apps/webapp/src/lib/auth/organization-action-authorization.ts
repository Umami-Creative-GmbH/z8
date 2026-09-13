import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/effect/errors";
import {
	DatabaseService,
	DatabaseServiceLive,
} from "@/lib/effect/services/database.service";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import { hasOrganizationRole } from "./organization-role";

export function requireActiveOrganizationActionActor(input: {
	userId: string;
	organizationId: string;
	requiredRole: "admin" | "owner";
	message: string;
	resource: string;
	action: string;
}) {
	return Effect.gen(function* (_) {
		const authorizationError = () =>
			new AuthorizationError({
				message: input.message,
				userId: input.userId,
				resource: input.resource,
				action: input.action,
			});
		const ssoAllowed = yield* _(
			Effect.tryPromise({
				try: async () => {
					const session = await auth.api.getSession({
						headers: await headers(),
					});
					return (
						session?.user.id === input.userId &&
						(await canAccessOrganizationWithSso(
							session.session,
							input.organizationId,
						))
					);
				},
				catch: authorizationError,
			}),
		);
		if (!ssoAllowed) return yield* _(Effect.fail(authorizationError()));
		const dbService = yield* _(DatabaseService);
		const [membership, employeeRecord] = yield* _(
			Effect.all([
				dbService.query("getOrganizationActionActor:membership", async () => {
					return await dbService.db.query.member.findFirst({
						where: and(
							eq(member.userId, input.userId),
							eq(member.organizationId, input.organizationId),
							eq(member.status, "approved"),
						),
					});
				}),
				dbService.query("getOrganizationActionActor:employee", async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, input.userId),
							eq(employee.organizationId, input.organizationId),
						),
						columns: { isActive: true },
					});
				}),
			]),
		);

		const hasCapability =
			membership != null &&
			(hasOrganizationRole(membership.role, "owner") ||
				(input.requiredRole === "admin" &&
					hasOrganizationRole(membership.role, "admin")));
		if (!hasCapability || employeeRecord?.isActive === false) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: input.message,
						userId: input.userId,
						resource: input.resource,
						action: input.action,
					}),
				),
			);
		}

		return { membership, employee: employeeRecord };
	});
}

export function runActiveOrganizationActionActorCheck(
	input: Parameters<typeof requireActiveOrganizationActionActor>[0],
) {
	return Effect.runPromise(
		requireActiveOrganizationActionActor(input).pipe(
			Effect.provide(DatabaseServiceLive),
		),
	);
}
