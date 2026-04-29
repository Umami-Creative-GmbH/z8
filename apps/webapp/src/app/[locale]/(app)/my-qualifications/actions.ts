"use server";

import { Effect } from "effect";
import { getAuthContext } from "@/lib/auth-helpers";
import { NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	type CreateRenewalRequestInput,
	type EmployeeSkillWithDetails,
	type QualificationRenewalRequestRecord,
	SkillService,
} from "@/lib/effect/services/skill.service";

export async function getMyQualifications(): Promise<
	ServerActionResult<EmployeeSkillWithDetails[]>
> {
	const effect = Effect.gen(function* (_) {
		const authContext = yield* _(Effect.promise(() => getAuthContext()));
		if (!authContext?.employee) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				),
			);
		}

		const skillService = yield* _(SkillService);
		return yield* _(skillService.getEmployeeSkills(authContext.employee.id));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function submitMyQualificationRenewal(
	data: Omit<CreateRenewalRequestInput, "employeeId" | "organizationId">,
): Promise<ServerActionResult<QualificationRenewalRequestRecord>> {
	const effect = Effect.gen(function* (_) {
		const authContext = yield* _(Effect.promise(() => getAuthContext()));
		if (!authContext?.employee) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				),
			);
		}

		const skillService = yield* _(SkillService);
		return yield* _(
			skillService.createRenewalRequest({
				...data,
				organizationId: authContext.employee.organizationId,
				employeeId: authContext.employee.id,
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
