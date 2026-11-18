export function lowerBound(values: ArrayLike<number>, value: number, start = 0, end = values.length): number {
  while (start < end) {
    const mid = start + Math.floor((end - start) / 2);
    if (values[mid]! < value) start = mid + 1;
    else end = mid;
  }
  return start;
}

export function upperBound(values: ArrayLike<number>, value: number, start = 0, end = values.length): number {
  while (start < end) {
    const mid = start + Math.floor((end - start) / 2);
    if (values[mid]! <= value) start = mid + 1;
    else end = mid;
  }
  return start;
}

export function pageDistance(count: number): number {
  return Math.max(1, Math.floor(count / 10));
}
