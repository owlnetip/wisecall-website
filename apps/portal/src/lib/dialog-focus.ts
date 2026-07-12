export type DialogFocusDirection = "forward" | "backward";

export function getDialogFocusIndex(
  activeIndex: number,
  focusableCount: number,
  direction: DialogFocusDirection,
): number {
  if (focusableCount <= 0) return -1;
  if (direction === "backward") {
    return activeIndex <= 0 ? focusableCount - 1 : activeIndex - 1;
  }
  return activeIndex < 0 || activeIndex >= focusableCount - 1 ? 0 : activeIndex + 1;
}
