import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
	workPolicyScheduleDay,
} from "@/db/schema";
import {
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import { tryPromiseWithRunner } from "@/lib/effect/promise-callback";
import { AuthService } from "@/lib/effect/services/auth.service";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	meetsSettingsAccess,
	resolveCallerSettingsAccess,
} from "@/lib/organization-action/settings-access";
import {
	type UserSettingsTransaction,
	writeUserSettings,
} from "@/lib/user-preferences/user-settings-mutation";
import {
	getNextOnboardingStep,
	type OnboardingOrganizationExpectation,
	type OnboardingWorkTemplateFormValues,
	onboardingWorkTemplateSchema,
} from "@/lib/validations/onboarding";

type Dependencies = {
	database: DatabaseService["Service"];
	authentication: AuthService["Service"];
};
type Command = { kind: "create"; data: unknown } | { kind: "skip" };

function mutationFailure(error: unknown) {
	const cause = error instanceof DatabaseError ? error.cause : error;
	if (
		cause instanceof AuthenticationError ||
		cause instanceof AuthorizationError ||
		cause instanceof ValidationError
	)
		return cause;
	if (error instanceof DatabaseError) return error;
	throw error;
}

async function insertTemplate(
	transaction: UserSettingsTransaction,
	caller: { userId: string; organizationId: string },
	data: OnboardingWorkTemplateFormValues,
) {
	if (data.setAsDefault) {
		const existing = await transaction.query.workPolicyAssignment.findFirst({
			where: and(
				eq(workPolicyAssignment.organizationId, caller.organizationId),
				eq(workPolicyAssignment.assignmentType, "organization"),
				eq(workPolicyAssignment.isActive, true),
			),
			columns: { id: true },
		});
		if (existing)
			throw new ValidationError({
				message:
					"An organization default already exists. Create a non-default template or manage work policies in settings.",
				field: "setAsDefault",
				refusal: "work_template_default_exists",
			});
	}
	const [policy] = await transaction
		.insert(workPolicy)
		.values({
			organizationId: caller.organizationId,
			name: data.name,
			description: "Created during onboarding",
			scheduleEnabled: true,
			regulationEnabled: false,
			isActive: true,
			isDefault: data.setAsDefault,
			createdBy: caller.userId,
			updatedAt: new Date(),
		})
		.returning();
	if (!policy) throw new Error("Work template creation did not return a policy");
	const [schedule] = await transaction
		.insert(workPolicySchedule)
		.values({
			policyId: policy.id,
			scheduleCycle: "weekly",
			scheduleType: "simple",
			workingDaysPreset: "weekdays",
			hoursPerCycle: data.hoursPerWeek.toString(),
			homeOfficeDaysPerCycle: 0,
		})
		.returning();
	if (!schedule) throw new Error("Work template creation did not return a schedule");
	const allDays = [
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
		"sunday",
	] as const;
	const hoursPerDay = data.workingDays.length > 0 ? data.hoursPerWeek / data.workingDays.length : 0;
	await transaction.insert(workPolicyScheduleDay).values(
		allDays.map((day) => ({
			scheduleId: schedule.id,
			dayOfWeek: day,
			hoursPerDay: data.workingDays.includes(day) ? hoursPerDay.toFixed(1) : "0",
			isWorkDay: data.workingDays.includes(day),
		})),
	);
	if (data.setAsDefault)
		await transaction.insert(workPolicyAssignment).values({
			policyId: policy.id,
			organizationId: caller.organizationId,
			assignmentType: "organization",
			priority: 0,
			effectiveFrom: new Date(),
			isActive: true,
			createdBy: caller.userId,
		});
}

const mutateTemplate = Effect.fnUntraced(function* (
	dependencies: Dependencies,
	command: Command,
	expected?: OnboardingOrganizationExpectation,
) {
	const { database, authentication } = dependencies;
	const session = yield* authentication
		.getSession()
		.pipe(Effect.provideService(DatabaseService, database));
	const userId = session.user.id;
	// Work-policy writers do not take organization configuration protection (Time Tracking ADR0003).
	// The settings owner takes exclusive user protection before this transaction reads authority.
	yield* tryPromiseWithRunner({
		try: (run) =>
			run(
				database.query(
					command.kind === "create" ? "createWorkTemplate" : "skipWorkTemplateSetup",
					() =>
						writeUserSettings(
							database.db,
							userId,
							{ onboardingStep: getNextOnboardingStep("work_templates", true) ?? "wellness" },
							async (transaction) => {
								// Drizzle transactions expose the auth/facts operations, but not the outer pool's $client.
								// Only those readers receive this adapter; every graph/progress write uses the actual transaction.
								const caller = await run(
									resolveCallerSettingsAccess().pipe(
										Effect.provideService(AuthService, authentication),
										Effect.provideService(DatabaseService, {
											db: transaction as unknown as DatabaseClient,
											query: database.query,
										}),
									),
								);
								if (
									caller.userId !== userId ||
									!meetsSettingsAccess(caller.settingsAccess, "orgAdmin")
								)
									throw new AuthorizationError({
										message: "You do not have access to this setting",
										resource: "work_template",
										action: "manage",
										userId: caller.userId,
									});
								if (
									expected !== undefined &&
									(!expected ||
										expected.userId !== caller.userId ||
										expected.organizationId !== caller.organizationId)
								)
									throw new AuthorizationError({
										message: "The active account or organization changed. Please try again.",
										resource: "work_template",
										action: "manage",
										userId: caller.userId,
									});
								if (command.kind === "skip") return;
								const parsed = onboardingWorkTemplateSchema.safeParse(command.data);
								if (!parsed.success)
									throw new ValidationError({
										message: parsed.error.issues[0]?.message ?? "Invalid work template",
										field: parsed.error.issues[0]?.path.join("."),
									});
								await insertTemplate(transaction, caller, parsed.data);
							},
						),
				),
			),
		catch: mutationFailure,
	});
});

export function createOnboardingWorkTemplate(
	dependencies: Dependencies,
	data: OnboardingWorkTemplateFormValues,
	expected?: OnboardingOrganizationExpectation,
) {
	return mutateTemplate(dependencies, { kind: "create", data }, expected);
}

export function skipOnboardingWorkTemplate(
	dependencies: Dependencies,
	expected?: OnboardingOrganizationExpectation,
) {
	return mutateTemplate(dependencies, { kind: "skip" }, expected);
}
