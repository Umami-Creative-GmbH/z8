/**
 * Grows a control's hit area to at least 44×44 px on touch screens without changing how it
 * looks. A pseudo-element centred on the control extends past any side shorter than 2.75rem;
 * percentages resolve per axis, so wide controls only grow vertically. The control must not
 * clip its overflow, and `relative` gives way when a caller positions it absolutely (#846).
 */
export const touchTargetClassName =
	"relative pointer-coarse:after:absolute pointer-coarse:after:inset-[min(0px,calc((100%_-_2.75rem)/2))]";
