import { describe, expect, it } from "vitest";
import { billableChoice } from "./billable-choice";

const billableByDefault = { hasCustomer: true, billableDefault: true };
const customerProject = { hasCustomer: true, billableDefault: false };
const internalProject = { hasCustomer: false, billableDefault: false };

describe("billableChoice", () => {
	it("hides the toggle and requests nothing without a project", () => {
		expect(billableChoice({ project: null, explicit: undefined })).toEqual({
			visible: false,
			enabled: false,
			checked: false,
			request: undefined,
		});
	});

	it("prefills from the project's billable default and leaves the default to the server", () => {
		expect(billableChoice({ project: billableByDefault, explicit: undefined })).toEqual({
			visible: true,
			enabled: true,
			checked: true,
			request: undefined,
		});
		expect(billableChoice({ project: customerProject, explicit: undefined })).toMatchObject({
			checked: false,
			request: undefined,
		});
	});

	it("sends an explicit choice that overrides the default", () => {
		expect(billableChoice({ project: billableByDefault, explicit: false })).toMatchObject({
			checked: false,
			request: false,
		});
		expect(billableChoice({ project: customerProject, explicit: true })).toMatchObject({
			checked: true,
			request: true,
		});
	});

	it("shows the work's own billability while its project stays", () => {
		expect(
			billableChoice({ project: billableByDefault, explicit: undefined, kept: false }),
		).toMatchObject({ checked: false, request: undefined });
		expect(billableChoice({ project: customerProject, explicit: true, kept: true })).toMatchObject({
			checked: true,
			request: undefined,
		});
		expect(billableChoice({ project: customerProject, explicit: true, kept: false })).toMatchObject(
			{
				request: true,
			},
		);
	});

	it("disables the toggle for a project without a customer and never requests billable", () => {
		expect(billableChoice({ project: internalProject, explicit: true })).toEqual({
			visible: true,
			enabled: false,
			checked: false,
			request: undefined,
		});
	});

	it("lets billable work on a project that lost its customer be switched off", () => {
		expect(billableChoice({ project: internalProject, explicit: undefined, kept: true })).toEqual({
			visible: true,
			enabled: true,
			checked: true,
			request: undefined,
		});
		expect(billableChoice({ project: internalProject, explicit: false, kept: true })).toEqual({
			visible: true,
			enabled: true,
			checked: false,
			request: false,
		});
	});
});
