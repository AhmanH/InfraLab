import { useEffect, useState } from "react";
import { diffSnapshots } from "./diff";
import { formatBytes, formatPercent, formatStamp, formatUptime, freeRatio, roleLabel, usedRatio } from "./format";
import { dcAddresses, domainFacts, hostHealth, snapshotHealth } from "./health";
import type { Host, Snapshot, SnapshotIndex, Status } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

function isSnapshot(value: Snapshot): value is Snapshot {
  return Array.isArray(value?.hosts) && Boolean(value?.directory) && Boolean(value?.environment);
}

export function App() {
  const [index, setIndex] = useState<SnapshotIndex | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [previous, setPrevious] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string>("dc01");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<SnapshotIndex>("/snapshots/index.json")
      .then((data) => {
        const snapshots = [...data.snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
        setIndex({ snapshots });
        setCurrentId(snapshots.at(-1)?.id ?? null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load snapshots"));
  }, []);

  useEffect(() => {
    if (!index || !currentId) return;
    const position = index.snapshots.findIndex((item) => item.id === currentId);
    const priorId = position > 0 ? index.snapshots[position - 1].id : null;
    let cancelled = false;

    Promise.all([
      getJson<Snapshot>(`/snapshots/${currentId}.json`),
      priorId ? getJson<Snapshot>(`/snapshots/${priorId}.json`) : Promise.resolve(null),
    ])
      .then(([current, prior]) => {
        if (cancelled) return;
        if (!isSnapshot(current)) throw new Error("Snapshot is missing hosts or directory");
        setSnapshot(current);
        setPrevious(prior && isSnapshot(prior) ? prior : null);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load snapshot");
      });

    return () => {
      cancelled = true;
    };
  }, [index, currentId]);

  if (error) return <main className="app"><p className="state">{error}</p></main>;
  if (!index || !snapshot || !currentId) return <main className="app"><p className="state">Loading snapshot…</p></main>;

  const position = index.snapshots.findIndex((item) => item.id === currentId);
  const controllers = dcAddresses(snapshot);
  const selected = snapshot.hosts.find((host) => host.id === selectedId) ?? snapshot.hosts[0];
  const changes = previous ? diffSnapshots(snapshot, previous) : [];

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <h1 className="word">{snapshot.environment.name}</h1>
          <p className="domain">{snapshot.environment.domain}</p>
        </div>
        <div className="nav">
          <div className="weeks">
            <button className="step" type="button" disabled={position <= 0} onClick={() => setCurrentId(index.snapshots[position - 1].id)} aria-label="Previous snapshot">‹</button>
            {index.snapshots.map((item) => (
              <button key={item.id} className="week" type="button" aria-current={item.id === currentId} onClick={() => setCurrentId(item.id)}>
                {item.label}
              </button>
            ))}
            <button className="step" type="button" disabled={position >= index.snapshots.length - 1} onClick={() => setCurrentId(index.snapshots[position + 1].id)} aria-label="Next snapshot">›</button>
          </div>
          <p className="stamp">Collected {formatStamp(snapshot.collectedAt)}</p>
        </div>
      </header>

      {snapshot.sample ? <p className="banner">Sample data for layout. A real collection replaces this file.</p> : null}

      <section className="cards" aria-label="Hosts">
        {snapshot.hosts.map((host) => (
          <HostCard
            key={host.id}
            host={host}
            controllers={controllers}
            pressed={host.id === selected?.id}
            onSelect={() => setSelectedId(host.id)}
          />
        ))}
      </section>

      <section className="split">
        <DirectoryPanel snapshot={snapshot} />
        <ChangesPanel changes={changes} hasPrevious={previous !== null} />
      </section>

      {selected ? <HostDetail host={selected} controllers={controllers} /> : null}
    </main>
  );
}

function StatusPill({ level }: { level: Status }) {
  const label = level === "ok" ? "Ok" : level === "warn" ? "Warn" : "Crit";
  return <span className={`pill ${level}`}>{label}</span>;
}

function HostCard({ host, controllers, pressed, onSelect }: { host: Host; controllers: string[]; pressed: boolean; onSelect: () => void }) {
  const health = hostHealth(host, controllers);
  const address = host.network.flatMap((nic) => nic.ipv4)[0] ?? "no address";
  const mac = host.network.flatMap((nic) => nic.macAddress)[0] ?? "no MAC";
  const disk = host.disks[0];
  return (
    <button className="card" type="button" aria-pressed={pressed} onClick={onSelect}>
      <div className="card-top">
        <p className="role">{roleLabel(host.role)}</p>
        <StatusPill level={health.level} />
      </div>
      <div>
        <h2 className="host">{host.hostname}</h2>
        <p className="sub">{host.os.name} · {address} · {mac} · up {formatUptime(host.uptimeSeconds)}</p>
      </div>
      <dl className="metrics">
        <div className="metric"><dt>CPU</dt><dd>{host.cpu.usagePercent}%</dd></div>
        <div className="metric"><dt>Memory</dt><dd>{formatPercent(usedRatio(host.memory.usedBytes, host.memory.totalBytes))}</dd></div>
        <div className="metric"><dt>Disk free</dt><dd>{disk ? formatPercent(freeRatio(disk)) : "—"}</dd></div>
      </dl>
      <HostFacts host={host} />
      {health.reasons.length > 0 ? <p className={`reasons ${health.level}`}>{health.reasons.join(" · ")}</p> : null}
    </button>
  );
}

function HostFacts({ host }: { host: Host }) {
  if (host.role === "domain-controller") {
    const offset = host.windows?.time?.offsetSeconds;
    return (
      <div className="facts">
        {(host.windows?.services ?? []).map((service) => (
          <p className="fact" key={service.name}>
            <span>{service.name}</span>
            <b className={service.status === "running" ? "" : "down"}>{service.status}</b>
          </p>
        ))}
        <p className="fact"><span>Time</span><b>{offset === undefined ? "—" : `${offset.toFixed(1)}s`}</b></p>
        <p className="fact"><span>Updates</span><b>{host.updates.pending} pending</b></p>
      </div>
    );
  }

  if (host.role === "windows-client") {
    return (
      <div className="facts">
        <p className="fact"><span>Joined</span><b>{host.windows?.domainJoined ? "yes" : "no"}</b></p>
        <p className="fact"><span>Secure channel</span><b className={host.windows?.secureChannel ? "" : "down"}>{host.windows?.secureChannel ? "ok" : "broken"}</b></p>
        <p className="fact"><span>DNS</span><b>{host.windows?.dnsServers?.join(", ") || "—"}</b></p>
        <p className="fact"><span>Updates</span><b>{host.updates.pending} pending</b></p>
      </div>
    );
  }

  const failed = host.linux?.failedUnits ?? [];
  return (
    <div className="facts">
      <p className="fact"><span>Failed units</span><b className={failed.length ? "stopped" : ""}>{failed.length ? failed.join(", ") : "none"}</b></p>
      <p className="fact"><span>Listening</span><b>{host.linux?.listening.map((item) => item.port).join(", ") || "none"}</b></p>
      <p className="fact"><span>Upgrades</span><b>{host.updates.pending} pending</b></p>
    </div>
  );
}

function DirectoryPanel({ snapshot }: { snapshot: Snapshot }) {
  const { directory } = snapshot;
  const users = [
    ["Enabled", directory.users.enabled],
    ["Disabled", directory.users.disabled],
    ["Locked", directory.users.lockedOut],
    ["Stale", directory.users.stale],
  ] as const;
  return (
    <section className="panel" aria-label="Directory">
      <p className="eyebrow">{directory.domain}</p>
      <h2>Directory</h2>
      <div className="stats">
        {users.map(([label, value]) => (
          <div className="stat" key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      <p className="sub">{directory.computers.total} computers · {directory.computers.stale} stale · stale means no logon in {directory.staleAfterDays} days</p>
      {directory.groups.map((group) => (
        <div key={group.name}>
          <h3 className="role" style={{ marginTop: 16 }}>{group.name}</h3>
          <ul className="members">
            {group.members.map((member) => (
              <li className={member.enabled ? "member" : "member off"} key={member.sam}>
                <span>{member.sam}</span>
                <span>{member.enabled ? "enabled" : "disabled"}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ChangesPanel({ changes, hasPrevious }: { changes: { level: Status; text: string }[]; hasPrevious: boolean }) {
  return (
    <section className="panel" aria-label="Changes">
      <p className="eyebrow">Against the previous snapshot</p>
      <h2>Since last week</h2>
      {hasPrevious && changes.length > 0 ? (
        <ul className="changes">
          {changes.map((change) => (
            <li className="change" key={change.text}>
              <StatusPill level={change.level} />
              <p>{change.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{hasPrevious ? "Nothing crossed a threshold since the previous snapshot." : "This is the earliest snapshot. The next file you add will show changes here."}</p>
      )}
    </section>
  );
}

function Meter({ ratio, reverse }: { ratio: number; reverse?: boolean }) {
  const level = reverse ? (ratio < 0.1 ? "crit" : ratio < 0.2 ? "warn" : "ok") : ratio >= 0.95 ? "crit" : ratio >= 0.85 ? "warn" : "ok";
  return (
    <div className="track" aria-hidden="true">
      <div className={`fill ${level}`} style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} />
    </div>
  );
}

function HostDetail({ host, controllers }: { host: Host; controllers: string[] }) {
  const health = hostHealth(host, controllers);
  const memory = usedRatio(host.memory.usedBytes, host.memory.totalBytes);
  return (
    <section className="detail" aria-label={`${host.hostname} detail`}>
      <div className="detail-head">
        <div>
          <p className="eyebrow">{roleLabel(host.role)}</p>
          <h2>{host.hostname}</h2>
          <p className="sub">{host.os.name} {host.os.version}{host.os.build ? ` · build ${host.os.build}` : ""} · {host.cpu.cores} cores · up {formatUptime(host.uptimeSeconds)}</p>
        </div>
        <StatusPill level={health.level} />
      </div>
      <div className="detail-grid">
        <div>
          <h3>Resources at collection</h3>
          <div className="bars">
            <div>
              <p className="bar-label"><span>CPU</span><span>{host.cpu.usagePercent}%</span></p>
              <Meter ratio={host.cpu.usagePercent / 100} />
            </div>
            <div>
              <p className="bar-label"><span>Memory</span><span>{formatBytes(host.memory.usedBytes)} / {formatBytes(host.memory.totalBytes)}</span></p>
              <Meter ratio={memory} />
            </div>
            {host.disks.map((disk) => (
              <div key={disk.mount}>
                <p className="bar-label"><span>{disk.mount} free</span><span>{formatBytes(disk.freeBytes)} / {formatBytes(disk.totalBytes)}</span></p>
                <Meter ratio={freeRatio(disk)} reverse />
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>Network Details</h3>
          <dl className="kv">
            {host.network.map((nic) => (
              <div key={nic.name}>
                <dt>{nic.name}</dt><dd>{nic.ipv4.join(", ") || "No IP"}</dd>
                <dt>Mac Address</dt><dd>{nic.macAddress.join(", ") || "No MAC"}</dd>
              </div>
            ))}
            <div><dt>Pending updates</dt><dd>{host.updates.pending}</dd></div>
          </dl>
        </div>
        <RoleDetail host={host} />
      </div>
      <p className="note">CPU, memory, and time offset are the moment the script ran, not a weekly average. {host.cpu.model}.</p>
    </section>
  );
}

function RoleDetail({ host }: { host: Host }) {
  if (host.role === "domain-controller") {
    return (
      <div>
        <h3>Directory services</h3>
        <dl className="kv">
          {(host.windows?.services ?? []).map((service) => (
            <div key={service.name}><dt>{service.displayName}</dt><dd>{service.status}</dd></div>
          ))}
          <div><dt>Time source</dt><dd>{host.windows?.time?.source ?? "—"}</dd></div>
        </dl>
      </div>
    );
  }
  if (host.role === "windows-client") {
    return (
      <div>
        <h3>Domain trust</h3>
        <dl className="kv">
          <div><dt>Joined</dt><dd>{host.windows?.domainJoined ? "yes" : "no"}</dd></div>
          <div><dt>Secure channel</dt><dd>{host.windows?.secureChannel ? "ok" : "broken"}</dd></div>
          <div><dt>DNS servers</dt><dd>{host.windows?.dnsServers?.join(", ") || "—"}</dd></div>
        </dl>
      </div>
    );
  }
  return (
    <div>
      <h3>Listeners</h3>
      <dl className="kv">
        {(host.linux?.listening ?? []).map((item) => (
          <div key={item.port}><dt>{item.process}</dt><dd>{item.port}</dd></div>
        ))}
        <div><dt>Failed units</dt><dd>{host.linux?.failedUnits.join(", ") || "none"}</dd></div>
      </dl>
    </div>
  );
}
