---
status: accepted
date: 2026-11-06
---

# A primary team is always a team membership, and changing it moves the employee

An employee's team memberships and their primary team were recorded separately, and most ways of adding or editing an employee set only the primary team. Screens then disagreed about who is in a team: the team members dialog counted both, the Org Explorer counted only memberships, and the add picker hid people it could not find as members. We decided that an employee's primary team is always one of their team memberships, and anyone with a team membership has a primary team. Every write keeps this true, instead of each reader combining the two.

Changing an employee's single *Team* field is a move. The new team becomes a membership and the primary team, and the membership in the old primary team ends. Other memberships stay. Clearing the field ends that membership, and the next remaining membership becomes the primary team, as removing someone from a team already does.

## Considered Options

- **Combine both sources wherever membership is read.** It fixes one screen at a time and leaves every future reader with the same trap. Counts, filters and access scopes would keep disagreeing whenever one reader forgets.
- **Treat a changed Team field as an addition.** Nothing would be lost, but people would quietly pile up in their old teams, and admins editing a single field expect a move.

## Consequences

- A one-off backfill adds the missing membership for every primary team, and gives employees who have memberships but no primary team their oldest membership as primary.
- The employee form says before saving that the old team membership ends. A move to another primary team still ends intended-driver status as described in [ADR 0005](./0005-intended-driver-is-a-scoped-assignment-and-losing-it-ends-authorization.md), and the form's existing team-change warning keeps showing it.
- Membership is read from team memberships alone. The primary team answers only "which single team counts for this rule".
