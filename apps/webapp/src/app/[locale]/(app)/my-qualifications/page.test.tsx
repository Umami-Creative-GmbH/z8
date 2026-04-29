import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectionMock, getMyQualificationsMock, redirectMock } = vi.hoisted(() => ({
	connectionMock: vi.fn(),
	getMyQualificationsMock: vi.fn(),
	redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	redirect: redirectMock,
}));

vi.mock("next/server", () => ({
	connection: connectionMock,
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: ({ feature }: { feature?: string }) => (
		<div data-testid="no-employee-error">{feature}</div>
	),
}));

vi.mock("./actions", () => ({
	getMyQualifications: getMyQualificationsMock,
}));

vi.mock("./my-qualifications-client", () => ({
	MyQualificationsClient: () => <div data-testid="my-qualifications-client" />,
}));

const { default: MyQualificationsPage } = await import("./page");

describe("MyQualificationsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connectionMock.mockResolvedValue(undefined);
	});

	it("renders the no-employee state for the exact missing employee result", async () => {
		getMyQualificationsMock.mockResolvedValue({
			success: false,
			error: "Employee profile not found",
		});

		const result = await MyQualificationsPage();

		expect(result).toMatchObject({
			props: { children: { props: { feature: "view your qualifications" } } },
		});
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("redirects other employee-related errors", async () => {
		getMyQualificationsMock.mockResolvedValue({
			success: false,
			error: "Employee permission denied",
		});

		await MyQualificationsPage();

		expect(redirectMock).toHaveBeenCalledWith("/");
	});
});
