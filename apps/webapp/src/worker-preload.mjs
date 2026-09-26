// Preloaded before the worker entry (`tsx --import ./src/worker-preload.mjs src/worker.ts`).
//
// Plain Node resolves `server-only` to a module that always throws, because only React
// Server Component bundlers set the `react-server` export condition. The worker is a
// server process, so resolve that one package the way Next.js server bundles do.
// Adding the condition globally would also switch React to its server build and break
// email rendering. A preload also covers the entry's static import graph, which ESM
// resolves before any code in `worker.ts` runs.
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier !== "server-only") {
			return nextResolve(specifier, context);
		}
		return nextResolve(specifier, {
			...context,
			conditions: [...(context.conditions ?? []), "react-server"],
		});
	},
});
