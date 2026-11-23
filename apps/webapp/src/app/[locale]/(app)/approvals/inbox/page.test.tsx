/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth-helpers";
import {
	type AppAbility,
	createEmptyAbility,
	defineAbilityFor,
	type PrincipalContext,
} from "@/lib/authorization";
import { ApprovalInboxGate } from "./approval-inbox-gate";

class RedirectSignal extends Error {
	constructor(readonly href: string) {
		super(`redirect:${href}`);
	}
}

const ORG = "org-1";
const EMPLOYEE = "employee-1";

const auth = vi.hoisted(() => ({
	context: null as AuthContext | null,
	ability: null as AppAbility | null,
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => auth.context,
	getAbility: async () => auth.ability,
}));
const redirectWithLocale = vi.hoisted(() => vi.fn());
vi.mock("@/lib/navigation/locale-redirect", () => ({ redirectWithLocale }));
vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: ({ feature }: { feature?: string }) => <p>No employee profile to {feature}</p>,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("./approval-inbox-view", () => ({
	ApprovalInboxView: () => <h1>Approval inbox shell</h1>,
}));

type EmployeeRole = "admin" | "manager" | "employee";

function signedInAs(role: EmployeeRole, customRoles: PrincipalContext["customRoles"] = []): void {
	const employee = { id: EMPLOYEE, organizationId: ORG, role, teamId: null };
	auth.context = {
		user: { id: "user-1" },
		session: { activeOrganizationId: ORG },
		employee,
	} as AuthContext;
	auth.ability = defineAbilityFor({
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: ORG,
		orgMembership: {
			organizationId: ORG,
			role: role === "admin" ? "admin" : "member",
			status: "approved",
		},
		employee,
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles,
	});
}

async function gateOutcome() {
	try {
		return { rendered: await ApprovalInboxGate() };
	} catch (error) {
		if (error instanceof RedirectSignal) return { redirectedTo: error.href };
		throw error;
	}
}

beforeEach(() => {
	auth.context = null;
	auth.ability = null;
	redirectWithLocale.mockReset();
	redirectWithLocale.mockImplementation(async (href: string) => {
		throw new RedirectSignal(href);
	});
});
afterEach(cleanup);

describe("/approvals/inbox server guard", () => {
	it.each(["manager", "admin"] as const)(
		"loads the Approval inbox for an active %s",
		async (role) => {
			signedInAs(role);

			const outcome = await gateOutcome();

			expect(outcome).not.toHaveProperty("redirectedTo");
			render(outcome.rendered);
			expect(screen.getByRole("heading", { name: "Approval inbox shell" })).toBeTruthy();
		},
	);

	it("loads the Approval inbox for a custom-role approver without a manager role", async () => {
		signedInAs("employee", [
			{
				roleId: "role-1",
				roleName: "Approver",
				baseTier: "employee",
				permissions: [{ action: "approve", subject: "Approval" }],
			},
		]);

		const outcome = await gateOutcome();

		render(outcome.rendered);
		expect(screen.getByRole("heading", { name: "Approval inbox shell" })).toBeTruthy();
	});

	it("redirects an employee without approval access home before the inbox renders", async () => {
		signedInAs("employee");

		expect(await gateOutcome()).toEqual({ redirectedTo: "/" });
	});

	it("redirects when the ability carries no employee principal", async () => {
		signedInAs("manager");
		auth.ability = createEmptyAbility();

		expect(await gateOutcome()).toEqual({ redirectedTo: "/" });
	});

	it("shows the missing-employee state without an employee profile in the active organization", async () => {
		signedInAs("manager");
		auth.context = { ...(auth.context as AuthContext), employee: null };

		const outcome = await gateOutcome();

		render(outcome.rendered);
		// The page owns its heading, so the missing-employee state keeps the page h1.
		expect(screen.getByRole("heading", { level: 1, name: "Approval Inbox" })).toBeTruthy();
		expect(screen.getByText("No employee profile to approve requests")).toBeTruthy();
		expect(screen.queryByText("Approval inbox shell")).toBeNull();
	});
});
