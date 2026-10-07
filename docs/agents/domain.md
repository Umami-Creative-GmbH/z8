# Domain docs

## Before exploring

1. Read root `GLOSSARY-MAP.md` and follow its pointers to every
   `GLOSSARY.md` relevant to the task.
2. Read relevant system-wide decisions in root `docs/adr/`.
3. Read relevant context-scoped ADRs alongside each selected
   context's `GLOSSARY.md`, under its `docs/adr/` directory.

If these files are absent, proceed silently. `/domain-modeling`,
also used by `/grill-with-docs` and `/improve-codebase-architecture`,
creates them lazily as terminology and decisions are resolved.

## Multi-context layout

- `GLOSSARY-MAP.md`: root index of contexts and their document paths.
- `docs/adr/`: system-wide decisions.
- `<context-root>/GLOSSARY.md`: a context's domain model and glossary.
- `<context-root>/docs/adr/`: decisions scoped to that context.

Context roots may be apps, packages, or domain subdirectories within
them. The map defines the boundaries; an app or package does not
automatically constitute a separate domain context.

## Vocabulary

Use the relevant glossary's terms in issue titles, proposals,
hypotheses, and test names. If a needed concept is missing, reconsider
the terminology or note the gap for `/domain-modeling`.

## ADR conflicts

Explicitly surface proposals that contradict an existing ADR,
identifying the decision and why it may be worth reopening.
