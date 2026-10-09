# Projects are flat; tasks are the only level below a project

Competitor products offer sub-projects, project templates and tasks within projects (#770). We decided that projects never nest: a **Task** inside one project is the only finer breakdown, and a **Project template** is a separate entity rather than a flagged project. Nesting would ripple into budget roll-ups, booking eligibility, assignment inheritance, every project report and per-organization name uniqueness; tasks inside a flat project cover the sub-project use case well enough. Keeping templates out of the project table means no project reader (eligibility, pickers, reports, budget notifications, the extension API) can accidentally treat a template as bookable.

## Considered Options

- **Sub-projects** (parent project with child projects): rejected for the ripple above.
- **Tasks as project-scoped work categories**: rejected. Work categories carry the working-time factor and payroll wage-type mapping; tasks describe what in the project the time was spent on, and must not enter payroll or working-time rules.
- **Templates as projects with a template flag**: rejected, because every project query would have to exclude them.
