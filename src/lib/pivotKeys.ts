
export const GROUP_SEPARATOR = "\u001F";

/** Placeholder standing in for a null dimension value inside a key. */
export const NULL_TOKEN = "\u0000null";

export function encodeGroupKey(values: readonly (string | null)[]): string {
  return values.map((v) => (v === null || v === "" ? NULL_TOKEN : v)).join(GROUP_SEPARATOR);
}

export function decodeGroupKey(key: string): string[] {
  if (key === "") return [];
  return key.split(GROUP_SEPARATOR).map((v) => (v === NULL_TOKEN ? "" : v));
}

/** Address of one aggregated cell: which column group, which value field. */
export function cellKey(columnKey: string, valueFieldId: string): string {
  return `${columnKey}||${valueFieldId}`;
}

/** The single column group used when the user has put nothing in Columns. */
export const TOTAL_COLUMN_KEY = "__total__";
