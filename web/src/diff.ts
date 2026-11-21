import { freeRatio, formatPercent } from "./format";
import type { Change, DirectoryGroup, Host, Snapshot } from "./types";

function countLine(label: string, previous: number, current: number, parts: string[]): void {
  if (previous === current) return;
  parts.push(`${label} ${previous} → ${current}`);
}

function groupChanges(previous: DirectoryGroup | undefined, current: DirectoryGroup): string[] {
  const lines: string[] = [];
  const before = new Map((previous?.members ?? []).map((member) => [member.sam, member]));
  const after = new Map(current.members.map((member) => [member.sam, member]));
  for (const [sam, member] of after) {
    if (!before.has(sam)) lines.push(`${current.name} gained ${sam}`);
    else if (before.get(sam)?.enabled !== member.enabled) {
      lines.push(`${sam} in ${current.name} is ${member.enabled ? "enabled" : "disabled"}`);
    }
  }
  for (const sam of before.keys()) {
    if (!after.has(sam)) lines.push(`${current.name} lost ${sam}`);
  }
  return lines;
}

function hostChanges(previous: Host, current: Host): Change[] {
  const changes: Change[] = [];
  if (previous.updates.pending !== current.updates.pending) {
    changes.push({
      level: current.updates.pending > previous.updates.pending ? "warn" : "ok",
      text: `${current.hostname} pending updates ${previous.updates.pending} → ${current.updates.pending}`,
    });
  }

  for (const disk of current.disks) {
    const prior = previous.disks.find((item) => item.mount === disk.mount);
    if (!prior) continue;
    const from = freeRatio(prior);
    const to = freeRatio(disk);
    if (Math.abs(to - from) < 0.05) continue;
    const level = to < 0.1 ? "crit" : to < 0.2 || to < from ? "warn" : "ok";
    changes.push({
      level,
      text: `${current.hostname} ${disk.mount} free ${formatPercent(from)} → ${formatPercent(to)}`,
    });
  }

  const priorServices = new Map((previous.windows?.services ?? []).map((service) => [service.name, service.status]));
  for (const service of current.windows?.services ?? []) {
    const before = priorServices.get(service.name);
    if (!before || before === service.status) continue;
    changes.push({
      level: service.status === "running" ? "ok" : "crit",
      text: `${current.hostname} ${service.name} ${before} → ${service.status}`,
    });
  }

  const priorUnits = new Set(previous.linux?.failedUnits ?? []);
  const currentUnits = new Set(current.linux?.failedUnits ?? []);
  for (const unit of currentUnits) {
    if (!priorUnits.has(unit)) {
      changes.push({ level: "warn", text: `${current.hostname} ${unit} failed` });
    }
  }
  for (const unit of priorUnits) {
    if (!currentUnits.has(unit)) {
      changes.push({ level: "ok", text: `${current.hostname} ${unit} recovered` });
    }
  }

  if (previous.windows?.domainJoined !== current.windows?.domainJoined && current.windows?.domainJoined !== undefined) {
    changes.push({
      level: current.windows.domainJoined ? "ok" : "crit",
      text: current.windows.domainJoined
        ? `${current.hostname} joined the domain`
        : `${current.hostname} is no longer domain joined`,
    });
  }
  if (previous.windows?.secureChannel !== current.windows?.secureChannel && current.windows?.secureChannel !== undefined) {
    changes.push({
      level: current.windows.secureChannel ? "ok" : "crit",
      text: current.windows.secureChannel
        ? `${current.hostname} secure channel restored`
        : `${current.hostname} secure channel broken`,
    });
  }

  return changes;
}

export function diffSnapshots(current: Snapshot, previous: Snapshot): Change[] {
  const changes: Change[] = [];
  const userParts: string[] = [];
  countLine("total", previous.directory.users.total, current.directory.users.total, userParts);
  countLine("enabled", previous.directory.users.enabled, current.directory.users.enabled, userParts);
  countLine("disabled", previous.directory.users.disabled, current.directory.users.disabled, userParts);
  countLine("locked out", previous.directory.users.lockedOut, current.directory.users.lockedOut, userParts);
  countLine("stale", previous.directory.users.stale, current.directory.users.stale, userParts);
  if (userParts.length > 0) {
    const lockedGrew = current.directory.users.lockedOut > previous.directory.users.lockedOut;
    const staleGrew = current.directory.users.stale > previous.directory.users.stale;
    changes.push({
      level: lockedGrew || staleGrew ? "warn" : "ok",
      text: `Users ${userParts.join(", ")}`,
    });
  }

  if (
    previous.directory.computers.total !== current.directory.computers.total ||
    previous.directory.computers.stale !== current.directory.computers.stale
  ) {
    changes.push({
      level: current.directory.computers.stale > previous.directory.computers.stale ? "warn" : "ok",
      text: `Computers ${previous.directory.computers.total} → ${current.directory.computers.total}, stale ${previous.directory.computers.stale} → ${current.directory.computers.stale}`,
    });
  }

  const priorGroups = new Map(previous.directory.groups.map((group) => [group.name, group]));
  for (const group of current.directory.groups) {
    for (const line of groupChanges(priorGroups.get(group.name), group)) {
      changes.push({ level: "warn", text: line });
    }
  }

  const priorHosts = new Map(previous.hosts.map((host) => [host.id, host]));
  for (const host of current.hosts) {
    const prior = priorHosts.get(host.id);
    if (!prior) {
      changes.push({ level: "ok", text: `${host.hostname} appeared in the snapshot` });
      continue;
    }
    changes.push(...hostChanges(prior, host));
  }
  for (const host of previous.hosts) {
    if (!current.hosts.some((item) => item.id === host.id)) {
      changes.push({ level: "warn", text: `${host.hostname} missing from this snapshot` });
    }
  }

  return changes;
}
