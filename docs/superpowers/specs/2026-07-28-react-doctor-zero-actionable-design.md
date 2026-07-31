# React Doctor Zero-Actionable Cleanup Design

## Objective

Reduce the webapp's React Doctor findings to zero actionable warnings and errors without weakening runtime behavior, tenant isolation, authorization, transaction ordering, or event ordering.

The baseline is a full React Doctor 0.9.2 scan of `apps/webapp`: 223 warnings and 4 errors across 155 files. Completion does not require rewriting code to hide validated false positives or deliberately sequential operations from the raw scanner output.

## Scope

- Run the full webapp scan with React Doctor 0.9.2 semantics.
- Fetch and apply the canonical validation and fix prompt for every reported rule.
- Classify each occurrence individually as actionable, a validated false positive, or intentionally ordered behavior.
- Fix every actionable occurrence.
- Do not change React Doctor configuration or add broad suppressions.
- Leave implementation changes unstaged until the full sweep is ready for review.

## Constraints

- Preserve organization scoping and authorization checks.
- Preserve database lock order, mutation order, workflow event order, and retry semantics.
- Parallelize asynchronous work only when the operations are demonstrably independent.
- Preserve UI behavior, accessibility, and translation behavior while extracting components.
- Use Temporal for date/time business logic and retain existing canonical timekeeping guarantees.
- Do not modify generated auth schema files.
- Treat concurrent work as immutable unless it directly conflicts with this pass.

## Triage Strategy

Use a risk-tiered sequence rather than cleaning files or rules in arbitrary order:

1. Resolve the four error-severity findings serially.
2. Resolve bug findings, including stale asynchronous effects, loading cleanup, unchecked fetch responses, unsafe parsing, and mutation hazards.
3. Resolve security findings with focused regression coverage.
4. Resolve performance findings, including transition scope and independent asynchronous work.
5. Resolve maintainability findings, extracting components only where the resulting boundaries have clear responsibilities.
6. Rescan after every wave to catch regressions and newly exposed findings.

For every occurrence, read the rule's canonical validation guidance before deciding whether it is actionable. A false-positive classification must cite the specific code shape and why the rule does not apply. An intentional-ordering classification must identify the dependency, lock, mutation, or event sequence that requires serialization.

## Implementation Boundaries

### Effects And Async State

Use cancellation or request-identity guards where effects can overlap. Ensure loading state is reset on rejection as well as success. Preserve existing callback cardinality and avoid moving side effects into render or state updater functions.

### Fetch And Parsing

Check HTTP status before consuming response bodies unless an endpoint intentionally uses a documented non-2xx payload contract. Validate untrusted JSON before use. Preserve current user-facing error behavior.

### Transactions And Loops

Group only independent reads or side effects. Keep lock acquisition, read-after-write checks, idempotency checks, append-only event writes, and dependent mutations sequential. Add focused tests before changing behavior-sensitive ordering.

### Component Structure

Decompose giant components only around meaningful responsibilities such as data loading, form state, sections, dialogs, or presentation. Avoid one-use abstractions that merely move lines without reducing coupling. Preserve component APIs unless a smaller internal interface improves isolation.

### Security

Address raw SQL and external navigation findings before performance or maintainability cleanup. Maintain parameterization, `organizationId` filters, permission enforcement, and safe `window.open` isolation.

## Testing

Behavior-sensitive production changes follow test-first red/green cycles:

1. Add a focused test expressing the preserved or corrected behavior.
2. Run it and confirm it fails for the intended reason.
3. Apply the smallest production change.
4. Run the focused test and related suite until green.

Purely mechanical class-name changes, component extraction with unchanged tests, and validated false-positive classifications do not require new behavior tests. Existing affected tests must still pass.

## Validation

- Run the webapp typecheck after each error fix.
- Run focused tests after each behavior-sensitive change.
- Run typecheck after each warning wave.
- Rescan after each wave using the same full-scan command and React Doctor version.
- Finish with formatting checks, `git diff --check`, full webapp typecheck, and the complete Vitest suite.
- Request an independent review focused on security, tenant isolation, transaction ordering, asynchronous races, and UI behavior.

If validation fails, revert only the newly introduced edit that caused the failure and retain unrelated or concurrent work.

## Completion Criteria

- No actionable React Doctor errors remain.
- No actionable React Doctor warnings remain.
- Every remaining raw diagnostic has an occurrence-level justification from canonical rule guidance or a concrete ordering dependency.
- React Doctor configuration is unchanged.
- Typecheck and the full test suite pass.
- The final diff passes independent review and contains no unintended files.
