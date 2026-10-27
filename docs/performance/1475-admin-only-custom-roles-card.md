# Proposed shared employee custom-role card correction (#1475)

The employee detail view mounts `EmployeeCustomRolesCard` for manager viewers even though its initial `getEmployeeCustomRoles` query requires an organization administrator. The card's existing `isAdmin` prop controls its management UI; it does not prevent that initial query. The existing server action's organization-scoped admin check is correct and remains unchanged.

Root identified the actual failing action from the original compiled action manifest. Its39-byte error hashes to `934a518242bf06d526e74d925380765177289ffca3e85ae9c61d5a0a5cf42dd6`. A fresh manager first-document reproduction at tooling source `4dbe301a5` retained two failures. Source-only identity receipt: `4dbe301a5-actual-route-and-manager-identities-v1.json`, SHA256 `cfbd361fb1b91341a951566d1005bfacca454b01bde4a5b66fc1e0cdf735852d`. This patch does not requalify that failed capture or claim a runtime fix before a new actual observation.

## Exact proposed hunk for BOTH source trees

File: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`. Root's existing block is at484–488; the original's identical block is at393–397. Both already derive `isOrgAdmin` from `accessTier === "orgAdmin"`.

```diff
- <EmployeeCustomRolesCard
-   employeeId={employeeId}
-   organizationId={employee.organizationId}
-   isAdmin={isOrgAdmin}
- />
+ {isOrgAdmin && (
+   <EmployeeCustomRolesCard
+     employeeId={employeeId}
+     organizationId={employee.organizationId}
+     isAdmin={isOrgAdmin}
+   />
+ )}
```

This only prevents an unauthorized component mount and its automatic query. It adds no permission, changes no server action/query, and preserves the existing employee/organization props. Admin and owner views keep the card. No forms, schemas, fixture workload, observer predicates, budget factors or deadlines change.

## Rendered regression evidence and admission boundary

The existing employee-detail React suite now renders a visible boundary stub for this card. Manager/member tests assert it is absent from the DOM, including hidden content; admin/owner tests assert it mounts with the original employee/organization scope and admin prop. Before the production hunk, both nonadmin tests failed and both admin controls passed. After it, all38 tests in the existing suite passed. These are rendered component tests, not source-string assertions or real server requests.

The proposed hunk is applied only to the owned feature branch for concrete review. **The original source/binary has not been changed.** Root will request explicit approval before applying the same correction to original business source, rebuilding both fixtures and performing fresh strict checks. Old failures remain preserved. Full clean baseline and performance acceptance remain unfulfilled.

## Optimized build checkpoint

The optimized `05cd9e40c38a3dd8c49d41a621999543a9a64e17` CI build passed: 3,263 pages, approximately 438s total and 27s TypeScript. The build record SHA256 is `7385aad6364e6ad801e4e846e63f086d90e3892b05482f6b64dd3e1ca1be0f24`; required manifest SHA256 is `698e2d7436f8b6f835ebff1e0f2d5e34897924e79a536c9023eca4dfe00a7314`. The original and optimized four public source files still match the qualified source set `56f3ec331084d91e18861e328f0d95dd3c3587c75c02a5920a563dca69c1e86b`, recorded in receipt `40e3d9df523f392f02662464c9d996af8270e6adfe05e1ffe963b8e37e52f911`.

Shared-original approval is still pending and the guard has not been ported to the original. This build result establishes neither fresh runtime verification nor performance acceptance.
