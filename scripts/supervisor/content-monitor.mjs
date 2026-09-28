const DEFAULT_STATUS_DEADLINE_MS = 3_600_000;
const DEFAULT_RENDER_DEADLINE_MS = 1_800_000;
const POLL_MS = 2_000;

function latestTrustedStatus(statuses, dataSha, allowedCreator) {
  if (!Array.isArray(statuses)) return null;
  return statuses.map((status, index) => ({ status, index }))
    .filter(({ status }) => status?.context === 'content/publish'
      && status?.creator?.login === allowedCreator
      && (status.sha === undefined || status.sha === dataSha))
    .sort((a, b) => {
      const time = Date.parse(b.status.created_at || '') - Date.parse(a.status.created_at || '');
      return Number.isFinite(time) && time !== 0 ? time : b.index - a.index;
    })[0]?.status ?? null;
}

function failureState(description) {
  if (String(description).startsWith('ingest-error:')) return 'INGEST_FAILED';
  const decision = /^decision=([a-z-]+)/.exec(String(description))?.[1];
  const states = {
    validation: 'BLOCKED_VALIDATION', lint: 'BLOCKED_VALIDATION', conflict: 'BLOCKED_VALIDATION',
    unrepairable: 'BLOCKED_UNREPAIRABLE', exhausted: 'BLOCKED_EXHAUSTED',
    'not-converging': 'BLOCKED_UNREPAIRABLE', block: 'BLOCKED_UNREPAIRABLE',
    'smoke-failed': 'BLOCKED_PROPAGATION', error: 'INGEST_FAILED',
  };
  return states[decision] || 'INGEST_FAILED';
}

async function pause(wait, now, deadline) {
  const remaining = deadline - now();
  if (remaining > 0) await wait(Math.min(POLL_MS, remaining));
}

export async function monitorContentPublish({
  dataSha, title, siteUrl, allowedCreator, getStatuses, getManifest, getPage,
  now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  statusDeadlineMs = DEFAULT_STATUS_DEADLINE_MS, renderDeadlineMs = DEFAULT_RENDER_DEADLINE_MS,
}) {
  if (!/^[0-9a-f]{40}$/.test(dataSha) || !title || !siteUrl || !allowedCreator) {
    throw new Error('monitor requires exact data SHA, title, site URL and allowed creator');
  }
  const statusDeadline = now() + statusDeadlineMs;
  let published;
  while (now() <= statusDeadline) {
    const status = latestTrustedStatus(await getStatuses(dataSha), dataSha, allowedCreator);
    if (status?.state === 'failure' || status?.state === 'error') {
      return { state: failureState(status.description), reason: status.description };
    }
    const binding = /^published:(\d+):seq:(\d+)$/.exec(String(status?.description || ''));
    if (status?.state === 'success' && binding && status.target_url && Number(binding[2]) > 0) {
      published = { targetUrl: status.target_url, liveSeq: Number(binding[2]) };
      break;
    }
    if (now() >= statusDeadline) break;
    await pause(wait, now, statusDeadline);
  }
  if (!published) return { state: 'MONITOR_TIMEOUT', reason: 'content/publish status deadline exceeded' };

  const renderDeadline = now() + renderDeadlineMs;
  while (now() <= renderDeadline) {
    try {
      const before = await getManifest(siteUrl);
      if (Number(before?.live_seq) >= published.liveSeq && before?.deployment_url) {
        const page = await getPage(published.targetUrl);
        const after = await getManifest(siteUrl);
        if (page?.status === 200 && String(page.text || '').includes(title)
          && Number(after?.live_seq) >= published.liveSeq
          && after?.deployment_url === before.deployment_url) {
          return { state: 'PUBLISHED_LIVE', ...published };
        }
      }
    } catch { /* transient deployment fetch errors remain bounded by the render deadline */ }
    if (now() >= renderDeadline) break;
    await pause(wait, now, renderDeadline);
  }
  return { state: 'BLOCKED_PROPAGATION', reason: 'published content did not become visible before deadline', ...published };
}
