import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/effect/errors";
import { refuseUnless } from "./refuse-unless";

const refusal = {
	userId: "user-1",
	message: "You are not allowed to close months",
	resource: "closedMonth",
	action: "close",
};

describe("refuseUnless", () => {
	it("lets an allowed caller through", async () => {
		const exit = await Effect.runPromiseExit(refuseUnless(true, refusal));

		expect(Exit.isSuccess(exit)).toBe(true);
	});

	it("refuses a caller who is not allowed with an AuthorizationError", async () => {
		const exit = await Effect.runPromiseExit(refuseUnless(false, refusal));

		expect(exit).toEqual(Exit.fail(new AuthorizationError(refusal)));
	});
});
