import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnabledOrganizationEmailTemplate } from "./template-overrides";
import { renderOrganizationEmailTemplate } from "./template-renderer";

const warnMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		warn: warnMock,
	}),
}));

vi.mock("./template-overrides", () => ({
	getEnabledOrganizationEmailTemplate: vi.fn(),
}));

const getEnabledOrganizationEmailTemplateMock = vi.mocked(getEnabledOrganizationEmailTemplate);

const passwordResetData = {
	userName: "Alex",
	resetUrl: "https://app.z8-time.app/reset-password?token=test",
};

describe("renderOrganizationEmailTemplate", () => {
	beforeEach(() => {
		getEnabledOrganizationEmailTemplateMock.mockReset();
		warnMock.mockReset();
	});

	it("renders the default password reset template without loading overrides when no organization id is provided", async () => {
		const result = await renderOrganizationEmailTemplate({
			templateKey: "password-reset",
			data: passwordResetData,
		});

		expect(result.subject).toBe("Reset your password");
		expect(result.html).toContain("Alex");
		expect(result.usedOverride).toBe(false);
		expect(getEnabledOrganizationEmailTemplateMock).not.toHaveBeenCalled();
	});

	it("renders an enabled organization password reset override with interpolated subject and html", async () => {
		getEnabledOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Reset password for {{userName}}",
			html: "<p>Use {{resetUrl}}</p>",
			plainText: null,
		});

		const result = await renderOrganizationEmailTemplate({
			organizationId: "org_123",
			templateKey: "password-reset",
			data: passwordResetData,
		});

		expect(getEnabledOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			"org_123",
			"password-reset",
		);
		expect(result).toEqual({
			subject: "Reset password for Alex",
			html: "<p>Use https://app.z8-time.app/reset-password?token=test</p>",
			plainText: undefined,
			usedOverride: true,
		});
	});

	it("renders interpolated plain text for an enabled organization override", async () => {
		getEnabledOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Reset password for {{userName}}",
			html: "<p>Use {{resetUrl}}</p>",
			plainText: "Use {{resetUrl}} to reset {{userName}}'s password.",
		});

		const result = await renderOrganizationEmailTemplate({
			organizationId: "org_123",
			templateKey: "password-reset",
			data: passwordResetData,
		});

		expect(result.plainText).toBe(
			"Use https://app.z8-time.app/reset-password?token=test to reset Alex's password.",
		);
		expect(result.usedOverride).toBe(true);
	});

	it("falls back to the default subject and html when an override references an unknown variable", async () => {
		getEnabledOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Reset {{secret}}",
			html: "<p>Use {{resetUrl}}</p>",
			plainText: null,
		});

		const result = await renderOrganizationEmailTemplate({
			organizationId: "org_123",
			templateKey: "password-reset",
			data: passwordResetData,
		});

		expect(result.subject).toBe("Reset your password");
		expect(result.html).toContain("Alex");
		expect(result.usedOverride).toBe(false);
		expect(warnMock).toHaveBeenCalledWith(
			{
				errors: ["Unknown variable: secret"],
				organizationId: "org_123",
				templateKey: "password-reset",
			},
			"Invalid organization email template override, falling back to default",
		);
	});

	it("falls back to the default subject and html when plain text references an unknown variable", async () => {
		getEnabledOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Reset password for {{userName}}",
			html: "<p>Use {{resetUrl}}</p>",
			plainText: "Secret {{unknownVar}}",
		});

		const result = await renderOrganizationEmailTemplate({
			organizationId: "org_123",
			templateKey: "password-reset",
			data: passwordResetData,
		});

		expect(result.subject).toBe("Reset your password");
		expect(result.html).toContain("Alex");
		expect(result.plainText).toBeUndefined();
		expect(result.usedOverride).toBe(false);
		expect(warnMock).toHaveBeenCalledWith(
			{
				errors: ["Unknown variable: unknownVar"],
				organizationId: "org_123",
				templateKey: "password-reset",
			},
			"Invalid organization email template override, falling back to default",
		);
	});
});
