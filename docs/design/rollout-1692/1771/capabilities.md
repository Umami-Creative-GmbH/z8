# R092 inventory before implementation

Source: `11cdba0d2bfcc84c31fa1ef0f2acdf04a96300d9`. Inventory recorded before source edits.

| Existing capability / state | Owner and authorization | Final location |
| --- | --- | --- |
| Employee, member, invitation, invite-code categories | Page; people loaded only for server-resolved orgAdmin+ | Category navigation, preserved |
| Employee search (name/email/position), role, current/former/draft/all | `useEmployees`, scoped GET reader; current includes invitation drafts | Shared F2 toolbar, same values and debounce |
| Page index/size, previous/next, name sorting | Existing query/manual pagination and TanStack local sort | Directory footer and identity heading, preserved |
| Identity, pronouns, avatar/presence, kiosk email label, missing required values | Columns, canonical GET projection and clock-status reader | Directory identity column, wrapping rather than truncation |
| Personnel number, position, team, role, contract, current/former since/draft invitation state | Canonical employee reader and `StatusCell` | All directory columns retained, stacked phone labels |
| Employee/draft full detail | `ViewDetailsCell`, encoded draft ID | Same canonical detail links; R094 alias untouched |
| Deactivate/reactivate/remove access and previews/replacement managers | `EmployeeLifecycleActions`, server/object/owner/release gates | Existing row controls, unchanged |
| Employment-date import and opening-balance upload | Existing authorized dialogs/actions | Header secondary actions, preserved |
| Members: search, role badge/change, lifecycle, refresh | `MembersTable`; owner checks and current actor | Members category, unchanged owner |
| Invitations: search, email/role/status/expiry/inviter/target team; edit team/resend/cancel | `MembersTable`, canonical organization actions | Invitations category, unchanged owner |
| Pending member approval/rejection, team placement | `PendingMembersCard`, canonical joining/approval | Invitations category, unchanged owner |
| Invite email/role/organization-creation preference/team; kiosk first/last/location | `InviteMemberDialog`, TanStack, canonical invite/kiosk actions | Existing F3 panel, primary header action and invitations action |
| Invite-code create/list/copy/QR/edit/delete/usage/expiry/team/approval | `InviteCodeManagement` | Invite Codes category, unchanged owner |
| Read pending/error/retry/no employee/empty/no match | Query/provider plus route | Honest directory feedback; no zero-result claim during failed reads |
| Header Refresh, theme, timezone, text-size, navigation state/shortcut | F1 shell/preference owners | Preserved; local drafts survive refresh |

## Actual production consumers and frozen boundaries

`EmployeesPageClient` is only consumed by this route's page. `createEmployeeColumns` is only
consumed by this client; `StatusCell` and `ViewDetailsCell` only by those columns.
`MembersTable`, `PendingMembersCard`, `InviteCodeManagement`, and `InviteMemberDialog` currently
have this client as their production caller. They remain frozen shared owners despite that count.
`EmployeeLifecycleActions` also serves the selected employee and membership table.
Imports/editors, actions, queries, canonical settings access, joining, SCIM, roster, terms,
offboarding, approval and record writers remain unchanged.

Queued #1772 `72e90d0f05eb793f5efe236a61d1cb804fed52ba` changes only descendant employee detail
source plus shared route metadata. Do not merge it. R092 may add only the exact metadata literal
after an assembled duplicate-heading regression; descendant headings remain excluded here.

## Composition intent

An administrator locates a person, distinguishes membership from employment/invitation, then
opens an authorized task. Domain: current roster, former employee, invitation draft, membership,
team placement, kiosk identity. Existing blue focus/action tokens, neutral surfaces, muted metadata,
semantic former/draft badges and dark surfaces provide the color world. The signature is identity
beside canonical employment status, with separate access categories. One working directory replaces
dashboard summary tiles; category navigation replaces unrelated cards; wrapping identity and phone
labels replace clipped table content. Existing font, icons and spacing tokens remain authoritative.

## Agreed public test seams

The brief preauthorizes the real provider/QueryClient/ViewRefresh/header and route/panel seams,
substituting only session/navigation/fetch/action boundaries. These catch visible state retention,
scope retirement, duplicate headings and actual form dispatch. Canonical PostgreSQL suites cover
server access/roster/lifecycle independently. They do not prove provider delivery or full browser
acceptance. No new test seam requires approval.
