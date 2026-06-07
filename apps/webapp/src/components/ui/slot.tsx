import * as React from "react";

type SlotProps = React.HTMLAttributes<HTMLElement> & {
	children?: React.ReactNode;
	ref?: React.Ref<HTMLElement>;
};

function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
	return (node: T | null) => {
		for (const ref of refs) {
			if (!ref) {
				continue;
			}

			if (typeof ref === "function") {
				ref(node);
			} else {
				(ref as React.MutableRefObject<T | null>).current = node;
			}
		}
	};
}

function isEventHandler(propName: string, propValue: unknown) {
	return /^on[A-Z]/.test(propName) && typeof propValue === "function";
}

function Slot({ children, ref: forwardedRef, ...slotProps }: SlotProps) {
	if (!React.isValidElement<Record<string, unknown>>(children)) {
		return null;
	}

	const child = children;
	const childProps = child.props;
	const props = { ...slotProps, ...childProps } as Record<string, unknown>;
	const childRef = childProps.ref as React.Ref<HTMLElement> | undefined;

	for (const propName in slotProps) {
		const slotProp = slotProps[propName as keyof typeof slotProps];
		const childProp = childProps[propName];

		if (isEventHandler(propName, slotProp) && typeof childProp === "function") {
			props[propName] = (...args: unknown[]) => {
				childProp(...args);
				(slotProp as (...handlerArgs: unknown[]) => void)(...args);
			};
		} else if (propName === "className") {
			props[propName] = [slotProp, childProp].filter(Boolean).join(" ");
		} else if (
			propName === "style" &&
			typeof slotProp === "object" &&
			typeof childProp === "object"
		) {
			props[propName] = { ...slotProp, ...childProp };
		}
	}

	if (childRef || forwardedRef) {
		props.ref = composeRefs(childRef, forwardedRef);
	}

	return React.cloneElement(child, props);
}

export { Slot };
