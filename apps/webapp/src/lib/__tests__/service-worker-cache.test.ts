import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

function loadServiceWorkerHelpers() {
	const swPath = path.resolve(__dirname, "../../../public/sw.js");
	const script = readFileSync(swPath, "utf8");
	const context = {
		console,
		importScripts: () => {},
		self: {
			addEventListener: () => {},
			location: { origin: "https://z8.test" },
		},
	};

	vm.runInNewContext(script, context);
	return context as typeof context & {
		isStaticAsset: (pathname: string) => boolean;
	};
}

describe("service worker cache routing", () => {
	test("does not handle Next.js runtime assets as offline static assets", () => {
		const { isStaticAsset } = loadServiceWorkerHelpers();

		expect(isStaticAsset("/_next/static/chunks/app/layout.js")).toBe(false);
		expect(isStaticAsset("/favicon-32x32.png")).toBe(true);
	});
});
