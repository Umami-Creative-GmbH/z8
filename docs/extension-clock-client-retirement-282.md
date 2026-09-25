# Browser extension clock client: retired (#282 / T18)

## Decision

On 2026-09-25 the user decided that the browser extension is discontinued. No
extension client adopts the version 2 frozen clock commands from #275.
[#282](https://github.com/Umami-Creative-GmbH/z8/issues/282) closes as not planned.
This record keeps its obligations traceable under
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264) and the canonical
resolutions of [#263](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636)
and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
#259 asks that every retained entry point record participation or effective
disable/retirement evidence.

Basis:

- `4722f938` (2026-09-10, "chore: remove mobile and browser extension apps")
  removed `apps/extension`. The last source exists only in history
  (`4722f938^:apps/extension/…`).
- No repository workflow builds or publishes the extension. The extension IDs,
  store/unpacked channels and publisher are unknown (C266-E in
  [the #266 register](audits/266-client-preservation-controls.md)).
- #282 requires the verified source/build from the deployment dossier. None exists
  to adopt.

## What retirement does not do

Removing the source does not remove installed extensions. Installed X1–X3 readers
(see the #266 cohort table) keep running. They keep the user's cookies and post
legacy bodies to `POST /api/time-entries` from a `chrome-extension://` origin every
minute. They are **old consumers, not supported clients**. Retirement removes the
adoption work. It does not remove the old-consumer control that #259/#263 require
before stricter admission.

Other effects:

- The extension never sends version 2 commands. Its rows never get a receipt,
  lookup recovery or a context binding (account, organization, server).
- Unpublishing a store listing does not uninstall existing copies, and unpacked
  copies never update. There is no in-source updater, remote config or kill switch,
  so the server cannot disable an installed reader.
- Uninstalling the extension clears `chrome.storage.local`, including queued rows
  in `actionQueue`. Disabling it keeps them. Any "please uninstall" guidance
  therefore destroys unsynced work unless the queue was recovered first.

## Retained entry points

| Entry point | State after retirement | Disposition |
| --- | --- | --- |
| `POST /api/time-entries` from an extension origin (X1–X3) | Legacy writer. It does not participate in the adopted work operations. | #327: drain or gate before an organization adopts. |
| `legacy-extension-queue` fence (`apps/webapp/src/app/api/time-entries/legacy-consumer-fence.ts`) | Stays. It rewrites 400 to 409 so X1–X3 keep the row. | Retire it only when the inventory shows no extension reader remains. #282 no longer adds a cookie client that it would misclassify. Any rollback release must keep it (#331). |
| `GET /api/extension/projects` | Read-only project list for the popup. It has no effect on queued rows. | Keep while installed readers exist. Removal is harmless to rows and belongs with the #329 communication decision. |
| User guide `apps/docs/content/docs/guide/user-guide/browser-extension.mdx` and the `extension` entry in `apps/docs/content/docs/tech/technical/index.mdx` | Still describe installing the extension and its offline sync. | Replace them with retirement guidance in the same #329 step that decides queue recovery, so the guidance does not send users to uninstall before recovery. |

## Items moved to the activation tickets

**#329 (old-consumer control and pilot):**

- The inventory of installed extensions: IDs and channels (for example from the
  `Origin` of legacy requests in server logs), cohorts, and the servers they post to.
- Store delisting, or confirmation that no listing exists.
- Held rows: fenced rows stay at the head of an extension queue with no recovery UI.
  Decide between an explicit acceptance of loss and a recovery path before telling
  users to uninstall.
- Residual path 5: X1 still deletes on 401 (expired session).
- User-facing retirement communication and the docs replacement above.
- Proof, or an explicit acceptance decision, that installed readers cannot
  destructively process unresolved rows before stricter admission. This was #282's
  "effective old-consumer update/disable evidence" criterion.

**#327 (writers and drain):** legacy extension-origin writes are a non-participating
writer for adopted organizations.

**#331 (rollback):** there is no extension adapter to roll back. The fence must stay
in every rollback target.

## Acceptance criteria of #282

| Criterion | Disposition |
| --- | --- |
| Implement in the verified source/build and record protocol/build evidence | Not applicable: no source/build exists and none will. |
| Persist the frozen command before send, with its binding | Not applicable: there is no extension client. |
| Negotiated submit/lookup, receipt before removal, pause without downgrade | Not applicable. The #275 routes stay available to other clients. |
| Interrupted migration, context changes, crash windows; old-consumer update/disable evidence | Migration and crash cases: not applicable. Old-consumer evidence moved to #329. |
| Canonical scenarios through the real boundary | Not applicable to a retired client. The fence's route tests and the Chromium extension-origin probe from #266 still cover installed readers. |

## Verification

This change is documentation plus one source comment. No tests, builds, database
operations, deployment or activation ran.
