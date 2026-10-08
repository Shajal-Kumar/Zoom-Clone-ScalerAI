/** "849 2049-1029", "84920491029" -> "849-2049-1029"; null if not 11 digits. */
export function normalizeMeetingId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/** "849-2049-1029" -> "849 2049 1029" (display form). */
export const formatMeetingId = (id: string): string => id.replace(/-/g, " ");
