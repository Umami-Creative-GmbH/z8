/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinOrganizationForm } from "./join-organization-form";

const mocks = vi.hoisted(() => ({
	validateInviteCode: vi.fn(),
	push: vi.fn(),
	translate: (_key: string, fallback: string) => fallback,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: mocks.translate }),
}));

vi.mock("@/app/[locale]/(auth)/invite-code-actions", () => ({
	redeemInviteCode: vi.fn(),
	validateInviteCode: mocks.validateInviteCode,
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({ data: null, isPending: false }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("./auth-form-wrapper", () => ({
	AuthFormWrapper: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("JoinOrganizationForm mobile UX", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("stacks invite code validation controls on mobile", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/join-organization-form-body.tsx"),
			"utf8",
		);

		expect(source).toContain("flex flex-col gap-2 sm:flex-row");
		expect(source).toContain("font-mono uppercase tracking-[0.2em]");
		expect(source).toContain("w-full sm:w-auto");
	});

	it("uses full-width status cards for terminal invite states", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/join-organization-form-body.tsx"),
			"utf8",
		);

		expect(source).toContain("mx-auto w-full max-w-md");
		expect(source).toContain(
			'CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center"',
		);
	});

	it("keeps a live initial-code validation during StrictMode replay", async () => {
		mocks.validateInviteCode.mockResolvedValue({
			success: true,
			data: {
				valid: true,
				inviteCode: { organization: { name: "Strict Organization" } },
			},
		});

		render(
			<StrictMode>
				<JoinOrganizationForm code="STRICT-CODE" />
			</StrictMode>,
		);

		expect(await screen.findByText("Strict Organization")).toBeTruthy();
		expect(mocks.validateInviteCode.mock.calls.length).toBeGreaterThanOrEqual(
			2,
		);
	});

	it("validates a changed URL code and does not let stale validation win", async () => {
		const first = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		const second = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		mocks.validateInviteCode
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const { rerender } = render(<JoinOrganizationForm code="CODE-A" />);
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-A"),
		);

		rerender(<JoinOrganizationForm code="CODE-B" />);
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-B"),
		);
		expect(screen.getByLabelText("Invite Code")).toHaveProperty(
			"value",
			"CODE-B",
		);

		await act(async () => {
			second.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization B" } },
				},
			});
			await second.promise;
		});
		expect(await screen.findByText("Organization B")).toBeTruthy();

		await act(async () => {
			first.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization A" } },
				},
			});
			await first.promise;
		});

		expect(screen.getByText("Organization B")).toBeTruthy();
		expect(screen.queryByText("Organization A")).toBeNull();
	});

	it("settles initial validation with a safe error when the action rejects", async () => {
		mocks.validateInviteCode.mockRejectedValueOnce(
			new Error("validation service internals"),
		);

		render(<JoinOrganizationForm code="REJECTED-CODE" />);

		expect(await screen.findByText("Invalid invite code")).toBeTruthy();
		expect(screen.queryByText("Validating code...")).toBeNull();
		expect(screen.queryByText("validation service internals")).toBeNull();
	});

	it("ignores a manual validation result after the code changes", async () => {
		const request = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		mocks.validateInviteCode.mockReturnValueOnce(request.promise);
		render(<JoinOrganizationForm />);

		fireEvent.change(screen.getByLabelText("Invite Code"), {
			target: { value: "CODE-A" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Validate" }));
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-A"),
		);
		fireEvent.change(screen.getByLabelText("Invite Code"), {
			target: { value: "CODE-B" },
		});

		await act(async () => {
			request.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization A" } },
				},
			});
			await request.promise;
		});

		expect(screen.getByLabelText("Invite Code")).toHaveProperty(
			"value",
			"CODE-B",
		);
		expect(screen.queryByText("Organization A")).toBeNull();
		expect(screen.getByRole("button", { name: "Validate" })).toHaveProperty(
			"disabled",
			false,
		);
		expect(screen.queryByText("Validating code...")).toBeNull();
	});

	it("recovers from a rejected manual validation", async () => {
		mocks.validateInviteCode.mockRejectedValueOnce(
			new Error("validation service internals"),
		);
		render(<JoinOrganizationForm />);

		fireEvent.change(screen.getByLabelText("Invite Code"), {
			target: { value: "REJECTED-CODE" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Validate" }));

		expect(await screen.findByText("Invalid invite code")).toBeTruthy();
		expect(screen.queryByText("validation service internals")).toBeNull();
		expect(screen.getByRole("button", { name: "Validate" })).toHaveProperty(
			"disabled",
			false,
		);
	});
});
