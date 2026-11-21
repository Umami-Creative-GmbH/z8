import { Effect } from "effect";
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
	type OnboardingOrganizationExpectation,
	type OnboardingWorkTemplateFormValues,
	onboardingWorkTemplateSchema,
} from "@/lib/validations/onboarding";
import { createOnboardingWorkTemplateInTx } from "@/lib/work-policy/policy-queries";
import type { PolicyTransaction } from "@/lib/work-policy/versioned-policy-writer";

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
	await createOnboardingWorkTemplateInTx(transaction as unknown as PolicyTransaction, {
		organizationId: caller.organizationId,
		actorUserId: caller.userId,
		name: data.name,
		hoursPerWeek: data.hoursPerWeek,
		workingDays: data.workingDays,
		setAsDefault: data.setAsDefault,
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
							{ onboardingStep: "wellness" },
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
