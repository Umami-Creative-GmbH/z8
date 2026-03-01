import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type { AbsenceData, WorkPeriodData } from "../../types";
import { WorkdayConnector } from "./workday-connector";
import { DEFAULT_WORKDAY_CONFIG } from "./types";

describe("WorkdayConnector", () => {
	it("validates required config fields and ranges", async () => {
		const connector = new WorkdayConnector();

		await expect(
			connector.validateConfig({
				instanceUrl: "",
				tenantId: "",
				employeeMatchStrategy: "externalId",
				batchSize: 0,
				apiTimeoutMs: 999,
			}),
		).resolves.toEqual({
			valid: false,
			errors: [
				"instanceUrl is required",
				"tenantId is required",
				"employeeMatchStrategy must be 'employeeNumber' or 'email'",
				"batchSize must be between 1 and 500",
				"apiTimeoutMs must be between 1000 and 120000",
			],
		});
	});

	it("returns validation errors for malformed config types", async () => {
		const connector = new WorkdayConnector();

		await expect(
			connector.validateConfig({
				instanceUrl: 123,
				tenantId: true,
				employeeMatchStrategy: ["employeeNumber"],
				batchSize: "100",
				apiTimeoutMs: null,
			}),
		).resolves.toEqual({
			valid: false,
			errors: [
				"instanceUrl must be a string",
				"tenantId must be a string",
				"employeeMatchStrategy must be 'employeeNumber' or 'email'",
				"batchSize must be a number",
				"apiTimeoutMs must be a number",
			],
		});
	});

	it("tests connection with org-scoped credentials and oauth token", async () => {
		const getCredentials = vi.fn().mockResolvedValue({
			clientId: "client_123",
			clientSecret: "secret_123",
			scope: "system",
		});
		const getOAuthToken = vi.fn().mockResolvedValue({
			accessToken: "token_123",
			tokenType: "Bearer",
			expiresAt: Date.now() + 3600_000,
		});
		const testConnection = vi.fn().mockResolvedValue({ success: true });
		const connector = new WorkdayConnector({
			getCredentials,
			createApiClient: () => ({ getOAuthToken, testConnection }),
		});

		const response = await connector.testConnection("org_123", {
			...DEFAULT_WORKDAY_CONFIG,
			instanceUrl: "https://example.workday.com",
			tenantId: "acme",
		});

		expect(response).toEqual({ success: true });
		expect(getCredentials).toHaveBeenCalledWith("org_123");
		expect(getOAuthToken).toHaveBeenCalledWith({
			clientId: "client_123",
			clientSecret: "secret_123",
			scope: "system",
		});
		expect(testConnection).toHaveBeenCalledWith("token_123");
		expect(testConnection).toHaveBeenCalledTimes(1);
	});

	it("returns credential error when org-scoped secrets are missing", async () => {
		const connector = new WorkdayConnector({
			getCredentials: vi.fn().mockResolvedValue(null),
		});

		await expect(
			connector.testConnection("org_123", {
				...DEFAULT_WORKDAY_CONFIG,
				instanceUrl: "https://example.workday.com",
				tenantId: "acme",
			}),
		).resolves.toEqual({
			success: false,
			error:
				"Workday credentials not configured. Please enter your Client ID and Client Secret.",
		});
	});

	it("returns safe v1 export result when records are not pushed", async () => {
		const testConnection = vi.fn().mockResolvedValue({ success: true });
		const getOAuthToken = vi.fn().mockResolvedValue({
			accessToken: "token_123",
			tokenType: "Bearer",
			expiresAt: Date.now() + 3600_000,
		});
		const connector = new WorkdayConnector({
			getCredentials: vi.fn().mockResolvedValue({
				clientId: "client_123",
				clientSecret: "secret_123",
			}),
			createApiClient: () => ({ getOAuthToken, testConnection }),
		});

		const workPeriods: WorkPeriodData[] = [
			{
				id: "wp_1",
				employeeId: "emp_1",
				employeeNumber: "1001",
				firstName: "Ada",
				lastName: "Lovelace",
				startTime: DateTime.fromISO("2026-01-10T08:00:00Z"),
				endTime: DateTime.fromISO("2026-01-10T12:00:00Z"),
				durationMinutes: 240,
				workCategoryId: null,
				workCategoryName: null,
				workCategoryFactor: null,
				projectId: null,
				projectName: null,
			},
		];

		const absences: AbsenceData[] = [
			{
				id: "abs_1",
				employeeId: "emp_2",
				employeeNumber: "1002",
				firstName: "Grace",
				lastName: "Hopper",
				startDate: "2026-01-11",
				endDate: "2026-01-11",
				absenceCategoryId: "cat_1",
				absenceCategoryName: "Vacation",
				absenceType: "vacation",
				status: "approved",
			},
		];

		const result = await connector.export(
			"org_123",
			workPeriods,
			absences,
			[],
			{
				...DEFAULT_WORKDAY_CONFIG,
				instanceUrl: "https://example.workday.com",
				tenantId: "acme",
			},
		);

		expect(result.success).toBe(false);
		expect(result.totalRecords).toBe(2);
		expect(result.syncedRecords).toBe(0);
		expect(result.failedRecords).toBe(2);
		expect(result.skippedRecords).toBe(0);
		expect(result.errors).toEqual([
			{
				recordId: "wp_1",
				recordType: "attendance",
				employeeId: "emp_1",
				errorMessage: "Workday export placeholder is not implemented; record was not synced.",
				isRetryable: false,
			},
			{
				recordId: "abs_1",
				recordType: "absence",
				employeeId: "emp_2",
				errorMessage: "Workday export placeholder is not implemented; record was not synced.",
				isRetryable: false,
			},
		]);
		expect(result.metadata.employeeCount).toBe(2);
		expect(result.metadata.dateRange).toEqual({
			start: "2026-01-10",
			end: "2026-01-11",
		});
		expect(result.metadata.apiCallCount).toBe(0);
		expect(testConnection).toHaveBeenCalledTimes(1);
	});

	it("returns stable sync threshold", () => {
		const connector = new WorkdayConnector();
		expect(connector.exporterId).toBe("workday_api");
		expect(connector.getSyncThreshold()).toBe(500);
	});
});
