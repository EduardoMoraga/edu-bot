/** `null` clears an optional bot field. `undefined` leaves it as it was. */
export function optionalField<T extends object, K extends keyof T>(patch: T, key: K, value: T[K] | null | undefined): void {
  if (value === null) patch[key] = undefined as T[K];
  else if (value !== undefined) patch[key] = value;
}
