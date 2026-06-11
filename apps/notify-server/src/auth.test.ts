import { describe, expect, it, vi } from "vitest";

import { validateStreamRequest } from "./auth.js";

describe("validateStreamRequest", () => {
	it("rejects missing session", async () => {
		const result = await validateStreamRequest(new Headers(), {
			getSession: vi.fn(async () => null),
			findActiveEmployee: vi.fn(),
		});

		expect(result).toEqual({ ok: false, status: 401, message: "Unauthorized" });
	});

	it("rejects missing active organization", async () => {
		const result = await validateStreamRequest(new Headers(), {
			getSession: vi.fn(async () => ({ user: { id: "u1" }, session: {} })),
			findActiveEmployee: vi.fn(),
		});

		expect(result).toEqual({ ok: false, status: 400, message: "No active organization" });
	});

	it("rejects missing active employee", async () => {
		const result = await validateStreamRequest(new Headers(), {
			getSession: vi.fn(async () => ({ user: { id: "u1" }, session: { activeOrganizationId: "o1" } })),
			findActiveEmployee: vi.fn(async () => null),
		});

		expect(result).toEqual({ ok: false, status: 400, message: "No active employee record in this organization" });
	});

	it("accepts an active employee in the active organization", async () => {
		const findActiveEmployee = vi.fn(async () => ({ organizationId: "o1" }));
		const result = await validateStreamRequest(new Headers(), {
			getSession: vi.fn(async () => ({ user: { id: "u1" }, session: { activeOrganizationId: "o1" } })),
			findActiveEmployee,
		});

		expect(findActiveEmployee).toHaveBeenCalledWith({ userId: "u1", organizationId: "o1" });
		expect(result).toEqual({ ok: true, userId: "u1", organizationId: "o1" });
	});
});
