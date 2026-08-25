import fs from 'node:fs';

export const STALE_LEASE_MS = 15 * 60 * 1000;
export const LEASE_LIMIT_MS = 6 * 60 * 60 * 1000;

export function leaseIsLive(lease, { now = Date.now(), pidAlive = () => false } = {}) {
  if (!lease || !Number.isInteger(lease.pid)) return false;
  const heartbeat = Date.parse(lease.heartbeat_at ?? '');
  return pidAlive(lease.pid) && !leaseExpired(lease, now)
    && Number.isFinite(heartbeat) && now - heartbeat < STALE_LEASE_MS;
}

export function leaseExpired(lease, now = Date.now()) {
  const expiry = Date.parse(lease?.expires_at ?? '');
  return !Number.isFinite(expiry) || now >= expiry;
}

export function newLease({ runId, pid = process.pid, lockPath, now = new Date() }) {
  return {
    run_id: runId, kind: 'blog', pid, started_at: now.toISOString(), heartbeat_at: now.toISOString(),
    expires_at: new Date(now.getTime() + LEASE_LIMIT_MS).toISOString(), lock_path: lockPath,
  };
}

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Atomic O_EXCL lock complements the systemd unit's whole-process flock and also
// protects manual CLI invocations. A stale owner is replaced only after inspection.
export function acquireAtomicLock(lockPath, lease, { fsImpl = fs, isLive = leaseIsLive } = {}) {
  try {
    const fd = fsImpl.openSync(lockPath, 'wx', 0o600);
    fsImpl.writeFileSync(fd, `${JSON.stringify(lease)}\n`);
    fsImpl.closeSync(fd);
    return { acquired: true, reclaimed: false };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let current = null;
    try { current = JSON.parse(fsImpl.readFileSync(lockPath, 'utf8')); } catch {}
    if (isLive(current)) return { acquired: false, reclaimed: false, current };
    fsImpl.unlinkSync(lockPath);
    const fd = fsImpl.openSync(lockPath, 'wx', 0o600);
    fsImpl.writeFileSync(fd, `${JSON.stringify(lease)}\n`);
    fsImpl.closeSync(fd);
    return { acquired: true, reclaimed: true, current };
  }
}

export function releaseAtomicLock(lockPath, { fsImpl = fs } = {}) {
  try { fsImpl.unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
