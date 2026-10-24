import { afterEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({ create: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-node", () => ({
	PostHog: class {
		constructor() {
			telemetry.create();
		}
		captureException = telemetry.capture;
	},
}));

import { onRequestError } from "./instrumentation";

describe("request error privacy", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});
	it("does not forward a protected exception even with a configured SDK and a vendor identity cookie", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_local_canary");
		const rawError = new Error(
			"select secret_salary from employee where token=private-token params=[private-wage]",
		);
		const cookie = `session=private-session; ph_phc_local_canary_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: "unsigned-identity" }))}`;
		await onRequestError(rawError, {
			headers: { cookie },
			path: "/en/settings/employees/private-employee?token=private-token",
		});
		expect(telemetry.create).not.toHaveBeenCalled();
		expect(telemetry.capture).not.toHaveBeenCalled();
	});
	it.each(["nodejs", "edge"])(
		"does not inspect or export request/error canaries in %s",
		async (runtime) => {
			vi.stubEnv("NEXT_RUNTIME", runtime);
			vi.stubEnv("NODE_ENV", "production");
			vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_local_canary");
			const read = vi.fn(() => {
				throw new Error("Protected request/error getter must not be evaluated");
			});
			const rawError = {
				toString: read,
				get stack() {
					return read();
				},
				get cause() {
					return read();
				},
			};
			const request = {
				get headers() {
					return read();
				},
				get path() {
					return read();
				},
			};
			const network = vi.fn();
			vi.stubGlobal("fetch", network);
			const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
			const warningLog = vi.spyOn(console, "warn").mockImplementation(() => {});
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			await expect(
				Promise.resolve(onRequestError(rawError, request)),
			).resolves.toBeUndefined();
			expect(read).not.toHaveBeenCalled();
			expect(network).not.toHaveBeenCalled();
			expect(errorLog).not.toHaveBeenCalled();
			expect(warningLog).not.toHaveBeenCalled();
			expect(log).not.toHaveBeenCalled();
			expect(telemetry.capture).not.toHaveBeenCalled();
		},
	);
	it.each([
		undefined,
		{ cookie: "ph_phc_local_canary_posthog=%7Bbroken" },
		new Headers({
			cookie: "session=private-session",
			authorization: "Bearer private-bearer",
		}),
	])(
		"does not infer consent from absent, malformed or authenticated headers",
		async (headers) => {
			vi.stubEnv("NEXT_RUNTIME", "nodejs");
			vi.stubEnv("NODE_ENV", "production");
			vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_local_canary");
			await onRequestError(new Error("SQL parameters include private-wage"), {
				headers,
				path: "/en/time-tracking",
			});
			expect(telemetry.create).not.toHaveBeenCalled();
			expect(telemetry.capture).not.toHaveBeenCalled();
		},
	);
});
