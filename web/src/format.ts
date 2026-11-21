export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatStamp(iso: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  }).format(new Date(iso));
  return `${formatted} UTC`;
}

export function roleLabel(role: string): string {
  switch (role) {
    case "domain-controller":
      return "Domain controller";
    case "windows-client":
      return "Domain client";
    case "linux-server":
      return "Linux server";
    default:
      return role;
  }
}

export function freeRatio(disk: { totalBytes: number; freeBytes: number }): number {
  if (disk.totalBytes <= 0) return 0;
  return disk.freeBytes / disk.totalBytes;
}

export function usedRatio(used: number, total: number): number {
  if (total <= 0) return 0;
  return used / total;
}
