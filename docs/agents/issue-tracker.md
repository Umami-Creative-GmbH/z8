# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Umami-Creative-GmbH/z8`.
Use the `gh` CLI for all tracker operations.

## Conventions

Run commands inside this clone so `gh` resolves the repository from
the Git remote. Outside the clone, pass `--repo Umami-Creative-GmbH/z8`.

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- Read structured data:
  `gh issue view <number> --json number,title,body,labels,comments`
- List:
  `gh issue list --state open --json number,title,body,labels,comments`
  with appropriate label and state filters.
- Comment: `gh issue comment <number> --body "..."`
- Apply/remove labels:
  `gh issue edit <number> --add-label "..." --remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

For multiline bodies, use `--body-file <path>`.

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the issue and its comments.

## Tickets derived from a spec

Every ticket created from a spec, including through `/to-tickets`, must
be linked as a native GitHub sub-issue of the originating spec issue.
The spec issue is the parent; each derived ticket is a child.

If the spec has not been published as an issue, publish it first.
After creating each ticket, get its numeric database ID with
`gh api repos/Umami-Creative-GmbH/z8/issues/<ticket-number> --jq .id`,
then attach it to the spec:

```bash
gh api --method POST \
  repos/Umami-Creative-GmbH/z8/issues/<spec-number>/sub_issues \
  -F sub_issue_id=<ticket-db-id>
```

Use the spec's repository for the parent endpoint and the ticket's
repository when looking up its database ID for cross-repository tickets.
Verify the relationship by listing the spec's sub-issues with
`gh api --paginate repos/Umami-Creative-GmbH/z8/issues/<spec-number>/sub_issues`.
Ticket creation is complete only after this relationship is verified.
A body reference or task-list entry alone does not satisfy this rule.
If linking fails, report the blocker and keep the setup incomplete.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If enabled later, use `gh pr` equivalents for reading, commenting,
labelling, and closing. Read proposed changes with `gh pr diff`.
External PRs are those whose author association is CONTRIBUTOR,
FIRST_TIME_CONTRIBUTOR, or NONE.

GitHub shares issue and PR numbers. For an ambiguous reference,
try `gh pr view <number>`, then fall back to `gh issue view <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Children: link tickets as native GitHub sub-issues. If unavailable,
  use a task list in the map and `Part of #<map>` in each child.
  Label children `wayfinder:<type>` where type is research,
  prototype, grilling, or task.
- Blocking: use native issue dependencies. Get the blocker's database
  ID with `gh api repos/Umami-Creative-GmbH/z8/issues/<n> --jq .id`,
  then add the edge:

  ```bash
  gh api --method POST \
    repos/Umami-Creative-GmbH/z8/issues/<child>/dependencies/blocked_by \
    -F issue_id=<blocker-db-id>
  ```

  If dependencies are unavailable, put `Blocked by: #<n>, #<n>` at
  the top of the child body. A ticket is unblocked when every blocker
  is closed.
- Frontier: select the first open child in map order with no assignee
  and no open blockers. For native dependencies, inspect
  `issue_dependencies_summary.blocked_by`.
- Claim: `gh issue edit <n> --add-assignee @me` as the session's first
  tracker write.
- Resolve: comment with the answer, close the ticket, and append a
  summary plus link to the map's Decisions-so-far.
