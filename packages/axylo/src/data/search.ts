/** The first index in [start, end) whose value is not below `value`, in ascending values. Shared with the lookup. */
export function lowerBound(values: ArrayLike<number>, value: number, start = 0, end = values.length): number {
  while (start < end) {
    const mid = start + Math.floor((end - start) / 2);
    if (values[mid]! < value) start = mid + 1;
    else end = mid;
  }
  return start;
}
