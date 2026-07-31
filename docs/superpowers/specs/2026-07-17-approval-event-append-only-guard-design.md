# Approval Event Append-Only Guard Design

## Context

Task 2.2 requires a normal-test static guard that rejects production TypeScript paths capable of updating or deleting `approval_workflow_event`. Repeated extensions to the current file-local fixed-point scanner exposed ordinary TypeScript bypasses, false positives, and full-suite timeout risk. The replacement preserves the scanner's public API and test wiring while replacing its analysis core.

## Architecture

The guard has four bounded components:

1. A deterministic file walker resolves the supplied roots, sorts entries, applies exact workspace-relative exclusions, and prefilters files that cannot reference protected table or SQL mutation tokens.
2. A TypeScript `Program` and type checker resolve lexical symbols, imports, aliases, destructuring, transparent wrappers, shadowing, and known database receiver bindings. The analysis remains conservative: unresolved dynamic expressions are not treated as proven mutations.
3. A small PostgreSQL lexer extracts executable compile-time constant SQL from literals, no-substitution templates, constant template substitutions, immutable aliases, and string concatenation. It handles nested comments, escape strings, dollar quotes, optional `ONLY`, schema qualification, and quoted identifier case.
4. A detector combines resolved TypeScript operations and lexed SQL, then emits sorted, deduplicated violations with stable kind, file, line, and column data.

## Detection Boundary

The guard detects:

- Drizzle `update` and `delete` calls whose table argument resolves to the workflow event table, including bracket calls and transparent TypeScript wrappers.
- Executable SQL passed through resolved Drizzle SQL tags/raw helpers or known database query/execute receivers.
- Compile-time constant SQL aliases and concatenations.
- Production TypeScript under `apps/webapp/src` and `apps/webapp/scripts`.

The guard does not attempt to prove dynamically generated SQL, runtime-computed property names, or behavior hidden behind arbitrary helper functions. Database permissions or triggers remain outside Task 2.2.

## Exclusions

Only explicit non-production artifacts are excluded: tests/specs, `__tests__`, `apps/webapp/drizzle`, and generated `src/db/auth-schema.ts`. Runtime directories are never excluded by generic names such as `migration`, `meta`, `snapshot`, or `generated`.

## Performance

The walker performs a cheap textual prefilter before constructing the TypeScript program. Binding propagation uses compiler symbols and a worklist rather than repeated whole-tree fixed-point scans. Production scanning remains a single authoritative normal test and retains the existing timeout; the replacement must pass an isolated timing assertion with headroom for full-suite contention.

## Error Handling

Unreadable files, parse failures, or unsafe reflection are surfaced as deterministic guard failures rather than silently skipped. Path handling is absolute internally and normalized lexically for cross-platform module and exclusion comparisons.

## Testing

Existing regressions remain. New RED/GREEN cases cover transparent wrappers, namespace destructuring, constant SQL aliases and concatenation, known versus unrelated query/execute receivers, mutable reassignment ordering, PostgreSQL escaped strings and quoted identifier case, relative and Windows-style paths, deterministic output, exact violation kind/location, and production-scan performance.

No schema, migration, repository behavior, CI service, or Task 2.3 work is part of this design.
