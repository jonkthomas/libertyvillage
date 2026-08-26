// Eval-owned protection/Vercel/lifecycle double for the local live-model
// supervisor acceptance gate. FROZEN by evals/local-supervisor-acceptance.sha256.
// Split from fake-supervisor-github.mjs per the spec file budgets.
//
// Owns the side of the double GitHub itself would own: the doubled (never
// exercised) coordinator decision, the distinct-actor Vercel statuses, the
// EXACT synthetic merge-ref validation, the merge API, the PR-shaped
// main→staging sync, and protected-branch push rejection. PR creation stays
// synchronous inside the ingest dispatch handler, but statuses, merge-ref
// validation, merge, production Vercel, and sync are driven ONLY after the
// child supervisor is observed polling the pinned head
// (GET /commits/<head>/status), so the child must prove it pinned an OPEN PR
// in MONITORING_CI before any check or merge exists. Evaluator-driven controls
// that run no child pass controls.drive === 'immediate'.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitEnv } from './local-git-fixture.mjs';

const BLOG_FILE = /^data\/posts\.json$|^public\/images\/blog\//;

export function createLifecycleDriver({ fixture, prod, controls, hub }) {
  const pending = new Map();

  function arm(pr) {
    if (controls.drive === 'immediate') { stageStatuses(pr, { immediate: true }); return; }
    pending.set(pr.headSha, { pr, stage: 'await-pin' });
  }

  // Called by the HTTP double on every GET /commits/<sha>/status AFTER the
  // response was sent: the first poll proves the host pinned the OPEN PR; the
  // second proves it observed the posted statuses before any merge existed.
  function onStatusPoll(sha) {
    const entry = pending.get(sha);
    if (!entry) return;
    if (entry.stage === 'await-pin') {
      entry.stage = 'statuses-scheduled';
      hub.record('host-observed-pinned-head', {
        number: entry.pr.number, prState: entry.pr.state, merged: entry.pr.merged,
        statusesAtObservation: hub.statusesFor(sha).length,
      });
      setImmediate(() => {
        try { stageStatuses(entry.pr, { immediate: false }); } catch (error) {
          hub.record('lifecycle-error', { error: error.message }); pending.delete(sha);
        }
      });
      return;
    }
    if (entry.stage === 'statuses-posted') {
      entry.stage = 'merge-scheduled';
      hub.record('host-observed-head-statuses', { number: entry.pr.number });
      setImmediate(() => {
        try { stageMerge(entry.pr); } catch (error) { hub.record('lifecycle-error', { error: error.message }); }
        pending.delete(sha);
      });
    }
  }

  function stageStatuses(pr, { immediate }) {
    if (prod.validatePullRequest) {
      const verdict = prod.validatePullRequest({ repository: hub.repo, kind: 'blog-live', expectedSha: pr.headSha, pr: hub.asPull(pr), files: pr.files });
      if (!verdict.ok) {
        hub.record('validation-failed-generator', { number: pr.number, errors: verdict.errors });
        hub.addAudit(pr.number, pr.headSha, 'validation-failed');
        pending.delete(pr.headSha);
        return;
      }
    }
    if (controls.checks === 'fail') {
      hub.postStatus(pr.headSha, 'automation/ci', 'failure', 'coordinator-double');
      hub.postStatus(pr.headSha, 'automation/opus-gate', 'failure', 'coordinator-double');
      hub.addAudit(pr.number, pr.headSha, 'validation-failed');
      pending.delete(pr.headSha);
      return;
    }
    hub.postStatus(pr.headSha, 'automation/ci', 'success', 'coordinator-double');
    hub.postStatus(pr.headSha, 'automation/opus-gate', 'success', 'coordinator-double');
    if (controls.vercelHead !== false) hub.postStatus(pr.headSha, 'Vercel', 'success', 'evaluator-vercel');
    if (controls.merge === 'none') { pending.delete(pr.headSha); return; }
    if (immediate) { stageMerge(pr); return; }
    const entry = pending.get(pr.headSha);
    if (entry) entry.stage = 'statuses-posted';
  }

  // Exact synthetic merge-ref validation: the refs/pull/N/merge analogue must
  // be an exact 2-parent merge of the LIVE main (HEAD^1) and the pinned head
  // (HEAD^2), built and verified BEFORE any merge is allowed.
  function validateMergeRef(headSha) {
    const liveMain = fixture.rev('main');
    const wt = fs.mkdtempSync(path.join(fixture.root, 'merge-ref-'));
    let parents = [];
    try {
      execFileSync('git', ['-C', fixture.bare, 'worktree', 'add', '--detach', wt, liveMain], { env: gitEnv(), stdio: 'pipe' });
      execFileSync('git', ['-C', wt, '-c', 'user.name=merge-ref', '-c', 'user.email=synthetic@merge.ref', 'merge', '--no-ff', '-m', 'synthetic merge ref', headSha], { env: gitEnv(), stdio: 'pipe' });
      parents = execFileSync('git', ['-C', wt, 'rev-list', '--parents', '-n', '1', 'HEAD'], { env: gitEnv(), encoding: 'utf8' }).trim().split(/\s+/).slice(1);
    } finally {
      try { execFileSync('git', ['-C', fixture.bare, 'worktree', 'remove', '--force', wt], { env: gitEnv(), stdio: 'pipe' }); } catch { /* gone */ }
    }
    if (parents.length !== 2 || parents[0] !== liveMain || parents[1] !== headSha) {
      hub.record('merge-ref-invalid', { headSha, mainSha: liveMain, parents });
      throw new Error(`synthetic merge-ref is not an exact merge of live main and the pinned head: [${parents.join(', ')}]`);
    }
    hub.record('merge-ref-validated', { headSha, mainSha: liveMain, parents });
    return liveMain;
  }

  function stageMerge(pr) {
    if (controls.dishonestMerged) {
      pr.merged = true; pr.state = 'closed';
      pr.merge_commit_sha = 'd15400e57'.padEnd(40, 'a');
      hub.record('dishonest-merge', { number: pr.number });
      return;
    }
    validateMergeRef(pr.headSha);
    const mergeSha = fixture.mergeViaApi({ base: 'main', headSha: pr.headSha, method: controls.merge || 'merge' });
    pr.merged = true; pr.state = 'closed'; pr.merge_commit_sha = mergeSha; pr.updatedAt = new Date().toISOString();
    hub.record('content-merge', { number: pr.number, merge_commit_sha: mergeSha, method: controls.merge || 'merge', parents: fixture.parentsOf(mergeSha) });
    if (controls.vercelProd !== 'missing') hub.postStatus(mergeSha, 'Vercel', controls.vercelProd || 'success', 'evaluator-vercel');
    if (controls.sync === 'none') return;
    if (controls.sync === 'direct-push') { attemptDirectPush('staging', mergeSha); return; }
    driveSync(mergeSha, pr.headSha);
  }

  // Genuinely attempts to move a protected ref through receive-pack, so the
  // pre-receive protection hook actually runs. A no-op push (sha already the
  // tip) would silently skip the hook, so it is refused as a control error.
  function attemptDirectPush(branch, sha) {
    if (fixture.rev(branch) === sha) throw new Error(`direct-push control refused a no-op push of ${branch} (the hook would never run)`);
    try {
      execFileSync('git', ['-C', fixture.bare, 'push', fixture.bare, `${sha}:refs/heads/${branch}`], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(),
      });
      hub.record('direct-push-accepted', { branch, sha });
      return { accepted: true, stderr: '' };
    } catch (error) {
      const stderr = String(error.stderr || error.message);
      hub.record('direct-push-rejected', { branch, sha, stderr: stderr.slice(0, 400) });
      return { accepted: false, stderr };
    }
  }

  function driveSync(mainSha, contentSha) {
    if (fixture.isAncestor(mainSha, fixture.rev('staging'))) { hub.record('sync-noop', { mainSha }); return; }
    const oldStaging = fixture.rev('staging');
    const { branch, headSha, delta } = fixture.buildSyncHead(mainSha);
    const nonBlog = delta.filter((file) => !BLOG_FILE.test(file));
    const deltaOk = delta.length === 0 ? { ok: true, errors: [] } : prod.validatePaths('blog-live', delta);
    if (!deltaOk.ok || nonBlog.length) {
      fixture.bareGit(['update-ref', '-d', `refs/heads/${branch}`]);
      hub.record('sync-aborted', { mainSha, delta, errors: deltaOk.errors });
      return;
    }
    const pr = hub.addIssue({ title: 'sync: main into staging', pull: true, head: { ref: branch, sha: headSha }, base: 'staging', files: delta });
    hub.record('sync-pr-created', { number: pr.number, head: branch, sha: headSha, base: 'staging', author: pr.author });
    hub.postStatus(headSha, 'automation/ci', 'success', 'coordinator-double');
    hub.postStatus(headSha, 'automation/opus-gate', 'success', 'coordinator-double');
    const newStaging = fixture.mergeViaApi({ base: 'staging', headSha, method: 'merge' });
    pr.merged = true; pr.state = 'closed'; pr.merge_commit_sha = newStaging; pr.updatedAt = new Date().toISOString();
    hub.record('sync-merge', {
      number: pr.number, merge_commit_sha: newStaging, method: 'merge', oldStaging, contentSha,
      parents: fixture.parentsOf(newStaging),
    });
  }

  return { arm, onStatusPoll, stageMerge, validateMergeRef, driveSync, attemptDirectPush };
}
