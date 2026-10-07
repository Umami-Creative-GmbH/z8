import type * as React from "react";

export function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
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
