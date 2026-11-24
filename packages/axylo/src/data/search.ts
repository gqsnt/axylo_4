/** The first index in [start, end) whose value is not below `value`, in ascending values. Shared with the lookup. */
export function lowerBound(values: ArrayLike<number>, value: number, start = 0, end = values.length): number {
  while (start < end) {
    const mid = start + Math.floor((end - start) / 2);
    if (values[mid]! < value) start = mid + 1;
    else end = mid;
  }
  return start;
}

/** Interior edges belong to the bin on their right. Only the final bin includes its upper edge. */
export function binIndex(edges: Float64Array, value: number): number {
  const last = edges.length - 1;
  return value >= edges[0]! && value <= edges[last]! ? upperBound(edges, value, 1, last) - 1 : -1;
}

export function upperBound(values: ArrayLike<number>, value: number, start = 0, end = values.length): number {
  while (start < end) {
    const mid = start + Math.floor((end - start) / 2);
    if (values[mid]! <= value) start = mid + 1;
    else end = mid;
  }
  return start;
}
