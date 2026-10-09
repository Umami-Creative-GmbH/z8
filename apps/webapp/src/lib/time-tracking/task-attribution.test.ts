import { describe, expect, it } from "vitest";
import {
	chooseProject,
	isProjectTaskId,
	namedTaskIntent,
	recordedTaskId,
	taskIdAfter,
	taskIdToSend,
	taskIntentFollowingProject,
} from "./task-attribution";

const project = "project-a";
const otherProject = "project-b";

describe("taskIntentFollowingProject", () => {
	it("keeps the task while the write keeps the project", () => {
		const intent = taskIntentFollowingProject({
			task: undefined,
			projectId: project,
			currentProjectId: project,
		});
		expect(taskIdAfter(intent, "task-1")).toBe("task-1");
	});

	it("clears the task when the project changes or is cleared without a new task", () => {
		for (const projectId of [otherProject, null]) {
			for (const task of [undefined, { kind: "preserve" as const }]) {
				const intent = taskIntentFollowingProject({ task, projectId, currentProjectId: project });
				expect(taskIdAfter(intent, "task-1")).toBeNull();
			}
		}
	});

	it("applies an explicit task or clearing whatever the project does", () => {
		expect(
			taskIdAfter(
				taskIntentFollowingProject({
					task: { kind: "replace", id: "task-2" },
					projectId: otherProject,
					currentProjectId: project,
				}),
				"task-1",
			),
		).toBe("task-2");
		expect(
			taskIdAfter(
				taskIntentFollowingProject({
					task: { kind: "clear" },
					projectId: project,
					currentProjectId: project,
				}),
				"task-1",
			),
		).toBeNull();
	});
});

describe("isProjectTaskId", () => {
	it("accepts only a UUID, so a malformed ID is an unknown task", () => {
		expect(isProjectTaskId("e8730000-0000-4000-8000-000000000030")).toBe(true);
		expect(isProjectTaskId("E8730000-0000-4000-8000-000000000030")).toBe(true);
		for (const value of ["not-a-task", "", 42, true, null, undefined, {}]) {
			expect(isProjectTaskId(value)).toBe(false);
		}
	});
});

describe("optional task keys", () => {
	it("names a task intent only when the write names a task", () => {
		expect(namedTaskIntent(undefined)).toEqual({});
		expect(namedTaskIntent(null)).toEqual({ task: { kind: "clear" } });
		expect(namedTaskIntent("task-1")).toEqual({ task: { kind: "replace", id: "task-1" } });
	});

	it("records a task only when there is one", () => {
		expect(recordedTaskId(null)).toEqual({});
		expect(recordedTaskId(undefined)).toEqual({});
		expect(recordedTaskId("task-1")).toEqual({ taskId: "task-1" });
	});
});

describe("a booking form's task choice", () => {
	it("keeps the chosen task while the project stays and drops it when the project changes", () => {
		const selection = { projectId: project, taskId: "task-1" };

		expect(chooseProject(selection, project)).toEqual(selection);
		expect(chooseProject(selection, otherProject)).toEqual({
			projectId: otherProject,
			taskId: undefined,
		});
	});

	it("leaves an unchanged task out and sends any other choice explicitly", () => {
		const current = { projectId: project, taskId: "task-1" };

		expect(taskIdToSend({ projectId: project, taskId: "task-1", current })).toBeUndefined();
		expect(taskIdToSend({ projectId: project, taskId: "task-2", current })).toBe("task-2");
		expect(taskIdToSend({ projectId: project, taskId: undefined, current })).toBeNull();
		expect(taskIdToSend({ projectId: otherProject, taskId: undefined, current })).toBeNull();
		expect(
			taskIdToSend({ projectId: project, taskId: null, current: { projectId: project, taskId: null } }),
		).toBeUndefined();
	});
});