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

	it("exports matched records and skips zero-hour rows", async () => {
		const testConnection = vi.fn().mockResolvedValue({ success: true });
		const getOAuthToken = vi.fn().mockResolvedValue({
			accessToken: "token_123",
			tokenType: "Bearer",
			expiresAt: Date.now() + 3600_000,
		});
		const findWorkerByEmployeeNumber = vi
			.fn()
			.mockResolvedValueOnce({ id: "worker-1" })
			.mockResolvedValueOnce({ id: "worker-2" });
		const createAttendance = vi.fn().mockResolvedValue(undefined);
		const createAbsence = vi.fn().mockResolvedValue(undefined);
		const connector = new WorkdayConnector({
			getCredentials: vi.fn().mockResolvedValue({
				clientId: "client_123",
				clientSecret: "secret_123",
			}),
			createApiClient: () => ({
				getOAuthToken,
				testConnection,
				findWorkerByEmployeeNumber,
				findWorkerByEmail: vi.fn(),
				createAttendance,
				createAbsence,
			}),
		});

		const workPeriods: WorkPeriodData[] = [
			{
				id: "wp_1",
				employeeId: "emp_1",
				employeeNumber: "1001",
				firstName: "Ada",
				lastName: "Lovelace",
				email: "ada@example.com",
				startTime: DateTime.fromISO("2026-01-10T08:00:00Z"),
				endTime: DateTime.fromISO("2026-01-10T12:00:00Z"),
				durationMinutes: 240,
				workCategoryId: null,
				workCategoryName: null,
				workCategoryFactor: null,
				projectId: null,
				projectName: null,
			},
			{
				id: "wp_2",
				employeeId: "emp_3",
				employeeNumber: "1003",
				firstName: "Zero",
				lastName: "Hours",
				email: "zero@example.com",
				startTime: DateTime.fromISO("2026-01-12T08:00:00Z"),
				endTime: DateTime.fromISO("2026-01-12T08:00:00Z"),
				durationMinutes: 0,
				workCategoryId: null,
				workCategoryName: "Regular",
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
				email: "grace@example.com",
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

		expect(result.success).toBe(true);
		expect(result.totalRecords).toBe(3);
		expect(result.syncedRecords).toBe(2);
		expect(result.failedRecords).toBe(0);
		expect(result.skippedRecords).toBe(1);
		expect(result.errors).toEqual([]);
		expect(result.skipped).toEqual([
			{
				recordId: "wp_2",
				recordType: "attendance",
				employeeId: "emp_3",
				reason: "Skipped zero-hour work period because includeZeroHours is disabled.",
			},
		]);
		expect(result.metadata.employeeCount).toBe(3);
		expect(result.metadata.dateRange).toEqual({
			start: "2026-01-10",
			end: "2026-01-12",
		});
		expect(result.metadata.apiCallCount).toBe(4);
		expect(findWorkerByEmployeeNumber).toHaveBeenCalledTimes(2);
		expect(createAttendance).toHaveBeenCalledWith("token_123", {
			workerId: "worker-1",
			sourceId: "wp_1",
			startDate: "2026-01-10",
			endDate: "2026-01-10",
			hours: 4,
			projectName: null,
			categoryName: null,
		});
		expect(createAbsence).toHaveBeenCalledWith("token_123", {
			workerId: "worker-2",
			sourceId: "abs_1",
			startDate: "2026-01-11",
			endDate: "2026-01-11",
			absenceCategoryName: "Vacation",
			absenceType: "vacation",
		});
		expect(testConnection).toHaveBeenCalledTimes(1);
	});

	it("uses email matching when configured", async () => {
		const testConnection = vi.fn().mockResolvedValue({ success: true });
		const getOAuthToken = vi.fn().mockResolvedValue({
			accessToken: "token_123",
			tokenType: "Bearer",
			expiresAt: Date.now() + 3600_000,
		});
		const findWorkerByEmail = vi.fn().mockResolvedValue({ id: "worker-email" });
		const createAttendance = vi.fn().mockResolvedValue(undefined);
		const connector = new WorkdayConnector({
			getCredentials: vi.fn().mockResolvedValue({
				clientId: "client_123",
				clientSecret: "secret_123",
			}),
			createApiClient: () => ({
				getOAuthToken,
				testConnection,
				findWorkerByEmployeeNumber: vi.fn(),
				findWorkerByEmail,
				createAttendance,
				createAbsence: vi.fn(),
			}),
		});

		await connector.export(
			"org_123",
			[
				{
					id: "wp_email",
					employeeId: "emp_email",
					employeeNumber: null,
					firstName: "Email",
					lastName: "Match",
					email: "email@example.com",
					startTime: DateTime.fromISO("2026-01-10T08:00:00Z"),
					endTime: DateTime.fromISO("2026-01-10T10:00:00Z"),
					durationMinutes: 120,
					workCategoryId: null,
					workCategoryName: "Regular",
					workCategoryFactor: null,
					projectId: null,
					projectName: null,
				},
			],
			[],
			[],
			{
				...DEFAULT_WORKDAY_CONFIG,
				instanceUrl: "https://example.workday.com",
				tenantId: "acme",
				employeeMatchStrategy: "email",
			},
		);

		expect(findWorkerByEmail).toHaveBeenCalledWith("token_123", "email@example.com");
		expect(createAttendance).toHaveBeenCalledTimes(1);
	});

	it("returns stable sync threshold", () => {
		const connector = new WorkdayConnector();
		expect(connector.exporterId).toBe("workday_api");
		expect(connector.getSyncThreshold()).toBe(500);
	});
});
