/** Zero-pad a number to 2 digits. */
export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format bytes to human-readable size. */
export function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + " GB";
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(0) + " MB";
  return bytes + " B";
}
