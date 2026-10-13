/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	listCertificateSkillOptionsAction,
	setCertificateSkillAction,
} from "@/app/[locale]/(app)/personnel-files/skill-certificate-actions";
import type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";
import { CertificateSkillDialog } from "./certificate-skill-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
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
vi.mock("@/app/[locale]/(app)/personnel-files/skill-certificate-actions", () => ({
	listCertificateSkillOptionsAction: vi.fn(),
	setCertificateSkillAction: vi.fn(),
}));

const certificate = {
	id: "document-1",
	employeeId: "employee-1",
	title: "Forklift licence",
	expiryDate: "2028-03-31",
	skill: { employeeSkillId: "es-forklift", name: "Forklift licence" },
} as unknown as EmployeeDocumentView;

async function saveSkill() {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<CertificateSkillDialog
				document={certificate}
				open
				onOpenChange={vi.fn()}
				onSaved={vi.fn()}
			/>
		</QueryClientProvider>,
	);
	await screen.findByText("Forklift licence", { selector: "span" });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
	return vi.mocked(toast.error).mock.calls[0]?.[0];
}

beforeEach(() => {
	vi.mocked(toast.error).mockReset();
	vi.mocked(listCertificateSkillOptionsAction).mockResolvedValue({
		success: true,
		data: [{ employeeSkillId: "es-forklift", name: "Forklift licence", requiresExpiry: true }],
	});
});

describe("naming the skill of a certificate the server refuses", () => {
	it.each([
		[
			"undated_requires_expiry",
			"This skill requires an expiry date. Only a certificate with an expiry date can prove it.",
		],
		["not_certificate", "Only certificates can prove a skill."],
		["not_employee_skill", "Choose one of this employee's skills."],
	])("words the %s refusal in the app language", async (code, text) => {
		vi.mocked(setCertificateSkillAction).mockResolvedValue({
			success: false,
			error: "Server wording",
			code,
		});

		expect(await saveSkill()).toBe(text);
	});

	it("shows its own failure message, never the server's wording, for anything else", async () => {
		vi.mocked(setCertificateSkillAction).mockResolvedValue({ success: false, error: "Not found" });

		expect(await saveSkill()).toBe("The skill of the certificate could not be saved.");
	});
});
