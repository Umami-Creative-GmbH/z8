import * as React from "react";

type NativeButtonElementProps = {
	asChild?: boolean;
};

const nativeButtonComponentMarker = Symbol.for("z8.nativeButtonComponent");

type NativeButtonComponent = React.JSXElementConstructor<unknown> & {
	[nativeButtonComponentMarker]?: true;
};

type DismissEventDetails = {
	reason: string;
	event: Event;
	cancel: () => void;
};

type DismissEventHandlers = {
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
	onInteractOutside?: (event: Event) => void;
	onPointerDownOutside?: (event: PointerEvent) => void;
};

function markNativeButtonComponent<Component extends React.JSXElementConstructor<unknown>>(
	component: Component,
) {
	(component as NativeButtonComponent)[nativeButtonComponentMarker] = true;

	return component;
}

function isNativeButtonComponent(type: React.ElementType) {
	return (
		(typeof type === "function" || (typeof type === "object" && type !== null)) &&
		Boolean((type as NativeButtonComponent)[nativeButtonComponentMarker])
	);
}

function isZ8NativeButtonElement(element: React.ReactElement) {
	return (
		isNativeButtonComponent(element.type) && !(element.props as NativeButtonElementProps).asChild
	);
}

function isNativeButtonElement(element: React.ReactElement) {
	return element.type === "button" || isZ8NativeButtonElement(element);
}

function didPreventDefault(event: Event) {
	return event.defaultPrevented;
}

function callDismissHandler(handler: ((event: Event) => void) | undefined, event: Event) {
	handler?.(event);

	return didPreventDefault(event);
}

function getAsChildRender<Render>(
	asChild: boolean | undefined,
	children: React.ReactNode,
	render: Render,
) {
	return asChild && React.isValidElement(children) ? children : render;
}

function getAsChildNativeButton(
	asChild: boolean | undefined,
	children: React.ReactNode,
	nativeButton: boolean | undefined,
) {
	if (nativeButton !== undefined || !asChild || !React.isValidElement(children)) {
		return nativeButton;
	}

	return isNativeButtonElement(children);
}

function cancelDismissIfPrevented(
	open: boolean,
	eventDetails: DismissEventDetails,
	handlers: DismissEventHandlers,
) {
	if (open) {
		return false;
	}

	let prevented = false;

	if (eventDetails.reason === "escape-key") {
		prevented = callDismissHandler(
			handlers.onEscapeKeyDown as ((event: Event) => void) | undefined,
			eventDetails.event,
		);
	}

	if (eventDetails.reason === "outside-press") {
		prevented =
			callDismissHandler(
				handlers.onPointerDownOutside as ((event: Event) => void) | undefined,
				eventDetails.event,
			) || prevented;
		prevented = callDismissHandler(handlers.onInteractOutside, eventDetails.event) || prevented;
	}

	if (prevented || didPreventDefault(eventDetails.event)) {
		eventDetails.cancel();
		return true;
	}

	return false;
}

export type { DismissEventHandlers };
export {
	cancelDismissIfPrevented,
	getAsChildNativeButton,
	getAsChildRender,
	markNativeButtonComponent,
};
