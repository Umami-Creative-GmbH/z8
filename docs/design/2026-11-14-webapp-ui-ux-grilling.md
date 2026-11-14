# Webapp UI and UX rollout: grilling record

Status: all product decisions and the concrete spec, testing boundaries and ticket breakdown approved on 14 November 2026.

Tracking issue: [#1692](https://github.com/Umami-Creative-GmbH/z8/issues/1692), assigned to KaiSoellch. Documentation branch: `docs/1692-app-wide-ui-ux-spec`, based on the dashboard/time-tracking refresh through `f4a2acd80`.

## Intended outcome

Produce one shared UI and UX specification, then one implementation ticket per user-facing webapp route template. The approved [UX language](../refs/ux-language.md), [design context](../refs/design-context.md), and [dashboard/time-tracking direction](2026-11-14-dashboard-time-tracking-redesign.md) supply the visual and behavioral baseline. This phase defines the rollout; it does not implement other routes.

## Settled decisions

The user answered “Yes to all” to the first three questions.

1. **Coverage:** include all user-facing webapp routes, including authentication, setup, shared/public views, settings, and platform administration. Exclude API endpoints and the separate marketing, documentation, and desktop applications. The webapp's behavior inside a store wrapper still belongs to its web route's acceptance criteria.
2. **Ticket identity:** one route template receives one ticket. Dynamic records, locale variants, role variants, query parameters, responsive layouts, and loading/error states belong inside that ticket rather than receiving duplicate route tickets.
3. **Shared patterns:** standardize tables, filters, forms, dialogs, navigation, and operational states. Route work reuses agreed patterns and documents justified exceptions. Every shared change has an explicit owner and its consumers have real dependency relationships.
4. **Preservation contract carried forward:** keep every existing capability, organization-scoped authorization boundary, saved preference, real read/action, authoritative calculation, audit context, and failure/recovery path. Missing prototype controls are not approved removals. Domain changes and feature removals require a separate explicit decision.
5. **Shared-pattern tickets:** the user approved a limited set of additional shared-pattern tickets where the inventory demonstrates multiple consumers need the same change. Each has an explicit owner; only genuinely dependent route tickets are blocked by it.
6. **Single-spec issue hierarchy:** the user approved organizational grouping issues beneath the canonical spec, with route tickets nested beneath their group and explicitly referencing the same root spec. For this rollout, that is an explicit exception to the repository's direct-spec-child requirement. Groups organize execution; they are not separate specifications.
7. **Redirect aliases:** the user approved covering the 19 redirect-only settings aliases in their destination-page tickets, with every alias explicitly listed and verified. Do not create separate visual-refactor tickets for those aliases. The planned page-ticket count is 153, before additional shared-pattern and organizational grouping issues.
8. **Phone records adapt to the task:** ordinary lists prioritize identity, status, and useful actions, with secondary fields available through accessible details. Comparison-heavy reports and planners may use local horizontal scrolling. Every field and action remains available; whole-page horizontal overflow is not the adaptation.
9. **Authentication and public shells:** apply the restrained surfaces, typography, spacing, and state treatment to sign-in, setup, onboarding, and shared/public screens, retaining purpose-built layouts, organization branding, and existing security flows.
10. **Task-based form containers:** ordinary create/edit forms use a consistent side-panel pattern; short confirmations use dialogs; long or multistep tasks retain full-page/wizard layouts. Domain-specific reasons, acknowledgments, drafts, dismissal rules, validation, and recovery remain intact.
11. **A composition brief for every page:** before ticket publication, each of the 153 pages gets its main task, primary action, scope, main record/form, and supporting context recorded. Route tickets receive concrete page direction alongside shared rules.

## Repository discovery

These are factual working inventories, not additional approved design decisions:

- [Route inventory](2026-11-14-webapp-route-inventory.md): route templates, page purposes, shells/access owners, aliases, and route-specific unknowns.
- [Shared-pattern inventory](2026-11-14-webapp-pattern-inventory.md): existing reusable components, competing compositions, persisted state and ownership seams.
- [UX and domain constraints](2026-11-14-webapp-ux-constraints.md): relevant decisions and behavior that presentation changes must preserve.

The route scan found 172 `page.tsx` templates: 153 persistent pages and 19 redirect-only settings aliases. The two refreshed reference pages are included. Under the approved alias policy, all 172 templates are covered through 153 page tickets, with additional shared-pattern and organizational grouping issues kept separate from the page count.

## Resolved round: shared work and tracker structure

4. **Additional shared-pattern tickets:** approved, limited to needs demonstrated by actual consumers, with a named owner and only genuinely dependent consumers blocked by that work.
5. **Hierarchy beyond 100 routes:** approved. GitHub permits [100 direct sub-issues per parent and eight nesting levels](https://docs.github.com/en/enterprise-cloud%40latest/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues). Use the agreed grouping level while retaining one canonical spec and one implementation ticket per in-scope page template.
6. **Redirect-only aliases:** approved for coverage in destination-page tickets rather than separate visual-refactor tickets.
7. **Dense phone records:** approved for task-appropriate adaptation: compact records plus accessible detail for ordinary lists, local scrolling for comparison-heavy records/planning, all information and actions retained.

The product-decision frontier is settled. Keep implementation details in the spec and tickets; add glossary terms only for genuine domain terminology, and ADRs only for consequential trade-offs that meet the repository's ADR criteria.

## Resolved round: visual application and route briefs

8. **Authentication and public shells:** approved, preserving purpose-built layouts, organization branding and security flows.
9. **Create/edit containers:** approved as a small task-based family, with domain reasons, acknowledgments, drafts, dismissal rules and recovery intact.
10. **Per-page composition briefs:** approved for all 153 pages before ticket publication.

## Phase boundary

The [canonical draft spec](2026-11-14-webapp-ui-ux-spec.md) now combines the shared contract, testing boundaries and all 153 composition briefs. The [numbered breakdown](2026-11-14-webapp-ui-ux-ticket-breakdown.md) proposes three shared foundations, four organizational groups and 153 page tickets, including seven proven route-to-route presentation handoffs.

Review this concrete result for shared understanding, testing seams, ticket granularity and blocking edges before finalizing the spec with `to-spec` and publishing via `to-tickets`. All Q1–Q10 product decisions remain approved; this review concerns the completed artifacts. No route implementation tickets have been created during discovery.

## Final review outcome

The user approved the completed spec, its test boundaries and the numbered 160-issue breakdown. Proceed with versioned spec publication, native grouped issues and verified blocking edges. This approval completes grilling and breakdown review; it does not request route implementation, merge or deployment in this documentation/publication phase.

## Publication accommodation

GitHub rejected blocking fanout above 100 for F3. Add one administrative H1 handoff blocked by F2/F3 and route their 75 joint consumers through it. This preserves all original reachable prerequisites and parallel foundation work, without changing any approved page brief or design. Total subordinate issues become 161; three UI foundations and four family groups remain, with the single additional readiness checkpoint. The publication index records the verified native graph.
