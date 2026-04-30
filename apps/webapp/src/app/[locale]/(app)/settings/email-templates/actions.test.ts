import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	conditions: [] as unknown[],
	deleteWhere: undefined as unknown,
	insertValues: undefined as unknown,
	revalidatePath: vi.fn(),
	requireAccess: vi.fn(),
	sendEmail: vi.fn(),
	templates: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => {
		mocks.conditions.push(...conditions);
		return { and: conditions };
	}),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		delete: vi.fn(() => ({
			where: vi.fn(async (where: unknown) => {
				mocks.deleteWhere = where;
			}),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values: unknown) => {
				mocks.insertValues = values;
				return {
					onConflictDoUpdate: vi.fn(async () => undefined),
				};
			}),
		})),
		query: {
			organizationEmailTemplate: {
				findMany: vi.fn(async () => mocks.templates),
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	organizationEmailTemplate: {
		organizationId: "organizationId",
		templateKey: "templateKey",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireAccess,
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: mocks.sendEmail,
}));

import { validateEmailTemplateInput } from "@/lib/email/template-settings";
import {
	listEmailTemplates,
	resetEmailTemplate,
	saveEmailTemplate,
	sendEmailTemplateTest,
} from "./actions";

describe("email template settings actions", () => {
	beforeEach(() => {
		mocks.conditions = [];
		mocks.deleteWhere = undefined;
		mocks.insertValues = undefined;
		mocks.revalidatePath.mockReset();
		mocks.requireAccess.mockReset();
		mocks.requireAccess.mockResolvedValue({
			authContext: { user: { id: "user_1", email: "admin@example.com" } },
			organizationId: "org_1",
		});
		mocks.sendEmail.mockReset();
		mocks.sendEmail.mockResolvedValue({ success: true });
		mocks.templates = [];
	});

	it("rejects unknown variables before saving", () => {
		const result = validateEmailTemplateInput({
			templateKey: "password-reset",
			subject: "Reset {{secret}}",
			html: "<p>{{resetUrl}}</p>",
			editorDocument: { root: {} },
			isEnabled: true,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Unknown variable: secret");
	});

	it("accepts valid template input", () => {
		const result = validateEmailTemplateInput({
			templateKey: "password-reset",
			subject: "Reset your password, {{userName}}",
			html: "<p>{{resetUrl}}</p>",
			editorDocument: { root: { type: "email" } },
			isEnabled: true,
		});

		expect(result).toEqual({ success: true, errors: [] });
	});

	it("rejects non-object editor documents", () => {
		const result = validateEmailTemplateInput({
			templateKey: "password-reset",
			subject: "Reset your password",
			html: "<p>{{resetUrl}}</p>",
			editorDocument: [],
			isEnabled: true,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Editor document must be an object");
	});

	it("returns validation errors for malformed runtime input", () => {
		const result = validateEmailTemplateInput({
			templateKey: "not-a-template",
			subject: 123,
			editorDocument: null,
			plainText: false,
			isEnabled: "yes",
		} as never);

		expect(result.success).toBe(false);
		expect(result.errors).toEqual(
			expect.arrayContaining([
				"Unknown email template",
				"Subject must be a string",
				"HTML body must be a string",
				"Editor document must be an object",
				"Plain text body must be a string",
				"Enabled state must be a boolean",
			]),
		);
	});

	it("lists registry entries with active organization overrides only", async () => {
		mocks.templates = [{ templateKey: "password-reset", subject: "Override" }];

		const templates = await listEmailTemplates();

		expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
		expect(mocks.conditions).toContainEqual({ eq: ["organizationId", "org_1"] });
		expect(templates.find((entry) => entry.key === "password-reset")?.override).toEqual({
			templateKey: "password-reset",
			subject: "Override",
		});
		expect(templates.find((entry) => entry.key === "password-reset")).not.toHaveProperty(
			"defaultPreviewHtml",
		);
		expect(templates.find((entry) => entry.key === "password-reset")).not.toHaveProperty(
			"defaultPreviewPlainText",
		);
	});

	it("saves sanitized templates scoped to the active organization", async () => {
		const result = await saveEmailTemplate({
			templateKey: "password-reset",
			subject: "Reset {{userName}}",
			html: '<p>{{resetUrl}}</p><script>alert("x")</script>',
			editorDocument: { root: { type: "email" } },
			isEnabled: true,
		});

		expect(result).toEqual({ success: true });
		expect(mocks.insertValues).toMatchObject({
			organizationId: "org_1",
			templateKey: "password-reset",
			createdByUserId: "user_1",
			updatedByUserId: "user_1",
		});
		expect((mocks.insertValues as { html: string }).html).toBe("<p>{{resetUrl}}</p>");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/email-templates");
	});

	it("deletes only the active organization template when resetting", async () => {
		const result = await resetEmailTemplate("password-reset");

		expect(result).toEqual({ success: true });
		expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
		expect(mocks.conditions).toContainEqual({ eq: ["organizationId", "org_1"] });
		expect(mocks.conditions).toContainEqual({ eq: ["templateKey", "password-reset"] });
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/email-templates");
	});

	it("test sends the sanitized draft to the current admin without persisting it", async () => {
		const result = await sendEmailTemplateTest({
			templateKey: "password-reset",
			subject: "Reset {{userName}}",
			html: '<p>{{resetUrl}}</p><script>alert("x")</script>',
			plainText: "Use {{resetUrl}}",
			editorDocument: { root: { type: "email" } },
			isEnabled: true,
		});

		expect(result).toEqual({ success: true });
		expect(mocks.insertValues).toBeUndefined();
		expect(mocks.sendEmail).toHaveBeenCalledWith({
			to: "admin@example.com",
			organizationId: "org_1",
			subject: "Reset Alex Morgan",
			html: "<p>https://app.z8-time.app/reset-password?token=preview</p>",
		});
	});

	it("test send preserves safe interpolated draft links", async () => {
		const result = await sendEmailTemplateTest({
			templateKey: "password-reset",
			subject: "Reset {{userName}}",
			html: '<a href="{{resetUrl}}">Reset password</a>',
			editorDocument: { root: { type: "email" } },
			isEnabled: true,
		});

		expect(result).toEqual({ success: true });
		expect(mocks.sendEmail).toHaveBeenCalledWith({
			to: "admin@example.com",
			organizationId: "org_1",
			subject: "Reset Alex Morgan",
			html: '<a href="https://app.z8-time.app/reset-password?token=preview">Reset password</a>',
		});
	});

	it("returns a generic error when test email sending fails", async () => {
		mocks.sendEmail.mockResolvedValue({ success: false, error: "SMTP password rejected" });

		const result = await sendEmailTemplateTest({
			templateKey: "password-reset",
			subject: "Reset {{userName}}",
			html: "<p>{{resetUrl}}</p>",
			editorDocument: { root: { type: "email" } },
			isEnabled: true,
		});

		expect(result).toEqual({ success: false, errors: ["Failed to send test email"] });
		expect(JSON.stringify(result)).not.toContain("SMTP password rejected");
	});
});
