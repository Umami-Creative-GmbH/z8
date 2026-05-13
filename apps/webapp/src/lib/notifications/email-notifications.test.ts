import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/email-service";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import { sendEmailNotification } from "./email-notifications";

const { debugMock, errorMock, infoMock, warnMock, findUserMock, getOrganizationBaseUrlMock } =
	vi.hoisted(() => ({
		debugMock: vi.fn(),
		errorMock: vi.fn(),
		infoMock: vi.fn(),
		warnMock: vi.fn(),
		findUserMock: vi.fn(),
		getOrganizationBaseUrlMock: vi.fn(),
	}));

vi.mock("@/db", () => ({
	db: {
		query: {
			user: {
				findFirst: findUserMock,
			},
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	user: {
		id: "id",
	},
}));

vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: getOrganizationBaseUrlMock,
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: vi.fn(),
}));

vi.mock("@/lib/email/template-renderer", () => ({
	renderOrganizationEmailTemplate: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: debugMock,
		error: errorMock,
		info: infoMock,
		warn: warnMock,
	}),
}));

const sendEmailMock = vi.mocked(sendEmail);
const renderOrganizationEmailTemplateMock = vi.mocked(renderOrganizationEmailTemplate);

describe("sendEmailNotification", () => {
	beforeEach(() => {
		debugMock.mockReset();
		errorMock.mockReset();
		infoMock.mockReset();
		warnMock.mockReset();
		findUserMock.mockReset();
		getOrganizationBaseUrlMock.mockReset();
		sendEmailMock.mockReset();
		renderOrganizationEmailTemplateMock.mockReset();
		findUserMock
			.mockResolvedValueOnce({ email: "alex@example.com" })
			.mockResolvedValueOnce({ name: "Alex" });
		getOrganizationBaseUrlMock.mockResolvedValue("https://org.example.com");
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Custom absence subject",
			html: "<p>Custom absence body</p>",
			usedOverride: true,
		});
		sendEmailMock.mockResolvedValue({ success: true, messageId: "msg_123" });
	});

	it("renders notification email content through organization template overrides before sending", async () => {
		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Original title",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "absence-request-approved",
			data: {
				employeeName: "Alex",
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
				appUrl: "https://org.example.com",
			},
			subjectOverride: "Absence Request Approved",
		});
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom absence subject",
			html: "<p>Custom absence body</p>",
			organizationId: "org_123",
		});
	});

	it("routes manager-recorded approved absence notifications to the manager-recorded template", async () => {
		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Absence recorded",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				managerRecorded: true,
				managerName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Sick Leave",
				days: 2,
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "absence-recorded-by-manager",
			data: {
				employeeName: "Alex",
				managerName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Sick Leave",
				days: 2,
				appUrl: "https://org.example.com",
			},
			subjectOverride: "Absence Recorded",
		});
	});

	it("preserves dynamic team member notification subjects as template subject overrides", async () => {
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "You've been added to Support",
			html: "<p>Custom team body</p>",
			usedOverride: false,
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "team_member_added",
			title: "Original team title",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				teamId: "team_123",
				teamName: "Support",
				addedByName: "Morgan",
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "team-member-added",
			data: {
				memberName: "Alex",
				teamName: "Support",
				addedByName: "Morgan",
				teamUrl: "https://org.example.com/settings/teams/team_123",
				appUrl: "https://org.example.com",
			},
			subjectOverride: "You've been added to Support",
		});
	});
});
