/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PendingMember } from "@/lib/effect/services/pending-member.service";
import { PendingMembersCard } from "./pending-members-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, values?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (match, name: string) =>
				values?.[name] === undefined ? match : String(values[name]),
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationTimezone: () => "Europe/Berlin",
}));

const pendingMembers = vi.hoisted(() => ({ value: [] as PendingMember[] }));

vi.mock("@/app/[locale]/(app)/settings/organization/invite-code-actions", () => ({
	listPendingMembers: async () => ({ success: true, data: pendingMembers.value }),
	approvePendingMember: vi.fn(),
	bulkRejectPendingMembers: vi.fn(),
	rejectPendingMember: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	listTeams: async () => ({ success: true, data: [] }),
}));

function pendingMember(overrides: Partial<PendingMember>): PendingMember {
	return {
		id: "member-1",
		userId: "user-1",
		organizationId: "org-1",
		role: "member",
		source: "invite_code",
		createdAt: new Date("2026-11-10T08:00:00Z"),
		user: { id: "user-1", name: "Person", email: "person@example.test", image: null },
		inviteCode: null,
		...overrides,
	};
}

function renderCard() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<PendingMembersCard organizationId="org-1" settingsAccess="orgAdmin" />
		</QueryClientProvider>,
	);
}

describe("PendingMembersCard (#1668)", () => {
	it("shows that a request came from the identity provider, and the role it asked for", async () => {
		pendingMembers.value = [
			pendingMember({
				id: "member-sso",
				role: "admin",
				source: "sso",
				user: { id: "user-sso", name: "Mira Sso", email: "mira@example.test", image: null },
			}),
			pendingMember({
				id: "member-code",
				role: "member",
				source: "invite_code",
				user: { id: "user-code", name: "Ken Code", email: "ken@example.test", image: null },
				inviteCode: { id: "code-1", code: "JOIN1", label: "Front desk" },
			}),
		];

		renderCard();

		const ssoRow = (await screen.findByText("Mira Sso")).closest("tr");
		expect(ssoRow).not.toBeNull();
		expect(within(ssoRow as HTMLElement).getByText("SSO")).toBeTruthy();
		expect(within(ssoRow as HTMLElement).getByText("Admin")).toBeTruthy();

		const codeRow = screen.getByText("Ken Code").closest("tr");
		expect(within(codeRow as HTMLElement).getByText("Front desk")).toBeTruthy();
		expect(within(codeRow as HTMLElement).getByText("Member")).toBeTruthy();
	});
});
