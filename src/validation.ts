// Catalog IDs may be negative for local demonstration records; zero is never an ID.
export function isResourceId(value: string) {
  return /^-?[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
