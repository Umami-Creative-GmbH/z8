import type { ChangePolicyVerdict, readChangePolicyVerdict } from "../verdict";

type VerdictModule = typeof import("../verdict");
type VerdictInput = Parameters<typeof readChangePolicyVerdict>[1];

/** The outcome a suite wants, with the reason and days back filled in when it leaves them out. */
export type StubbedVerdict = {
	type: ChangePolicyVerdict["type"];
	reason?: string;
	daysBack?: number;
};

const DEFAULT_REASON = {
	direct: "no_policy",
	approval_required: "within_approval_window",
	forbidden: "beyond_approval_window",
} as const;

/**
 * The verdict module with its database read replaced, for suites that need an outcome no seeded
 * policy can produce (work recorded today is never outside a self-service window) and for unit
 * tests that have no database.
 *
 * `outcome` answers for changes the policy governs; returning null reads the real verdict. An
 * exempt change never reaches it and is decided by the real window rule, as in production.
 *
 *     vi.mock("@/lib/time-tracking/change-policy/verdict", async (original) =>
 *         (await import("@/lib/time-tracking/change-policy/testing/verdict.test.fixture"))
 *             .stubChangePolicyVerdict(original, () => ({ type: "approval_required" })),
 *     );
 */
export async function stubChangePolicyVerdict(
	importOriginal: () => Promise<unknown>,
	outcome: (input: VerdictInput) => StubbedVerdict | null | Promise<StubbedVerdict | null>,
): Promise<VerdictModule> {
	const original = (await importOriginal()) as VerdictModule;
	return {
		...original,
		readChangePolicyVerdict: async (reader, input) => {
			if (input.exemption) {
				return original.decideChangePolicyVerdict({
					exemption: input.exemption,
					policy: null,
					daysBack: 0,
				});
			}
			const stubbed = await outcome(input);
			if (!stubbed) return original.readChangePolicyVerdict(reader, input);
			return {
				type: stubbed.type,
				reason: stubbed.reason ?? DEFAULT_REASON[stubbed.type],
				daysBack: stubbed.daysBack ?? 0,
				policy: null,
			} as ChangePolicyVerdict;
		},
	};
}
