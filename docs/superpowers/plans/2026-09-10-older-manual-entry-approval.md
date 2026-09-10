# Older Manual Entry Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit employee manual entries beyond the policy approval window as pending rather than rejecting them based on age.

**Architecture:** Map both non-direct policy outcomes to the existing manual-entry approval path. Preserve the shared policy evaluator, owner/admin exemption, transactional submission, configured workflow routing, and notification handling.

**Tech Stack:** TypeScript, Next.js server actions, Drizzle, existing approval services, Vitest, pnpm.

---

## References and file responsibilities

- Approved spec: `docs/superpowers/specs/2026-09-10-older-manual-entry-approval-design.md`.
- Read repository `AGENTS.md`, `docs/refs/agent-workflow.md`, `docs/refs/project-conventions.md`, and `docs/refs/timekeeping.md` before implementation.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`: only the self-entry edit-capability mapping in `createManualTimeEntry`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`: replace the obsolete age-rejection expectation and exercise pending persistence and approval dispatch.
- Reuse `apps/webapp/src/lib/approvals/server/work-period-submission.ts` without changing routing or transaction semantics.
- Preserve concurrent work. Do not commit unless the user requests a commit for this change.

### Task 1: Capture the new behavior in a failing action test

- [ ] Inspect current Git status and the two action files before editing; account for concurrent changes.
- [ ] Remove the obsolete test named `keeps the age restriction for employees without organization admin privileges`. Its expected rejection is deliberately superseded by the approved behavior.
- [ ] Add the following test to the second `createManualTimeEntry` describe block, which already provisions the pending approval submission, manager, clock entries, and work-period insert fixtures:

```ts
it("submits entries beyond the approval window as pending for their manager", async () => {
	mockState.isOrgAdminCasl.mockResolvedValue(false);
	mockState.getEditCapabilityForPeriod.mockResolvedValue({
		type: "forbidden",
		reason: "beyond_approval_window",
		daysBack: 33,
	});

	const result = await createManualTimeEntry({
		date: "2026-04-01",
		clockInTime: "08:00",
		clockOutTime: "09:00",
		reason: "Forgot to clock in",
	});

	expect(result).toMatchObject({
		success: true,
		data: { requiresApproval: true },
	});
	expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledWith(
		expect.objectContaining({
			organizationId: "org-1",
			employeeId: "employee-1",
			approvalState: "pending",
		}),
		expect.anything(),
	);
	expect(mockState.insertValues).toHaveBeenCalledWith(
		expect.objectContaining({
			organizationId: "org-1",
			employeeId: "employee-1",
			approvalStatus: "pending",
		}),
	);
	expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
		expect.objectContaining({
			organizationId: "org-1",
			requesterEmployeeId: "employee-1",
			kind: "manual_time_submission",
		}),
	);
	expect(mockState.sendManualEntryApprovalNotifications).toHaveBeenCalledWith(
		expect.objectContaining({
			organizationId: "org-1",
			employeeId: "employee-1",
			managerId: "manager-1",
		}),
	);
});
```

- [ ] Run the new test and confirm it fails because the action returns the age-limit rejection:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' -t 'submits entries beyond the approval window'
```

### Task 2: Route older submissions through existing approval handling

- [ ] In `createManualTimeEntry`, delete the `editCapability?.type === "forbidden"` early-return block and replace the `requiresApproval` assignment with:

```ts
// Older manual entries require approval rather than being blocked by age.
requiresApproval =
	editCapability?.type === "approval_required" ||
	editCapability?.type === "forbidden";
```

The existing `null` capability for owners/admins still results in `false`. A `direct` capability still results in `false`. Do not modify the service's capability union or date logic.

- [ ] Run the new regression test again with the command in Task 1. Expected: PASS, including pending storage and manager notification assertions.

### Task 3: Verify compatibility and review the patch

- [ ] Run the complete clocking, authorization-helper, and ability suites:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' src/lib/auth-helpers.test.ts src/lib/authorization/__tests__/ability.test.ts
```

Expected: all tests pass. Existing tests cover recent direct entries, approval-required entries, owner/admin exemption, policy/auth failures, configured auto-completion, replay, and missing-manager rejection. If a failure occurs, investigate its cause before changing assertions.

- [ ] Review the test fixture for mock isolation, particularly `isOrgAdminCasl`, so pending-entry tests cannot inherit privileged access from another describe block. The new test explicitly sets it to false.
- [ ] Review the action diff to confirm only manual-entry policy-result mapping changed. Confirm the transaction, manager resolver, replay protection, notifications, time capture, other-employee authorization, and existing-entry correction path are untouched.
- [ ] Run whitespace verification:

```bash
git diff --check
```

- [ ] Report test results and any skipped live/database-backed verification. Project secrets are unavailable to agents; do not start tasks requiring them. No production deployment or Git commit is part of this plan unless separately requested.
