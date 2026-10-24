# Dashboard optional load and saved layouts

Issue [#1460](https://github.com/Umami-Creative-GmbH/z8/issues/1460), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

An explicit saved layout now keeps its visible order and hidden choices. IDs
omitted by an older layout are appended to its customization catalog as hidden,
so shipping a new optional widget does not silently make it visible. An explicit
empty order remains empty. Normalization removes unknown and duplicate IDs without
writing preferences merely because a user visits the Dashboard.

Users without a saved layout, and users who choose Reset layout, receive eligible
defaults in catalog order. The server delivers a display-only availability list
alongside layout settings, reusing render organization settings and water
preferences. The public layout GET checks current organization flags and user
settings after fresh authorization. Known-disabled shifts and hydration do not
mount or start widget data reads. Employee defaults omit Manager Today and
Organization, matching those readers' existing role restrictions. Managed Employees
and Pending Approvals retain their authoritative manager-link, grant and deputy
readers: an employee role alone cannot prove these regions unavailable.

Temporary ineligibility masks a saved widget without deleting the preference. The
customization row remains discoverable, unchecked and disabled while unavailable.
Eligibility is updated in the shared cache even while a layout save is pending;
the pending order/visibility edit survives. Reordering excludes unavailable slots
from the visible queue without moving their stored positions. Reset remains an
explicit command, and hidden widgets continue not to mount.

## Why these two regions defer

The original production fixture geometry capture (`a8bf74fec`, original source
`39a08d0bb`) recorded Birthday Reminders at top 2445 on 390×844 mobile and 993 on
1280×900 desktop at primary readiness. Hydration was at 2673 and 1221. Both were
below those viewports. The parent retained the capture in
`dashboard-original-widget-geometry.json` outside the checkout.

Upcoming Time Off (desktop top 537) and Recently Approved (765) were visible or
partly visible, so their server reads remain eager. Empty optional widgets caused
masonry reflow in the original capture; the implementation does not assume that an
initially offscreen region stays there.

Only Birthday Reminders and Hydration use the deferred slot. Their server markup
contains a titled, keyboard-accessible placeholder with a 208px minimum height.
No dataset read or widget-module import starts for an offscreen, untouched slot.
IntersectionObserver with zero root margin activates it when it actually enters
the viewport, including after layout movement. Focusing the placeholder or its
Load button activates immediately. Focus moves to the persistent labeled region
before its button is replaced, with preventScroll. If IntersectionObserver is
unavailable, hydration activates the content rather than leaving an unusable card.

The two widget modules use separate lazy imports; their static imports were
removed from the grid and server-slot modules. Once activated, the widget starts
one freshly authorized scoped GET. It uses the existing loading/error/retry UI and
mutation behavior. Its query explicitly participates in the client refresh owner;
the RSC render never starts a competing data read for these two slots. The other
twelve widget types retain independent RSC reads. Compact/header clock ownership
and reads are unchanged.

## Verification evidence

- RED: a real layout-hook caller with a one-widget saved layout displayed all
  fourteen IDs. GREEN: only its explicit widget is visible; optional IDs can be
  enabled through customization. Separate cases cover empty and partial layouts,
  reset defaults, eligibility reduction/restoration and a pending layout command.
- Actual header customization, SectionCards and QueryClient show an omitted
  Hydration row unchecked; enabling produces its placeholder, hiding unmounts it,
  no dataset GET occurs while it stays offscreen, and an unsaved input survives.
- Actual deferred widgets, QueryClient and fetch prove no offscreen read; viewport
  and keyboard activation each perform one Hydration GET. Keyboard focus remains
  in its labeled region. A held birthday GET leaves a completed sibling usable;
  failure and local retry touch only birthdays and preserve an unsaved input.
- Actual ViewRefreshProvider/header refresh produces exactly one additional GET
  for activated hydration while the eager vacation delivery waits for its RSC
  merge. It retains the draft and invokes one router refresh.
- Server streaming checks retain all eager sibling completion orders and prove
  primary content plus deferred placeholders without eager birthday/hydration
  data reads. Existing public GET scope-denial tests remain in the passing suite.
- 27 unit files / 189 cases pass across Dashboard, SectionCards, refresh provider
  and Dashboard API routes. Three PostgreSQL suites / 28 cases pass: personal
  widget reads, Quick Stats tracking and team/approval reads. The new layout
  reader case proves role/feature defaults, explicit-empty preference preservation,
  narrow JSON scope and disabled hydration/shifts. Existing manager/approval and
  personal correctness cases remain green. Fixtures use unique tenants and their
  existing cascade cleanup; no schema reset, migration or service changes.
- Phase Development typecheck passes all configured projects. Changed source/test
  Biome checks pass. React Doctor delta from `e0298000b` reports 93/100 with no
  issues; no rule suppression or configuration change was added.

## Production browser and resource checks still required

The parent owns the original and candidate production services and controlled
mobile/desktop measurement runs. This commit does not claim a transferred-byte,
request or timing improvement before those runs. Primary readiness selectors stay
unchanged. For the new behavior, observe
`[data-dashboard-deferred-id="birthday-reminders"][data-state="deferred"]` and
its `hydration` equivalent; unavailable or saved-hidden widgets have neither
placeholder nor mounted widget. An activated region changes `data-state` to
`active`. Initial in-viewport positions may activate immediately; movement into
view must also activate. Use the accessible Load Upcoming Birthdays and Load
Hydration controls to verify keyboard intent.

Before activation, expect no `/api/dashboard/widgets/birthday-reminders` or
`/api/dashboard/widgets/hydration` dataset GET and no corresponding reader work
in the initial RSC request. After activation, expect one scoped GET and only the
needed lazy widget chunk(s); shared dependencies may already be transferred by
other controls. Compressed chunk/resource comparisons must come from the actual
built candidate. Verify a primary widget and clock controls remain usable while
holding/failing an activated secondary GET; inspect focus, draft, scroll, saved
order, narrow layout, reset and eligibility changes. Existing metadata/catalog and
source-scanner reconciliation remains the final integration implementer's task.
