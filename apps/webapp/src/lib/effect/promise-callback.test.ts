import { Context, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { tryPromiseWithRunner } from "./promise-callback";

class Greeting extends Context.Service<Greeting, { readonly text: string }>()("Greeting") {}

class CallbackError {
	readonly _tag = "CallbackError";
	constructor(readonly cause: unknown) {}
}

describe("tryPromiseWithRunner", () => {
	it("runs callback effects with the calling fiber's services", async () => {
		const result = await Effect.runPromise(
			tryPromiseWithRunner({
				try: async (run) => {
					const text = await run(Effect.map(Greeting, (greeting) => greeting.text));
					return `${text}!`;
				},
				catch: (cause) => new CallbackError(cause),
			}).pipe(Effect.provide(Layer.succeed(Greeting, Greeting.of({ text: "hello" })))),
		);

		expect(result).toBe("hello!");
	});

	it("rejects the callback with a callback effect's typed failure", async () => {
		const exit = await Effect.runPromiseExit(
			tryPromiseWithRunner({
				try: (run) => run(Effect.fail("stripe down")),
				catch: (cause) => new CallbackError(cause),
			}),
		);

		expect(exit).toEqual(Exit.fail(new CallbackError("stripe down")));
	});

	it("interrupts a running callback effect when the caller is interrupted", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const interrupted = yield* Deferred.make<void>();
				const fiber = yield* Effect.forkChild(
					tryPromiseWithRunner({
						try: (run) =>
							run(
								Deferred.succeed(started, undefined).pipe(
									Effect.andThen(Effect.never),
									Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
								),
							),
						catch: (cause) => new CallbackError(cause),
					}),
				);
				yield* Deferred.await(started);
				yield* Fiber.interrupt(fiber);
				return yield* Deferred.await(interrupted).pipe(
					Effect.timeout("1 second"),
					Effect.as("interrupted"),
				);
			}),
		);

		expect(result).toBe("interrupted");
	});
});
