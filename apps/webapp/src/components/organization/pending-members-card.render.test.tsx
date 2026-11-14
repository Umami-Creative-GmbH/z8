/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { approvePendingMember } from "@/app/[locale]/(app)/settings/organization/invite-code-actions";
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
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

describe("PendingMembersCard approving a former employee (#1672)", () => {
	it("tells the approver a rehire is needed and links to the employee, after the row is gone", async () => {
		pendingMembers.value = [
			pendingMember({
				id: "member-former",
				user: { id: "user-former", name: "Fran Former", email: "fran@example.test", image: null },
			}),
		];
		vi.mocked(approvePendingMember).mockImplementation(async () => {
			pendingMembers.value = [];
			return {
				success: true,
				data: { success: true, rehireNeeded: { employeeId: "employee-former" } },
			} as Awaited<ReturnType<typeof approvePendingMember>>;
		});

		renderCard();
		fireEvent.click(await screen.findByRole("button", { name: "Approve Fran Former" }));

		const notice = await screen.findByRole("status");
		expect(notice.textContent).toContain("Fran Former is a former employee");
		expect(within(notice).getByRole("link", { name: "Start rehire" }).getAttribute("href")).toBe(
			"/settings/employees/employee-former",
		);
		await waitFor(() => expect(screen.queryByText("fran@example.test")).toBeNull());
		expect(screen.getByRole("status")).toBeTruthy();
	});

	it("shows no rehire notice when the approval brings the person in", async () => {
		pendingMembers.value = [
			pendingMember({
				id: "member-new",
				user: { id: "user-new", name: "Nia New", email: "nia@example.test", image: null },
			}),
		];
		vi.mocked(approvePendingMember).mockImplementation(async () => {
			pendingMembers.value = [];
			return {
				success: true,
				data: { success: true, rehireNeeded: null },
			} as Awaited<ReturnType<typeof approvePendingMember>>;
		});

		renderCard();
		fireEvent.click(await screen.findByRole("button", { name: "Approve Nia New" }));

		await waitFor(() => expect(screen.queryByText("nia@example.test")).toBeNull());
		expect(screen.queryByRole("status")).toBeNull();
	});
});
