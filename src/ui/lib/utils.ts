/** Zero-pad a number to 2 digits. */
export function pad(n: number): string {
  return String(n).padStart(2, "0");
}
