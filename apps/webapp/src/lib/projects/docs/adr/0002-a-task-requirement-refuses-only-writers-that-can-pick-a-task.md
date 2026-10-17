# A task requirement refuses only writers that can pick a task

A project can require that time booked to it names one of its tasks (#884). We decided where that rule is enforced by who is recording the work, not by which channel it comes through:

- **Someone is present and can pick a task.** This covers online web clock-out, clock-out on behalf, manual entry and calendar edits that set the project. These are refused without a task. The work keeps running, and the person picks a task and tries again.
- **Nobody can pick a task.** This covers automatic and departure clock-outs, kiosk, bots, the legacy route used by old desktop and extension builds, and offline commands replayed later. These are accepted, and the booking is recorded as a **missing task** for someone to fix afterwards.

A task can be picked only from a project the person may still book. A clock-out that keeps a project they can no longer book (unassigned, archived) is therefore accepted and marked as a missing task, even where someone is present.

A clock-out that nobody can answer is never refused. Refusing it would leave live work running, or loop an old client that has no task picker. Clocking already follows this rule for blocking holidays and vehicle use.

Reviewed imports are historical work from another tool. They are accepted and never marked.

## Considered Options

- **Never refuse, only mark.** Rejected: people booking in the web app could skip the task, and marking would become the normal path instead of the exception.
- **Refuse every channel that could carry a task.** This would gate desktop and offline commands on a new command version. Rejected: a frozen command is replayed after the moment of choice. Refusing it turns a missing task into a rejected clock action the user must review, and old builds that cannot send a task would be refused for good.
