export type Status = "ok" | "warn" | "crit";

export type Role = "domain-controller" | "windows-client" | "linux-server";

export interface SnapshotRef {
  id: string;
  label: string;
  collectedAt: string;
  sample?: boolean;
}

export interface SnapshotIndex {
  snapshots: SnapshotRef[];
}

export interface Member {
  sam: string;
  enabled: boolean;
}

export interface DirectoryGroup {
  name: string;
  memberCount: number;
  members: Member[];
}

export interface DirectoryInfo {
  domain: string;
  collectedFrom: string;
  staleAfterDays: number;
  users: {
    total: number;
    enabled: number;
    disabled: number;
    lockedOut: number;
    stale: number;
  };
  computers: {
    total: number;
    stale: number;
  };
  groups: DirectoryGroup[];
}

export interface Disk {
  mount: string;
  totalBytes: number;
  freeBytes: number;
}

export interface Host {
  id: string;
  hostname: string;
  role: Role;
  os: {
    family: "windows" | "linux";
    name: string;
    version: string;
    build?: string;
  };
  uptimeSeconds: number;
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
  };
  disks: Disk[];
  network: {
    name: string;
    ipv4: string[];
    macAddress: string[];
  }[];
  updates: {
    pending: number;
  };
  windows?: {
    services?: {
      name: string;
      displayName: string;
      status: "running" | "stopped";
    }[];
    time?: {
      source: string;
      offsetSeconds: number;
    };
    domainJoined?: boolean;
    secureChannel?: boolean;
    dnsServers?: string[];
  };
  linux?: {
    failedUnits: string[];
    listening: {
      port: number;
      process: string;
    }[];
  };
}

export interface Snapshot {
  id: string;
  collectedAt: string;
  label: string;
  sample?: boolean;
  environment: {
    name: string;
    domain: string;
  };
  directory: DirectoryInfo;
  hosts: Host[];
}

export interface Change {
  level: Status;
  text: string;
}
