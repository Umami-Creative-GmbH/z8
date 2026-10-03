import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	calls: [] as string[],
	connection: vi.fn(),
	getSession: vi.fn(),
	headers: new Headers({ cookie: "session=token" }),
}));

vi.mock("next/server", () => ({
	connection: mockState.connection,
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => mockState.headers),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mockState.getSession } },
}));

const { getRequestSession } = await import("./request-session");

describe("getRequestSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.calls = [];
		mockState.connection.mockImplementation(async () => {
			mockState.calls.push("connection");
		});
		mockState.getSession.mockImplementation(async () => {
			mockState.calls.push("getSession");
			return { user: { id: "user-1" }, session: { id: "session-1" } };
		});
	});

	it("waits for the request connection before querying the session", async () => {
		await expect(getRequestSession()).resolves.toMatchObject({
			user: { id: "user-1" },
		});

		expect(mockState.calls).toEqual(["connection", "getSession"]);
		expect(mockState.getSession).toHaveBeenCalledWith({
			headers: mockState.headers,
		});
	});

	it("evaluates the authoritative session again on each direct call", async () => {
		await getRequestSession();
		mockState.getSession.mockResolvedValueOnce(null);

		await expect(getRequestSession()).resolves.toBeNull();
		expect(mockState.getSession).toHaveBeenCalledTimes(2);
		expect(mockState.connection).toHaveBeenCalledTimes(2);
	});

	it("never starts the session query while the connection is withheld", async () => {
		// A prerender (runtime prefetch) hangs connection() until the render ends.
		mockState.connection.mockReturnValueOnce(new Promise(() => {}));

		void getRequestSession();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockState.getSession).not.toHaveBeenCalled();
	});
});

const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));

function listSourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : listSourceFiles(fullPath);
		}
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
			? [fullPath]
			: [];
	});
}

describe("request-time session lookups", () => {
	it("call getSession only through getRequestSession outside route handlers", () => {
		// Route handlers and the proxy never run inside a prerender.
		const isRouteBoundary = (file: string) =>
			file.startsWith("app/api/") ||
			file.endsWith("/route.ts") ||
			file === "proxy.ts";
		const allowed = new Set(["lib/auth/request-session.ts"]);

		const offenders = listSourceFiles(sourceRoot)
			.map((file) => path.relative(sourceRoot, file).split(path.sep).join("/"))
			.filter((file) => !isRouteBoundary(file) && !allowed.has(file))
			.filter((file) =>
				readFileSync(path.join(sourceRoot, file), "utf8").includes(
					"auth.api.getSession(",
				),
			);

		expect(offenders).toEqual([]);
	});
});
