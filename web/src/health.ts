import { freeRatio, formatPercent, usedRatio } from "./format";
import type { Host, Snapshot, Status } from "./types";

const CRITICAL_SERVICES = ["NTDS", "DNS", "Netlogon", "KDC"];

interface Finding {
  level: Status;
  text: string;
}

function worst(findings: Finding[]): Status {
  if (findings.some((finding) => finding.level === "crit")) return "crit";
  if (findings.some((finding) => finding.level === "warn")) return "warn";
  return "ok";
}

export function dcAddresses(snapshot: Snapshot): string[] {
  return snapshot.hosts
    .filter((host) => host.role === "domain-controller")
    .flatMap((host) => host.network.flatMap((nic) => nic.ipv4));
}

export function hostHealth(host: Host, domainControllers: string[]): { level: Status; reasons: string[] } {
  const findings: Finding[] = [];

  for (const disk of host.disks) {
    const free = freeRatio(disk);
    if (free < 0.1) findings.push({ level: "crit", text: `${disk.mount} ${formatPercent(free)} free` });
    else if (free < 0.2) findings.push({ level: "warn", text: `${disk.mount} ${formatPercent(free)} free` });
  }

  const memory = usedRatio(host.memory.usedBytes, host.memory.totalBytes);
  if (memory >= 0.95) findings.push({ level: "crit", text: `Memory ${formatPercent(memory)}` });
  else if (memory >= 0.85) findings.push({ level: "warn", text: `Memory ${formatPercent(memory)}` });

  if (host.cpu.usagePercent >= 90) findings.push({ level: "crit", text: `CPU ${host.cpu.usagePercent}%` });
  else if (host.cpu.usagePercent >= 75) findings.push({ level: "warn", text: `CPU ${host.cpu.usagePercent}%` });

  if (host.updates.pending > 0) {
    findings.push({ level: "warn", text: `${host.updates.pending} pending updates` });
  }

  if (host.role === "domain-controller") {
    for (const name of CRITICAL_SERVICES) {
      const service = host.windows?.services?.find((item) => item.name === name);
      if (service?.status !== "running") findings.push({ level: "crit", text: `${name} stopped` });
    }
    const offset = Math.abs(host.windows?.time?.offsetSeconds ?? 0);
    if (offset >= 60) findings.push({ level: "crit", text: `Time offset ${Math.round(offset)}s` });
    else if (offset >= 5) findings.push({ level: "warn", text: `Time offset ${offset.toFixed(1)}s` });
  }

  if (host.role === "windows-client") {
    if (host.windows?.domainJoined !== true) {
      findings.push({ level: "crit", text: "Not domain joined" });
    } else if (host.windows.secureChannel !== true) {
      findings.push({ level: "crit", text: "Secure channel broken" });
    }
    const dns = host.windows?.dnsServers ?? [];
    const seesDc = domainControllers.length === 0 || dns.some((address) => domainControllers.includes(address));
    if (!seesDc) findings.push({ level: "warn", text: "DNS does not point at the domain controller" });
  }

  for (const unit of host.linux?.failedUnits ?? []) {
    findings.push({ level: "warn", text: `${unit} failed` });
  }

  return { level: worst(findings), reasons: findings.map((finding) => finding.text) };
}

export function snapshotHealth(snapshot: Snapshot): Status {
  const controllers = dcAddresses(snapshot);
  const levels = snapshot.hosts.map((host) => hostHealth(host, controllers).level);
  if (levels.includes("crit")) return "crit";
  if (levels.includes("warn")) return "warn";
  return "ok";
}

export function domainFacts(snapshot: Snapshot): string[] {
  const dc = snapshot.hosts.find((host) => host.role === "domain-controller");
  const down = CRITICAL_SERVICES.filter(
    (name) => dc?.windows?.services?.find((service) => service.name === name)?.status !== "running",
  );
  const serviceFact = down.length
    ? `${down.join(", ")} stopped on ${dc?.hostname ?? "the domain controller"}`
    : "NTDS, DNS, Netlogon, and KDC running";

  const client = snapshot.hosts.find((host) => host.role === "windows-client");
  const trustFact =
    client?.windows?.domainJoined === true && client.windows.secureChannel === true
      ? `${client.hostname} joined, secure channel ok`
      : `${client?.hostname ?? "Windows client"} domain trust needs attention`;

  return [serviceFact, trustFact, `Directory read from ${snapshot.directory.collectedFrom}`];
}
