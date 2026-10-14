/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getEmployeeSkills,
	getSkillExpiryWindow,
	updateEmployeeSkillExpiry,
} from "@/app/[locale]/(app)/settings/skills/actions";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { EmployeeSkillsCard } from "./employee-skills-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/action-panel", () => {
	const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: ({ children, open }: { children?: ReactNode; open: boolean }) =>
			open ? <div>{children}</div> : null,
		ActionPanelBody: Pass,
		ActionPanelContent: Pass,
		ActionPanelDescription: Pass,
		ActionPanelFooter: Pass,
		ActionPanelHeader: Pass,
		ActionPanelTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
	};
});
vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	assignSkillToEmployee: vi.fn(),
	removeSkillFromEmployee: vi.fn(),
	getEmployeeSkills: vi.fn(),
	getOrganizationSkills: vi.fn(),
	getSkillExpiryWindow: vi.fn(),
	updateEmployeeSkillExpiry: vi.fn(),
}));

const forklift = {
	id: "es-forklift",
	employeeId: "employee-1",
	skillId: "skill-forklift",
	expiresAt: "2028-03-31",
	notes: null,
	assignedBy: "user-1",
	assignedAt: new Date("2026-01-01T00:00:00Z"),
	certificateOnFile: false,
	expiryDateFromCertificate: false,
	skill: {
		id: "skill-forklift",
		organizationId: "org-1",
		name: "Forklift licence",
		description: null,
		category: "certification",
		customCategoryName: null,
		requiresExpiry: true,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: "user-1",
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		updatedBy: null,
	},
} as EmployeeSkillWithDetails;

async function saveEditedExpiry() {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />
		</QueryClientProvider>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Edit expiry date of Forklift licence" }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
	return vi.mocked(toast.error).mock.calls[0]?.[0];
}

beforeEach(() => {
	vi.mocked(toast.error).mockReset();
	vi.mocked(getEmployeeSkills).mockResolvedValue({ success: true, data: [forklift] });
	vi.mocked(getSkillExpiryWindow).mockResolvedValue({
		success: true,
		data: { today: "2026-10-13", expiringSoonDays: 30 },
	});
});

describe("editing a skill expiry date the server refuses", () => {
	it("explains in the app language that a skill certificate sets the date", async () => {
		vi.mocked(updateEmployeeSkillExpiry).mockResolvedValue({
			success: false,
			error: "Server wording",
			code: "ValidationError",
			refusal: "expiry_date_set_by_certificate",
		});

		expect(await saveEditedExpiry()).toBe(
			"A skill certificate in the personnel file sets this date. Change the date on the certificate.",
		);
	});

	it("shows its own failure message, never the server's wording, for anything else", async () => {
		vi.mocked(updateEmployeeSkillExpiry).mockResolvedValue({
			success: false,
			error: "Employee skill not found",
			code: "NotFoundError",
		});

		expect(await saveEditedExpiry()).toBe("Failed to update the expiry date");
	});
});
