import { Layer, ManagedRuntime } from "effect";

/**
 * A stand-in for the `@/lib/effect/runtime` module in unit tests: the shared runtime
 * built over `layer`, the test's stub services, instead of the real `AppLayer`.
 *
 * vi.mock("@/lib/effect/runtime", async () =>
 *   (await import("@/test/effect-runtime")).runtimeModuleOver(stubLayer),
 * );
 */
export function runtimeModuleOver<R, E>(layer: Layer.Layer<R, E> = Layer.empty as never) {
	return { AppLayer: layer, runtime: ManagedRuntime.make(layer) };
}
