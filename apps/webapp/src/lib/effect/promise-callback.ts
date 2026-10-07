import { type Context, Effect } from "effect";

/** Runs an effect from inside a Promise callback; rejects with its typed failure. */
export type CallbackRunner<R> = <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;

/**
 * `Effect.tryPromise` for Promise code that calls back into effects: a port, a
 * `planLegacy` hook, a transaction callback. `try` gets a runner that runs those
 * effects on the calling fiber's context, so they keep its services, tracing span and
 * interruption instead of starting detached `Effect.runPromise` runs. This is the one
 * allowed nested run (the Runtime rules in `docs/refs/effect.md`); compose with `yield*`
 * wherever no Promise callback sits in between.
 */
export function tryPromiseWithRunner<A, E, R = never>(options: {
	readonly try: (run: CallbackRunner<R>, signal: AbortSignal) => PromiseLike<A>;
	readonly catch: (error: unknown) => E;
}): Effect.Effect<A, E, R> {
	return Effect.contextWith((context: Context.Context<R>) => {
		const runWith = Effect.runPromiseWith(context);
		return Effect.tryPromise({
			try: (signal) => options.try((effect) => runWith(effect, { signal }), signal),
			catch: options.catch,
		});
	});
}
