# Webapp UI and UX rollout: proposed ticket breakdown

Status: approved on 14 November 2026, including test boundaries, complete-page sizes and blocking edges. Publication is tracked in #1692.

This is the execution index for the [single spec](2026-11-14-webapp-ui-ux-spec.md), tracked by [#1692](https://github.com/Umami-Creative-GmbH/z8/issues/1692). The spec owns design and acceptance; this index owns proposed ticket identity and blocking edges. Planning IDs remain stable when GitHub numbers are assigned.

There are **160 proposed subordinate issues: 153 page tickets, three shared foundations and four tracking groups**. All 172 source page templates are covered; the 19 redirect-only aliases belong to destination-page tickets. The root has seven direct children; G1/G2/G3/G4 have 52/68/24/9. Group membership is a native parent relationship, never an implementation blocker.

The entries below are in blockers-first publication order. Foundation IDs name required changed outputs; brief references also apply as design contracts where an existing primitive already complies. In particular, standalone initialization R023 can use existing primitives immediately, while accepting the F1 language. Invitation acceptance R003 and email resend R171 use existing action controls and do not wait for new editable-form/overlay outputs. Redundant transitive blockers are omitted. No page waits on an arbitrary preceding page.

F1 requires the dashboard/time-tracking baseline from open issue #1689 to be available in the implementation base. This is an explicit prerequisite, not permission to merge it. F2/F3 each include real consumer demonstrations; they do not wait on the route tickets that will later finish those consumers. Coordinate any pilot changes as owned handoffs.

## Contract carried into every page ticket

Each published page issue includes its exact stable ID/URL, root spec, native group parent, five-field composition brief, actual blockers and explicit destination aliases. Its acceptance criteria require a current capability-to-location inventory; preservation of authorized reads/actions, fields, calculations, time semantics, preferences and recovery; shared-owner handoffs without authorization changes; meaningful regressions; applicable runtime roles/states and responsive/theme/font/keyboard checks; real before/after evidence; and an exact list of blocked checks.

The global verification matrix applies by actual capabilities, including organization switches and permission loss during in-flight work. Shared primitive testing is reused without omitting page-specific behavior. Neither a screenshot nor compile-only success completes a route. The two refreshed reference routes get conformance work, not an automatic second redesign. Every ticket is claimed before investigation, implemented on a dedicated feature branch targeting `dev`, and committed; merge/deploy is outside this authorization.

## Publication and review

Review the concrete titles, complete-page sizes, test seams and blocking edges below. Once approved, publish the root spec's global contract with the versioned per-page annex as part of the same spec. Publish three foundation children and four tracking groups, then the page issues under their groups, each referencing #1692. Keep groups out of the agent-ready implementation frontier.

Use the repository publisher with dry runs for each correctly parented batch, add cross-batch dependencies natively, and read back every parent and blocking edge. Persist the number/ID mapping in scratch and record publication progress so retries do not duplicate tickets. If the hierarchy/dependency API fails, retain an explicitly incomplete setup rather than claiming body references are native relationships. Recheck source coverage and ownership before publishing. Do not close or merge existing work as a side effect.

## Numbered proposed issues


1. **F1 — [UI/UX] Refresh shared shells, page composition and operational states**

   - Parent: #1692.
   - Blocked by: #1689.
   - Delivers: Make navigation, page context and global feedback follow the approved language across their actual consumers, while preserving every destination, preference, role boundary and recovery path. Demonstrate staged title ownership and both converted and unconverted consumers.



2. **F2 — [UI/UX] Refresh records, filters and responsive table interactions**

   - Parent: #1692.
   - Blocked by: F1.
   - Delivers: Make record tasks readable and fully operable on desktop and phones through existing table/list and toolbar compositions. Demonstrate a local list and a server-paged list with real filtering, sorting, selection, pagination and existing export/bulk actions.



3. **F3 — [UI/UX] Refresh forms, panels and consequential confirmations**

   - Parent: #1692.
   - Blocked by: F1.
   - Delivers: Make ordinary editing, confirmations and long tasks use the agreed small family with accessible labels, validation, focus and save/cancel feedback. Demonstrate ordinary editing and a consequential reason/evidence task, including pending dismissal and failure recovery.



4. **G1 — [UI/UX rollout] Workplace, team and operations**

   - Parent: #1692.
   - Blocked by: None.
   - Delivers: Track the 52 page issues in this family, their alias coverage where applicable and their shared handoffs against the same root spec. This issue is an organizational container; completion requires its children and applicable integration evidence.



5. **G2 — [UI/UX rollout] Settings**

   - Parent: #1692.
   - Blocked by: None.
   - Delivers: Track the 68 page issues in this family, their alias coverage where applicable and their shared handoffs against the same root spec. This issue is an organizational container; completion requires its children and applicable integration evidence.



6. **G3 — [UI/UX rollout] Entry, onboarding and public experiences**

   - Parent: #1692.
   - Blocked by: None.
   - Delivers: Track the 24 page issues in this family, their alias coverage where applicable and their shared handoffs against the same root spec. This issue is an organizational container; completion requires its children and applicable integration evidence.



7. **G4 — [UI/UX rollout] Platform administration**

   - Parent: #1692.
   - Blocked by: None.
   - Delivers: Track the 9 page issues in this family, their alias coverage where applicable and their shared handoffs against the same root spec. This issue is an organizational container; completion requires its children and applicable integration evidence.



8. **R001 — [UI/UX] Verify dashboard conformance (/)**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Give the active organization's member a personal work overview, with team oversight only where authorized. Use the existing clock, leave request, attention links or Customize control appropriate to the visible module.

   - Brief: R001 in the canonical spec; includes composition, preserved capabilities and shared contracts.

9. **R002 — [UI/UX] Refresh /absences**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an employee review their own absences and vacation balance for the current organization-calendar year. Add absence through the existing request flow.

   - Brief: R002 in the canonical spec; includes composition, preserved capabilities and shared contracts.

10. **R003 — [UI/UX] Refresh /accept-invitation/[invitationId]**

   - Parent: G3.
   - Blocked by: F1.
   - Delivers: Review an invitation to the named organization using the intended recipient account. Accept the valid invitation; offer sign-in or signup when authentication is needed.

   - Brief: R003 in the canonical spec; includes composition, preserved capabilities and shared contracts.

11. **R004 — [UI/UX] Refresh /analytics**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Give managers and workforce admins organization analytics for the selected date range. Inspect the range and export its existing team-hours summary.

   - Brief: R004 in the canonical spec; includes composition, preserved capabilities and shared contracts.

12. **R005 — [UI/UX] Refresh /analytics/overtime-burn-down**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let managers and workforce admins compare overtime reduction across the active organization's selected period and grouping. Set the existing filters and export the resulting breakdown.

   - Brief: R005 in the canonical spec; includes composition, preserved capabilities and shared contracts.

13. **R006 — [UI/UX] Refresh /analytics/team-performance**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let managers and workforce admins compare organization teams during a selected date range. Review the comparison or export its existing team performance data.

   - Brief: R006 in the canonical spec; includes composition, preserved capabilities and shared contracts.

14. **R007 — [UI/UX] Refresh /analytics/vacation-trends**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Give managers and workforce admins vacation utilization and employee balance comparisons for the selected organization period. Inspect the chosen range and export the existing vacation dataset.

   - Brief: R007 in the canonical spec; includes composition, preserved capabilities and shared contracts.

15. **R008 — [UI/UX] Refresh /analytics/work-hours**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let managers and workforce admins analyze organization work hours and variance for a selected period. Review the range or export existing employee hours analytics.

   - Brief: R008 in the canonical spec; includes composition, preserved capabilities and shared contracts.

16. **R009 — [UI/UX] Refresh /approvals**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let managers and workforce admins decide legacy absence and time-correction requests in their authorized organization scope. Approve or reject an eligible request in its existing queue.

   - Brief: R009 in the canonical spec; includes composition, preserved capabilities and shared contracts.

17. **R010 — [UI/UX] Refresh /approvals/deputy-decisions/[absenceId]**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Show an authorized employee the decisions their deputy made during the selected absence. View the decision history or return to the inbox.

   - Brief: R010 in the canonical spec; includes composition, preserved capabilities and shared contracts.

18. **R011 — [UI/UX] Refresh /approvals/inbox**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let authorized approvers decide organization requests under each item's current decision right, including explicit covering sections. Open a request and decide it; retain eligible bulk actions, fast lanes and approval sprint.

   - Brief: R011 in the canonical spec; includes composition, preserved capabilities and shared contracts.

19. **R012 — [UI/UX] Refresh /approvals/review/[organizationId]/[kind]/[id]**

   - Parent: G1.
   - Blocked by: R011.
   - Delivers: Bring a signed-in recipient to one approval after rechecking the target organization and current access. Review its authorized detail, switch organization when offered, or open the inbox.

   - Brief: R012 in the canonical spec; includes composition, preserved capabilities and shared contracts.

20. **R013 — [UI/UX] Refresh /billing/suspended**

   - Parent: G1.
   - Blocked by: F1.
   - Delivers: Explain suspended access for the active organization's member and the available billing recovery path. Open billing when the existing billing-management ability permits it; otherwise view contact-admin guidance.

   - Brief: R013 in the canonical spec; includes composition, preserved capabilities and shared contracts.

21. **R014 — [UI/UX] Refresh /calendar**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an employee inspect authorized work, absences and holidays in the selected employee's calendar context. Browse the period and open an eligible record or existing calendar action.

   - Brief: R014 in the canonical spec; includes composition, preserved capabilities and shared contracts.

22. **R015 — [UI/UX] Refresh /calendar/[employeeId]**

   - Parent: G1.
   - Blocked by: R014.
   - Delivers: Open the authorized target employee's calendar in the active organization, including date-linked arrivals. Inspect the selected employee's records and use only their returned eligible actions.

   - Brief: R015 in the canonical spec; includes composition, preserved capabilities and shared contracts.

23. **R016 — [UI/UX] Refresh /compliance**

   - Parent: G1.
   - Blocked by: F1.
   - Delivers: Give an organization admin a command center for organization compliance risks and coverage. Open the existing workflow linked from an actionable finding.

   - Brief: R016 in the canonical spec; includes composition, preserved capabilities and shared contracts.

24. **R017 — [UI/UX] Refresh /driving-licence**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Serve the active organization's driver, verifier and operational reader through their capability-granted role tabs. Report an impediment, open an employee check, or view planning status as currently permitted.

   - Brief: R017 in the canonical spec; includes composition, preserved capabilities and shared contracts.

25. **R018 — [UI/UX] Refresh /driving-licence/checks/[employee]**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let a scoped driving-licence reader/verifier inspect the selected employee's authorization and original-check evidence. Record the original check, supplement evidence or reinstate authorization only when existing capabilities allow.

   - Brief: R018 in the canonical spec; includes composition, preserved capabilities and shared contracts.

26. **R019 — [UI/UX] Refresh /equipment**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let scoped equipment staff review organization assignments, outstanding returns and items ready to issue. Issue equipment when setup and capabilities permit; otherwise follow existing setup guidance.

   - Brief: R019 in the canonical spec; includes composition, preserved capabilities and shared contracts.

27. **R020 — [UI/UX] Refresh /equipment/assignments/[assignmentId]**

   - Parent: G1.
   - Blocked by: F3.
   - Delivers: Let an authorized equipment reader/operator inspect one organization's assignment and settle its return obligations. Record receipt when allowed; retain separate transfer, close-return and correction actions.

   - Brief: R020 in the canonical spec; includes composition, preserved capabilities and shared contracts.

28. **R021 — [UI/UX] Refresh /equipment/employees/[employeeId]**

   - Parent: G1.
   - Blocked by: R019.
   - Delivers: Show authorized equipment staff an employee's holdings and outstanding returns within authorized organization scope. Issue equipment for an eligible current employee or open an existing assignment for follow-up.

   - Brief: R021 in the canonical spec; includes composition, preserved capabilities and shared contracts.

29. **R022 — [UI/UX] Refresh /forgot-password**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Request account recovery from the current authentication domain. Send the password-reset link.

   - Brief: R022 in the canonical spec; includes composition, preserved capabilities and shared contracts.

30. **R023 — [UI/UX] Refresh /init**

   - Parent: G3.
   - Blocked by: None.
   - Delivers: Establish a signed-in user's active organization before entering the requested workspace destination. Select an available organization when selection is required.

   - Brief: R023 in the canonical spec; includes composition, preserved capabilities and shared contracts.

31. **R024 — [UI/UX] Refresh /join/[code]**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Validate an invitation code and request membership of its organization. Join when eligible, with sign-in continuation for unauthenticated visitors.

   - Brief: R024 in the canonical spec; includes composition, preserved capabilities and shared contracts.

32. **R025 — [UI/UX] Refresh /kiosk**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Let an enrolled organization/location device identify employees and capture their own clocking without account sign-in. Pair the device when unpaired, then perform the credential-authorized clock action.

   - Brief: R025 in the canonical spec; includes composition, preserved capabilities and shared contracts.

33. **R026 — [UI/UX] Refresh /licenses**

   - Parent: G3.
   - Blocked by: F2.
   - Delivers: Read the webapp's open-source dependency license report without signing in. Search for a package or license; follow its repository or homepage when needed.

   - Brief: R026 in the canonical spec; includes composition, preserved capabilities and shared contracts.

34. **R027 — [UI/UX] Refresh /mfa**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Let a signed-in user satisfy organization-specific security requirements while personal recovery and organization selection remain available. Verify an authenticator for the selected organization.

   - Brief: R027 in the canonical spec; includes composition, preserved capabilities and shared contracts.

35. **R028 — [UI/UX] Refresh /my-documents**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an employee access their own organization-shared personnel documents and respond to document requests. Upload a permitted document or submit documents for a request.

   - Brief: R028 in the canonical spec; includes composition, preserved capabilities and shared contracts.

36. **R029 — [UI/UX] Refresh /my-equipment**

   - Parent: G1.
   - Blocked by: F1.
   - Delivers: Let an employee read equipment issued to them in the active organization and understand return obligations. View an item's handover history and amendments, without equipment-operation authority.

   - Brief: R029 in the canonical spec; includes composition, preserved capabilities and shared contracts.

37. **R030 — [UI/UX] Refresh /my-requests**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an employee follow their own absence, time-correction and legacy expense requests in the active organization. Fix, view or cancel a request only where its existing action permits.

   - Brief: R030 in the canonical spec; includes composition, preserved capabilities and shared contracts.

38. **R031 — [UI/UX] Refresh /notifications**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let the signed-in user review their notification timeline and visible unread workload. Open a notification, mark selected visible items read, or delete them.

   - Brief: R031 in the canonical spec; includes composition, preserved capabilities and shared contracts.

39. **R032 — [UI/UX] Refresh /onboarding/complete**

   - Parent: G3.
   - Blocked by: F1.
   - Delivers: Finalize personal onboarding and review the resulting workspace context. Continue through initialization into the workspace.

   - Brief: R032 in the canonical spec; includes composition, preserved capabilities and shared contracts.

40. **R033 — [UI/UX] Refresh /onboarding/notifications**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Set the onboarding user's notification preferences and request supported push permission. Save preferences and continue; preserve skipping as an explicit alternative.

   - Brief: R033 in the canonical spec; includes composition, preserved capabilities and shared contracts.

41. **R034 — [UI/UX] Refresh /onboarding/organization**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Create an organization or continue onboarding with existing membership or an expected invitation. Create the organization when policy permits; otherwise continue using the existing skip path.

   - Brief: R034 in the canonical spec; includes composition, preserved capabilities and shared contracts.

42. **R035 — [UI/UX] Refresh /onboarding/profile**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Establish the onboarding user's personal profile and display preferences. Save the profile and continue, retaining the existing skip path.

   - Brief: R035 in the canonical spec; includes composition, preserved capabilities and shared contracts.

43. **R036 — [UI/UX] Refresh /onboarding/vacation-policy**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Configure the organization vacation policy for an eligible onboarding administrator. Save the policy and continue; retain skip.

   - Brief: R036 in the canonical spec; includes composition, preserved capabilities and shared contracts.

44. **R037 — [UI/UX] Refresh /onboarding/welcome**

   - Parent: G3.
   - Blocked by: F1.
   - Delivers: Start or resume the user's onboarding with organization context. Start setup or continue to profile when membership already exists.

   - Brief: R037 in the canonical spec; includes composition, preserved capabilities and shared contracts.

45. **R038 — [UI/UX] Refresh /onboarding/wellness**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Configure the onboarding user's water-reminder preferences. Save preferences and continue, retaining skip.

   - Brief: R038 in the canonical spec; includes composition, preserved capabilities and shared contracts.

46. **R039 — [UI/UX] Refresh /onboarding/work-schedule**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Set the initial organization weekly work schedule for an eligible onboarding administrator. Save weekly hours and work classification, then continue; retain skip.

   - Brief: R039 in the canonical spec; includes composition, preserved capabilities and shared contracts.

47. **R040 — [UI/UX] Refresh /onboarding/work-templates**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Create the organization work template for an eligible onboarding administrator. Save the template and continue; retain skip.

   - Brief: R040 in the canonical spec; includes composition, preserved capabilities and shared contracts.

48. **R041 — [UI/UX] Refresh /organization**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let organization readers explore the current roster's teams, direct managers and reporting relationships. Search or select a person to inspect their relationships; admins retain settings links.

   - Brief: R041 in the canonical spec; includes composition, preserved capabilities and shared contracts.

49. **R042 — [UI/UX] Refresh /payroll**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let authorized payroll actors prepare exports for their selected organization period, target and employee/team scope. Trigger the configured payroll export; retain the separate PDF download.

   - Brief: R042 in the canonical spec; includes composition, preserved capabilities and shared contracts.

50. **R043 — [UI/UX] Refresh /payroll/work-balances**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Give an active payroll-grant holder a directory of covered employees, including former employees, for work-balance operations. Open an employee's work balance or upload opening balances from CSV.

   - Brief: R043 in the canonical spec; includes composition, preserved capabilities and shared contracts.

51. **R044 — [UI/UX] Refresh /payroll/work-balances/[employeeId]**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let a payroll-grant holder covering this employee inspect their work balance and adjustment ledger, also after employment ends. Set opening balance or record overtime payout through existing authorized controls.

   - Brief: R044 in the canonical spec; includes composition, preserved capabilities and shared contracts.

52. **R045 — [UI/UX] Refresh /personnel-files**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Give category-scoped personnel-file officers a directory of employees whose documents they manage in the active organization. Open an employee file or an existing expiry/document-request workflow.

   - Brief: R045 in the canonical spec; includes composition, preserved capabilities and shared contracts.

53. **R046 — [UI/UX] Refresh /personnel-files/[employeeId]**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an officer manage only authorized categories of the selected employee's organization personnel file. Upload a document, with edit/download/delete and linking actions available per capability.

   - Brief: R046 in the canonical spec; includes composition, preserved capabilities and shared contracts.

54. **R047 — [UI/UX] Refresh /personnel-files/document-requests**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let authorized officers track certificate/other-document requests across employees and categories they manage. Create bulk document requests or act on an eligible existing request.

   - Brief: R047 in the canonical spec; includes composition, preserved capabilities and shared contracts.

55. **R048 — [UI/UX] Refresh /personnel-files/due-for-deletion**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let authorized officers review former employees' retained documents and confirm irreversible purge within their category scope. Select documents and confirm purge after reviewing its consequence.

   - Brief: R048 in the canonical spec; includes composition, preserved capabilities and shared contracts.

56. **R049 — [UI/UX] Refresh /personnel-files/payslip-batches**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an authorized payslip officer start a batch for one pay period and inspect their existing batches. Choose month, year and visibility, then Start batch.

   - Brief: R049 in the canonical spec; includes composition, preserved capabilities and shared contracts.

57. **R050 — [UI/UX] Refresh /personnel-files/payslip-batches/[batchId]**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an authorized officer match and distribute one pay-period batch's payslip files to covered employees. Confirm employee matches and Save payslips; retry only failed files when offered.

   - Brief: R050 in the canonical spec; includes composition, preserved capabilities and shared contracts.

58. **R051 — [UI/UX] Refresh /personnel-files/sick-leave**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let sick-note-category officers review covered employees' sick-leave absences and linked sick notes for a chosen range. Open or attach/link sick notes where current file permission permits.

   - Brief: R051 in the canonical spec; includes composition, preserved capabilities and shared contracts.

59. **R052 — [UI/UX] Refresh /platform-admin**

   - Parent: G4.
   - Blocked by: F1.
   - Delivers: Survey platform-wide health and enter global administration workflows as an explicit platform administrator. Open the relevant users, organizations, diagnostics, templates or billing workspace.

   - Brief: R052 in the canonical spec; includes composition, preserved capabilities and shared contracts.

60. **R053 — [UI/UX] Refresh /platform-admin/analytics**

   - Parent: G4.
   - Blocked by: F2.
   - Delivers: Inspect platform growth, engagement, operational activity and billing trends as a platform administrator. Select the reporting range and aggregation bucket.

   - Brief: R053 in the canonical spec; includes composition, preserved capabilities and shared contracts.

61. **R054 — [UI/UX] Refresh /platform-admin/billing**

   - Parent: G4.
   - Blocked by: F2.
   - Delivers: Review platform subscriptions and seat discrepancies in billing-enabled deployments as a platform administrator. Synchronize seats for the selected organization when needed.

   - Brief: R054 in the canonical spec; includes composition, preserved capabilities and shared contracts.

62. **R055 — [UI/UX] Refresh /platform-admin/diagnostics**

   - Parent: G4.
   - Blocked by: F3.
   - Delivers: Inspect deployment configuration and service health under platform-admin authorization. Refresh diagnostics; run email or encryption tests deliberately from their own sections.

   - Brief: R055 in the canonical spec; includes composition, preserved capabilities and shared contracts.

63. **R056 — [UI/UX] Refresh /platform-admin/organizations**

   - Parent: G4.
   - Blocked by: F2, F3.
   - Delivers: Find and manage platform organizations under global administrator authority. Open the selected organization's appropriate suspension or deletion workflow.

   - Brief: R056 in the canonical spec; includes composition, preserved capabilities and shared contracts.

64. **R057 — [UI/UX] Refresh /platform-admin/settings**

   - Parent: G4.
   - Blocked by: F3.
   - Delivers: Configure global authentication-page consent behavior and perform privileged approval maintenance as a platform administrator. Save consent-script changes; keep force deletion a separate consequential operation.

   - Brief: R057 in the canonical spec; includes composition, preserved capabilities and shared contracts.

65. **R058 — [UI/UX] Refresh /platform-admin/system-email-templates**

   - Parent: G4.
   - Blocked by: F3.
   - Delivers: Maintain platform-owned billing and system email overrides under global administrator authority. Save the selected template's override.

   - Brief: R058 in the canonical spec; includes composition, preserved capabilities and shared contracts.

66. **R059 — [UI/UX] Refresh /platform-admin/users**

   - Parent: G4.
   - Blocked by: F2, F3.
   - Delivers: Find platform accounts and manage bans or sessions with explicit platform-admin authority. Inspect the selected account's sessions or apply the required ban/unban action.

   - Brief: R059 in the canonical spec; includes composition, preserved capabilities and shared contracts.

67. **R060 — [UI/UX] Refresh /platform-admin/worker-queue**

   - Parent: G4.
   - Blocked by: F2, F3.
   - Delivers: Diagnose background-job reliability and maintain supported schedules as a platform administrator. Inspect failures or edit an eligible schedule.

   - Brief: R060 in the canonical spec; includes composition, preserved capabilities and shared contracts.

68. **R061 — [UI/UX] Refresh /reports**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let an employee generate work, absence and home-office reports for an employee within their authorized report scope. Select employee/period and Generate Report, then download an existing supported format.

   - Brief: R061 in the canonical spec; includes composition, preserved capabilities and shared contracts.

69. **R062 — [UI/UX] Refresh /reports/projects**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let authorized project-report readers inspect organization project/customer results for the selected period and project status. Generate the report, then open project detail or use permitted export/share actions.

   - Brief: R062 in the canonical spec; includes composition, preserved capabilities and shared contracts.

70. **R063 — [UI/UX] Refresh /reports/vehicles**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let an authorized employee report organization-scoped driven distance by vehicle, employee and month for a selected range. Generate report, then download supported report formats.

   - Brief: R063 in the canonical spec; includes composition, preserved capabilities and shared contracts.

71. **R064 — [UI/UX] Refresh /reset-password**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Replace the account password using the supplied reset token. Save the replacement password, then continue to sign-in.

   - Brief: R064 in the canonical spec; includes composition, preserved capabilities and shared contracts.

72. **R065 — [UI/UX] Refresh /scheduling**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Give planners organization shift planning and employees their own published schedule, using organization-local shift dates. Planners create/assign/publish shifts; employees inspect shifts and use existing pickup/swap paths where offered.

   - Brief: R065 in the canonical spec; includes composition, preserved capabilities and shared contracts.

73. **R066 — [UI/UX] Refresh /settings**

   - Parent: G2.
   - Blocked by: F1.
   - Delivers: Find configuration available to the signed-in account and active organization through existing settings access. Open an available settings destination.

   - Brief: R066 in the canonical spec; includes composition, preserved capabilities and shared contracts.

74. **R068 — [UI/UX] Refresh /settings/approval-policies**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure active-organization approval policies as org admin; escalation uses its existing Approval-management capability. Create/edit an approval policy; save triage or escalation settings in their own task.

   - Brief: R068 in the canonical spec; includes composition, preserved capabilities and shared contracts.

75. **R069 — [UI/UX] Refresh /settings/audit-export**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Inspect audit activity and configure audit packages for the active organization as org admin. Generate an audit package; save configuration within its tab.

   - Brief: R069 in the canonical spec; includes composition, preserved capabilities and shared contracts.

76. **R071 — [UI/UX] Refresh /settings/avv**

   - Parent: G2.
   - Blocked by: F1.
   - Delivers: Review the active organization's AVV details as org admin when deployment billing is enabled. Download the AVV PDF when the current profile is complete.

   - Brief: R071 in the canonical spec; includes composition, preserved capabilities and shared contracts.

77. **R072 — [UI/UX] Refresh /settings/billable-time**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Maintain the active organization's Billable Time currency as org admin through existing module access. Save the billable currency when it remains changeable.

   - Brief: R072 in the canonical spec; includes composition, preserved capabilities and shared contracts.

78. **R073 — [UI/UX] Refresh /settings/billable-time/accounting**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Connect accounting and prepare customer contact links in the active organization as eligible Billable Time org admin. Save the accounting connection or edit customer accounting details.

   - Brief: R073 in the canonical spec; includes composition, preserved capabilities and shared contracts.

79. **R074 — [UI/UX] Refresh /settings/billable-time/cost-rates**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Maintain effective-dated employee cost rates in the active organization as eligible Billable Time org admin. Set a cost rate or open an employee's rate history.

   - Brief: R074 in the canonical spec; includes composition, preserved capabilities and shared contracts.

80. **R075 — [UI/UX] Refresh /settings/billable-time/hand-off**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Prepare accounting invoice drafts for one customer/period within the active organization as eligible org admin. Preview hand-off, then confirm creation of the invoice draft.

   - Brief: R075 in the canonical spec; includes composition, preserved capabilities and shared contracts.

81. **R076 — [UI/UX] Refresh /settings/billable-time/rates**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Maintain active-organization billable rates as eligible Billable Time org admin. Add or edit an effective-dated billable rate.

   - Brief: R076 in the canonical spec; includes composition, preserved capabilities and shared contracts.

82. **R077 — [UI/UX] Refresh /settings/billing**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Manage the active organization's Z8 subscription as org admin in billing-enabled deployments; owner-only actions retain their boundary. Use the existing subscription/billing-portal action appropriate to current status.

   - Brief: R077 in the canonical spec; includes composition, preserved capabilities and shared contracts.

83. **R078 — [UI/UX] Refresh /settings/calendar**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Review calendar configuration as scoped manager or higher; org admins retain organization-wide editing. Save calendar settings when authorized; managers inspect their supported read view.

   - Brief: R078 in the canonical spec; includes composition, preserved capabilities and shared contracts.

84. **R080 — [UI/UX] Refresh /settings/clocking**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Configure active-organization clocking as org admin. Save tracking, automatic clock-out, reminder or period-submission configuration in its existing section.

   - Brief: R080 in the canonical spec; includes composition, preserved capabilities and shared contracts.

85. **R082 — [UI/UX] Refresh /settings/closed-months**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Close/reopen covered employee months in the active organization with existing administrative authorization. Close a selected month, or reopen it with the required reason.

   - Brief: R082 in the canonical spec; includes composition, preserved capabilities and shared contracts.

86. **R083 — [UI/UX] Refresh /settings/compliance**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Review pending working-time exception requests for managed employees as manager/workforce admin with an employee profile. Approve an exception or reject it with a reason.

   - Brief: R083 in the canonical spec; includes composition, preserved capabilities and shared contracts.

87. **R084 — [UI/UX] Refresh /settings/compliance/works-council**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Configure privacy-safe works council access for the active organization as org admin. Save works council settings.

   - Brief: R084 in the canonical spec; includes composition, preserved capabilities and shared contracts.

88. **R086 — [UI/UX] Refresh /settings/custom-fields**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Define employee, project and customer custom fields for the active organization as org admin. Add/edit a custom field; archive through its existing confirmation.

   - Brief: R086 in the canonical spec; includes composition, preserved capabilities and shared contracts.

89. **R087 — [UI/UX] Refresh /settings/customers**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Manage customer contacts/configuration in the active organization through existing scoped-manager-or-higher access and Projects context. Add or edit a customer.

   - Brief: R087 in the canonical spec; includes composition, preserved capabilities and shared contracts.

90. **R088 — [UI/UX] Refresh /settings/demo**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Generate/clear demonstration data in the active organization as org admin when its demo-data feature is enabled. Run the existing demo-data generation wizard.

   - Brief: R088 in the canonical spec; includes composition, preserved capabilities and shared contracts.

91. **R090 — [UI/UX] Refresh /settings/driving-licence**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure active-organization driving licence control as authorized org admin. Save policy settings or manage intended-driver/verifier assignments.

   - Brief: R090 in the canonical spec; includes composition, preserved capabilities and shared contracts.

92. **R092 — [UI/UX] Refresh /settings/employees**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Administer employee/member/invitation records in the active organization within existing scoped-manager-or-higher coverage. Invite/manage an employee using the currently allowed action.

   - Brief: R092 in the canonical spec; includes composition, preserved capabilities and shared contracts.

93. **R093 — [UI/UX] Refresh /settings/employees/[employeeId]**

   - Parent: G2.
   - Blocked by: R021, R044, R046.
   - Delivers: Review/configure one organization-scoped employee within the actor's existing employee-management scope. Save an authorized employee change or enter its existing lifecycle review.

   - Brief: R093 in the canonical spec; includes composition, preserved capabilities and shared contracts.

94. **R096 — [UI/UX] Refresh /settings/enterprise/api-keys**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Manage organization-owned API keys as org admin; webhook mutations retain existing owner restrictions. Create an API key or configure a webhook in its tab.

   - Brief: R096 in the canonical spec; includes composition, preserved capabilities and shared contracts.

95. **R097 — [UI/UX] Refresh /settings/enterprise/api-keys/[keyId]**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Inspect/configure one API key belonging to the active organization as authorized org admin. Save key configuration or revoke the key through its existing confirmation.

   - Brief: R097 in the canonical spec; includes composition, preserved capabilities and shared contracts.

96. **R100 — [UI/UX] Refresh /settings/enterprise/domains**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure active-organization domains and branding as org admin. Add/verify a custom domain or save branding in its existing task.

   - Brief: R100 in the canonical spec; includes composition, preserved capabilities and shared contracts.

97. **R101 — [UI/UX] Refresh /settings/enterprise/email**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Configure email delivery and organization email overrides as active-organization org admin. Save delivery configuration or an email override.

   - Brief: R101 in the canonical spec; includes composition, preserved capabilities and shared contracts.

98. **R102 — [UI/UX] Refresh /settings/enterprise/identity-setup**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure organization identity as active-organization org admin through existing provider/provisioning policy boundaries. Complete identity setup or save the selected SSO, social-login or local-MFA task.

   - Brief: R102 in the canonical spec; includes composition, preserved capabilities and shared contracts.

99. **R104 — [UI/UX] Refresh /settings/equipment**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure active-organization equipment tracking and officer grants as org admin under existing feature availability. Add/edit an equipment type/item, or update an officer grant.

   - Brief: R104 in the canonical spec; includes composition, preserved capabilities and shared contracts.

100. **R105 — [UI/UX] Refresh /settings/export**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Request/inspect organization-wide data exports for the active organization as org admin. Request an organization data export.

   - Brief: R105 in the canonical spec; includes composition, preserved capabilities and shared contracts.

101. **R106 — [UI/UX] Refresh /settings/export-operations**

   - Parent: G2.
   - Blocked by: F2.
   - Delivers: Inspect active-organization export health and delivery visibility as org admin. Open the existing settings destination associated with an alert or run.

   - Brief: R106 in the canonical spec; includes composition, preserved capabilities and shared contracts.

102. **R107 — [UI/UX] Refresh /settings/export/history/[organizationId]**

   - Parent: G2.
   - Blocked by: R105.
   - Delivers: Arrive at organization-addressed export history while retaining active-organization and org-admin authorization. Switch to the addressed organization when the existing arrival card requires it, then use authorized export actions.

   - Brief: R107 in the canonical spec; includes composition, preserved capabilities and shared contracts.

103. **R109 — [UI/UX] Refresh /settings/implementation-checklist**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Assess/rehearse go-live setup for the active organization as org admin. Run an existing go-live rehearsal or open the setup task needing attention.

   - Brief: R109 in the canonical spec; includes composition, preserved capabilities and shared contracts.

104. **R110 — [UI/UX] Refresh /settings/import**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Select an import source and configure a reviewed import for the active organization as org admin. Start the selected existing import setup.

   - Brief: R110 in the canonical spec; includes composition, preserved capabilities and shared contracts.

105. **R111 — [UI/UX] Refresh /settings/import/[batchId]**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review one active-organization import batch as org admin, using its existing source-specific workflow. Resolve review issues and commit eligible rows when the batch permits it.

   - Brief: R111 in the canonical spec; includes composition, preserved capabilities and shared contracts.

106. **R112 — [UI/UX] Refresh /settings/kiosks**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Administer shared devices enrolled to active-organization locations as org admin. Create a kiosk or issue its pairing code.

   - Brief: R112 in the canonical spec; includes composition, preserved capabilities and shared contracts.

107. **R113 — [UI/UX] Refresh /settings/locations**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review active-organization locations/subareas as scoped manager or higher; org admins retain management controls. Add/edit a location when authorized, or open its detail.

   - Brief: R113 in the canonical spec; includes composition, preserved capabilities and shared contracts.

108. **R114 — [UI/UX] Refresh /settings/locations/[locationId]**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review one active-organization location/subareas within existing manager scope; org admins retain editing. Edit location details or add/edit a subarea when authorized.

   - Brief: R114 in the canonical spec; includes composition, preserved capabilities and shared contracts.

109. **R115 — [UI/UX] Refresh /settings/my-data**

   - Parent: G2.
   - Blocked by: F2.
   - Delivers: Request the signed-in employee's personal data held by the active organization through existing member eligibility. Request an employee personal data export.

   - Brief: R115 in the canonical spec; includes composition, preserved capabilities and shared contracts.

110. **R116 — [UI/UX] Refresh /settings/notification-channels**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Configure organization notification channels as active-organization org admin. Save/test the selected channel's existing configuration.

   - Brief: R116 in the canonical spec; includes composition, preserved capabilities and shared contracts.

111. **R117 — [UI/UX] Refresh /settings/notifications**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Configure the signed-in user's personal notification preferences through existing account/organization boundaries. Update an existing notification preference.

   - Brief: R117 in the canonical spec; includes composition, preserved capabilities and shared contracts.

112. **R118 — [UI/UX] Refresh /settings/organization**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Administer active-organization identity/membership as org admin; owner-reserved changes retain their boundary. Save authorized organization configuration or use an existing membership action.

   - Brief: R118 in the canonical spec; includes composition, preserved capabilities and shared contracts.

113. **R120 — [UI/UX] Refresh /settings/payroll-access**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Administer payroll-officer grants in the active organization as org admin with existing payroll-access administration authorization. Add/update a payroll-access grant.

   - Brief: R120 in the canonical spec; includes composition, preserved capabilities and shared contracts.

114. **R121 — [UI/UX] Refresh /settings/payroll-export**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure payroll targets and prepare exports for the active organization as org admin. Generate/deliver the selected payroll export, or save its target configuration.

   - Brief: R121 in the canonical spec; includes composition, preserved capabilities and shared contracts.

115. **R122 — [UI/UX] Refresh /settings/payroll-readiness**

   - Parent: G2.
   - Blocked by: F2.
   - Delivers: Inspect payroll setup/readiness for the active organization and selected period as org admin. Open the existing remediation destination for a failed check.

   - Brief: R122 in the canonical spec; includes composition, preserved capabilities and shared contracts.

116. **R123 — [UI/UX] Refresh /settings/permissions**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review employee permissions in the active organization as scoped manager or higher; management actions retain existing administrative boundaries. Inspect/change an employee's permitted role/scope using the existing authorized action.

   - Brief: R123 in the canonical spec; includes composition, preserved capabilities and shared contracts.

117. **R124 — [UI/UX] Refresh /settings/personnel-files**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure active-organization personnel files as org admin while the feature is available. Manage personnel-file officer grants or save reminders/retention in their task.

   - Brief: R124 in the canonical spec; includes composition, preserved capabilities and shared contracts.

118. **R125 — [UI/UX] Refresh /settings/position-capture**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure active-organization position capture as org admin. Save capture settings or its existing assignments/notice task.

   - Brief: R125 in the canonical spec; includes composition, preserved capabilities and shared contracts.

119. **R126 — [UI/UX] Refresh /settings/position-stamps**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review one's own clock-event position stamps and consent within the active organization. Agree to the current position notice or withdraw consent using existing actions.

   - Brief: R126 in the canonical spec; includes composition, preserved capabilities and shared contracts.

120. **R127 — [UI/UX] Refresh /settings/profile**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Edit the signed-in account's profile/display preferences; organization-specific custom fields/skills retain their own read boundary. Save profile changes or update an existing display preference.

   - Brief: R127 in the canonical spec; includes composition, preserved capabilities and shared contracts.

121. **R128 — [UI/UX] Refresh /settings/projects**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Manage organization projects within existing scope; project managers below manager settings access retain the tasks-only view. Create/edit a project, or manage tasks where that is the actor's available task.

   - Brief: R128 in the canonical spec; includes composition, preserved capabilities and shared contracts.

122. **R129 — [UI/UX] Refresh /settings/report-share-links**

   - Parent: G2.
   - Blocked by: F2.
   - Delivers: Manage frozen report share links belonging to the active organization as org admin. Revoke an existing report share link using its current action.

   - Brief: R129 in the canonical spec; includes composition, preserved capabilities and shared contracts.

123. **R130 — [UI/UX] Refresh /settings/roles**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Manage custom organization roles in the active organization as org admin. Create/edit a custom role.

   - Brief: R130 in the canonical spec; includes composition, preserved capabilities and shared contracts.

124. **R131 — [UI/UX] Refresh /settings/scheduled-exports**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Schedule payroll, data or audit exports for the active organization as org admin. Create/edit a scheduled export through its existing multistep setup.

   - Brief: R131 in the canonical spec; includes composition, preserved capabilities and shared contracts.

125. **R132 — [UI/UX] Refresh /settings/security**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Manage signed-in account security; organization-specific kiosk credentials and MFA requirements retain existing scope. Change password, enroll a factor/passkey or revoke a session using the selected existing task.

   - Brief: R132 in the canonical spec; includes composition, preserved capabilities and shared contracts.

126. **R133 — [UI/UX] Refresh /settings/shifts**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure shift templates/coverage within existing scheduling-settings team/subarea capabilities. Create/edit a shift template or coverage rule when authorized.

   - Brief: R133 in the canonical spec; includes composition, preserved capabilities and shared contracts.

127. **R134 — [UI/UX] Refresh /settings/skills**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review the active organization's skill catalog as scoped manager or higher; org admins retain catalog/reminder management. Add/edit a catalog skill when authorized or inspect qualifications.

   - Brief: R134 in the canonical spec; includes composition, preserved capabilities and shared contracts.

128. **R136 — [UI/UX] Refresh /settings/statistics**

   - Parent: G2.
   - Blocked by: F1.
   - Delivers: Inspect organization statistics or existing managed-scope statistics as scoped manager or higher. Read available statistics; retain shared refresh without adding a settings save.

   - Brief: R136 in the canonical spec; includes composition, preserved capabilities and shared contracts.

129. **R137 — [UI/UX] Refresh /settings/surcharges**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review surcharge models/assignments for the active organization as scoped manager or higher; org admins retain management. Create/edit a surcharge model or permitted assignment.

   - Brief: R137 in the canonical spec; includes composition, preserved capabilities and shared contracts.

130. **R138 — [UI/UX] Refresh /settings/teams**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review/administer active-organization teams within existing scoped-manager-or-higher team-management coverage. Create a team when authorized or open/manage an existing team.

   - Brief: R138 in the canonical spec; includes composition, preserved capabilities and shared contracts.

131. **R140 — [UI/UX] Refresh /settings/teams/[teamId]**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review one active-organization team's members/configuration as authorized team reader/operator. Save an authorized team change or manage members using existing actions.

   - Brief: R140 in the canonical spec; includes composition, preserved capabilities and shared contracts.

132. **R142 — [UI/UX] Refresh /settings/travel-expenses**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure expense policy/officer coverage for the active organization as org admin. Save the selected existing expense-policy, currency, reimbursement or officer task.

   - Brief: R142 in the canonical spec; includes composition, preserved capabilities and shared contracts.

133. **R143 — [UI/UX] Refresh /settings/vacation**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review absence categories, vacation policies/assignments and holidays in the active organization within existing manager access; org admins manage policies. Create/edit an authorized category, policy or assignment.

   - Brief: R143 in the canonical spec; includes composition, preserved capabilities and shared contracts.

134. **R144 — [UI/UX] Refresh /settings/vacation/employees**

   - Parent: G2.
   - Blocked by: F2.
   - Delivers: Review active-organization employee vacation allowances as org admin. Open an employee's allowance editor for the selected year.

   - Brief: R144 in the canonical spec; includes composition, preserved capabilities and shared contracts.

135. **R145 — [UI/UX] Refresh /settings/vacation/employees/[employeeId]**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Edit one organization-scoped employee's annual vacation allowance under existing allowance-administration authorization. Save allowance changes or record an authorized vacation adjustment.

   - Brief: R145 in the canonical spec; includes composition, preserved capabilities and shared contracts.

136. **R147 — [UI/UX] Refresh /settings/vehicles**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Configure active-organization vehicles and vehicle-use assignments as org admin. Add/edit a vehicle or save vehicle-use configuration.

   - Brief: R147 in the canonical spec; includes composition, preserved capabilities and shared contracts.

137. **R149 — [UI/UX] Refresh /settings/wellness**

   - Parent: G2.
   - Blocked by: F3.
   - Delivers: Configure the signed-in user's water reminders/hydration preferences through existing personal-settings persistence. Save wellness settings.

   - Brief: R149 in the canonical spec; includes composition, preserved capabilities and shared contracts.

138. **R150 — [UI/UX] Refresh /settings/work-categories**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review work categories/sets in the active organization as scoped manager or higher; org admins retain management. Create/edit a category, category set or authorized assignment.

   - Brief: R150 in the canonical spec; includes composition, preserved capabilities and shared contracts.

139. **R151 — [UI/UX] Refresh /settings/work-diagnostics**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Inspect missing/conflicting active-organization work records as org admin, within selected employee/period. Review/apply an eligible existing repair or work proposal.

   - Brief: R151 in the canonical spec; includes composition, preserved capabilities and shared contracts.

140. **R152 — [UI/UX] Refresh /settings/work-policies**

   - Parent: G2.
   - Blocked by: F2, F3.
   - Delivers: Review work schedules, limits, breaks and change policies in the active organization within existing manager scope; org admins retain policy management. Create/edit an authorized work or change policy/assignment.

   - Brief: R152 in the canonical spec; includes composition, preserved capabilities and shared contracts.

141. **R153 — [UI/UX] Refresh /setup**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Bootstrap the first platform administrator using temporary operator authorization. Create the administrator, then continue to sign-in.

   - Brief: R153 in the canonical spec; includes composition, preserved capabilities and shared contracts.

142. **R154 — [UI/UX] Refresh /share/[token]**

   - Parent: G3.
   - Blocked by: F2.
   - Delivers: Read a frozen, redacted project-report snapshot through its secret share URL. Read or download that same snapshot as PDF, CSV or Excel.

   - Brief: R154 in the canonical spec; includes composition, preserved capabilities and shared contracts.

143. **R155 — [UI/UX] Refresh /sign-in**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Authenticate on the current domain and continue to the intended destination. Use an allowed sign-in method; store-shell visitors continue through the system-browser handoff.

   - Brief: R155 in the canonical spec; includes composition, preserved capabilities and shared contracts.

144. **R156 — [UI/UX] Refresh /sign-up**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Create an account under the deployment and domain signup policy, including invitation arrivals. Create the account using the existing form.

   - Brief: R156 in the canonical spec; includes composition, preserved capabilities and shared contracts.

145. **R157 — [UI/UX] Refresh /team**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let managers and workforce admins inspect the employees their management scope covers in the active organization. Open an employee's existing destination or inspect balance-adjustment history.

   - Brief: R157 in the canonical spec; includes composition, preserved capabilities and shared contracts.

146. **R158 — [UI/UX] Refresh /team/absences**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let managers and workforce admins review managed employees' annual absence allowances and absence calendar. Record an approved absence for an eligible employee through the existing flow.

   - Brief: R158 in the canonical spec; includes composition, preserved capabilities and shared contracts.

147. **R159 — [UI/UX] Refresh /team/driving**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let organization owners/admins or scoped managers find recorded work missing expected driving details. Open that employee's calendar to complete the existing work-period attribution.

   - Brief: R159 in the canonical spec; includes composition, preserved capabilities and shared contracts.

148. **R160 — [UI/UX] Refresh /team/period-submissions**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let organization owners/admins or scoped managers inspect expected employee submissions for a selected organization cadence period. Open an employee calendar or the approval inbox; decisions stay in the inbox.

   - Brief: R160 in the canonical spec; includes composition, preserved capabilities and shared contracts.

149. **R161 — [UI/UX] Refresh /team/presence**

   - Parent: G1.
   - Blocked by: F1.
   - Delivers: Let an authorized organization presence reader choose among active locations to inspect current clocked-in or break presence. Open a location's existing presence view.

   - Brief: R161 in the canonical spec; includes composition, preserved capabilities and shared contracts.

150. **R162 — [UI/UX] Refresh /team/presence/[locationId]**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Show an authorized reader employees assigned to this organization location who are currently clocked in or on break. View presence and follow existing employee links; return to All locations when needed.

   - Brief: R162 in the canonical spec; includes composition, preserved capabilities and shared contracts.

151. **R163 — [UI/UX] Verify time-tracking conformance (/time-tracking)**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an employee clock and review their own organization work in the selected employee-local day/week. Use the current clock action or existing manual-entry/correction flow.

   - Brief: R163 in the canonical spec; includes composition, preserved capabilities and shared contracts.

152. **R164 — [UI/UX] Refresh /today**

   - Parent: G1.
   - Blocked by: F3.
   - Delivers: Give managers and workforce admins today's briefing for the employees and organization they may oversee. Follow an urgent item's workflow link or use its approval action where authorized.

   - Brief: R164 in the canonical spec; includes composition, preserved capabilities and shared contracts.

153. **R165 — [UI/UX] Refresh /travel-expenses**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let an employee collect personal trip/standalone expenses and follow their review and reimbursement in their organization. Create a receipt expense, mileage expense or trip report through existing controls.

   - Brief: R165 in the canonical spec; includes composition, preserved capabilities and shared contracts.

154. **R166 — [UI/UX] Refresh /travel-expenses/[claimId]**

   - Parent: G1.
   - Blocked by: F3.
   - Delivers: Let an authorized employee or legacy-claim reader inspect one claim's retained organization evidence. View/download receipts; use legacy-draft conversion or settlement only when currently offered.

   - Brief: R166 in the canonical spec; includes composition, preserved capabilities and shared contracts.

155. **R167 — [UI/UX] Refresh /travel-expenses/finance**

   - Parent: G1.
   - Blocked by: F2, F3.
   - Delivers: Let expense finance actors handle approved reports within approval-time employee/team snapshot scope, with separate read/settle/export capabilities. Record actual reimbursement where permitted; retain exports and payroll-payment confirmation as distinct workflows.

   - Brief: R167 in the canonical spec; includes composition, preserved capabilities and shared contracts.

156. **R168 — [UI/UX] Refresh /travel-expenses/reports/[reportId]**

   - Parent: G1.
   - Blocked by: F3.
   - Delivers: Let the authorized owner edit a current expense draft, while reviewers/finance and earlier cycles read the appropriate frozen submission. Save/submit the editable report; otherwise view evidence or use only returned lifecycle/settlement actions.

   - Brief: R168 in the canonical spec; includes composition, preserved capabilities and shared contracts.

157. **R169 — [UI/UX] Refresh /verify-2fa**

   - Parent: G3.
   - Blocked by: F3.
   - Delivers: Complete the second factor for a pending sign-in using its temporary authentication state. Verify an authenticator code or backup code.

   - Brief: R169 in the canonical spec; includes composition, preserved capabilities and shared contracts.

158. **R170 — [UI/UX] Refresh /verify-email**

   - Parent: G3.
   - Blocked by: F1.
   - Delivers: Verify the current email token and resolve the appropriate next step. Continue to onboarding, the pending invitation or sign-in after successful verification.

   - Brief: R170 in the canonical spec; includes composition, preserved capabilities and shared contracts.

159. **R171 — [UI/UX] Refresh /verify-email-pending**

   - Parent: G3.
   - Blocked by: F1.
   - Delivers: Explain the pending verification step and help the account holder obtain another email. Resend the verification email.

   - Brief: R171 in the canonical spec; includes composition, preserved capabilities and shared contracts.

160. **R172 — [UI/UX] Refresh /works-council**

   - Parent: G1.
   - Blocked by: F2.
   - Delivers: Let an authorized works-council reader review privacy-filtered organization workforce changes for the selected UTC date range. Update the range or export the existing review pack.

   - Brief: R172 in the canonical spec; includes composition, preserved capabilities and shared contracts.

## Draft verification

On 14 November 2026, source enumeration matched all 172 unique page templates to 153 unique briefs and 19 destination-owned aliases. All briefs have the five agreed fields. All 160 proposed issue IDs are unique; group counts match the inventory and remain within the approved hierarchy. The 232 planned blocking edges, including the existing #1689 prerequisite, form an acyclic graph; all seven route handoffs are source-proven. Markdown and scratch publication data agree.

All 159 local document links across the six discovery/spec documents resolved. Root foundation and grouping manifests passed the repository publisher's dry run; page batches must receive actual group numbers and pass their own dry runs before publication. Independent reviews found no remaining concrete preservation or graph blockers after clarifying contract-only references and adding in-flight tenant/permission verification.

This verifies the documentation and proposed rollout, not the future application changes. The user subsequently approved the concrete spec, test boundaries and breakdown. Native issue publication/read-back is the next step. No route code was changed and no subordinate issues were published in this phase.
