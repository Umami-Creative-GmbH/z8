import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useSession } from "./auth-client";

function SessionProbe() {
	const session = useSession();

	return <span>{session.isPending ? "pending" : "ready"}</span>;
}

describe("useSession auth client wrapper", () => {
	const authClientSourcePath = fileURLToPath(new URL("./auth-client.ts", import.meta.url));

	it("is safe during server pre-render", () => {
		expect(() => renderToString(<SessionProbe />)).not.toThrow();
	});

	it("uses a single shared Better Auth client instance", () => {
		const source = readFileSync(authClientSourcePath, "utf8");
		const clientInstantiations = source.match(/createAuthClient\(createClientConfig\(\)\)/g);

		expect(clientInstantiations).toHaveLength(1);
		expect(source).toContain("return authClientInstance.useSession();");
		expect(source).toContain("return authClientInstance;");
	});

	it("delegates to the client hook without an early return", () => {
		const source = readFileSync(authClientSourcePath, "utf8");

		expect(source).toContain("export function useSession() {");
		expect(source).toContain(".useSession();\n}");
		expect(source).not.toContain("export function useSession() {\n\tconst client");
		expect(source).not.toContain("export function useSession() {\n\tif");
	});
});
