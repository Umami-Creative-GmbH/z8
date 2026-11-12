import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StubCaller } from "@/test/organization-action";

const harness = vi.hoisted(() => ({
	caller: null as StubCaller | null,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	return runtimeModuleOver(organizationActionStubLayer(() => harness.caller));
});

const { organizationAction, noInput, isOrganizationAction } = await import("./organization-action");

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

describe("organizationAction", () => {
	beforeEach(() => {
		harness.caller = null;
	});

	it("runs the handler for a caller with the required settings access, in the session's organization", async () => {
		harness.caller = orgAdmin;
		const action = organizationAction(
			{ name: "test.readOrganization", requires: "orgAdmin", schema: noInput },
			({ actor, organizationId }) =>
				Effect.succeed({ organizationId, userId: actor.userId, access: actor.settingsAccess }),
		);

		await expect(action()).resolves.toEqual({
			success: true,
			data: { organizationId: "org-1", userId: "user-admin", access: "orgAdmin" },
		});
	});

	it("marks the functions it produces, and only those", () => {
		const produced = organizationAction(
			{ name: "test.marked", requires: "member", schema: noInput },
			() => Effect.void,
		);

		expect(isOrganizationAction(produced)).toBe(true);
		expect(isOrganizationAction(async () => ({ success: true, data: undefined }))).toBe(false);
		expect(isOrganizationAction("not a function")).toBe(false);
	});

	describe("stepping up to owner inside the handler", () => {
		const sideEffect = vi.fn();
		const action = organizationAction(
			{
				name: "test.toggleFeature",
				requires: "orgAdmin",
				schema: z.strictObject({ ownerOnly: z.boolean() }),
			},
			({ actor, input }) =>
				Effect.gen(function* () {
					if (input.ownerOnly) yield* actor.require("owner");
					sideEffect();
				}),
		);

		beforeEach(() => {
			sideEffect.mockClear();
		});

		it("refuses an org admin once the validated input needs an owner", async () => {
			harness.caller = orgAdmin;

			await expect(action({ ownerOnly: true })).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
			expect(sideEffect).not.toHaveBeenCalled();
		});

		it("lets an owner through, and an org admin when the input does not need an owner", async () => {
			harness.caller = { ...orgAdmin, membershipRole: "owner" };
			await expect(action({ ownerOnly: true })).resolves.toMatchObject({ success: true });

			harness.caller = orgAdmin;
			await expect(action({ ownerOnly: false })).resolves.toMatchObject({ success: true });
			expect(sideEffect).toHaveBeenCalledTimes(2);
		});
	});

	describe("with a schema", () => {
		const handler = vi.fn(({ input }: { input: { label: string } }) => Effect.succeed(input.label));
		const action = organizationAction(
			{
				name: "test.rename",
				requires: "orgAdmin",
				schema: z.strictObject({ label: z.string().min(1, "Label is required") }),
			},
			handler,
		);

		beforeEach(() => {
			handler.mockClear();
		});

		it("refuses a caller without the required access before validating the input", async () => {
			harness.caller = { ...orgAdmin, membershipRole: "member" };

			await expect(action({ label: "" })).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
			expect(handler).not.toHaveBeenCalled();
		});

		it("returns a ValidationError for invalid input from an authorized caller", async () => {
			harness.caller = orgAdmin;

			await expect(action({ label: "" })).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
				error: "Label is required",
			});
			expect(handler).not.toHaveBeenCalled();
		});

		it("hands the parsed input to the handler", async () => {
			harness.caller = orgAdmin;

			await expect(action({ label: "Ops" })).resolves.toEqual({ success: true, data: "Ops" });
		});
	});
});
