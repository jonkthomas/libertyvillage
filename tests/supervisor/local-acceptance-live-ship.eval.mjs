// Hitchhiker/deploy controls C-N1–C-N14 (architecture §6.2 N1–N14) plus the
// human-infra promotion ancestry fixture (check E). Eval-owned; FROZEN by
// evals/local-supervisor-acceptance.sha256. None of these calls the live model.
//
// Reviewer-mandated constructions: C-N5 EXECUTES production
// heal-generator-base on a blog-live PR (staging merge hard-fails, head
// unmoved); C-N9 satisfies every prerequisite except content-SHA containment;
// C-N13 proves EVENTUAL MONITOR_TIMEOUT via the spec-sanctioned injected
// now/sleep seam plus sentinel and durable outcome (no non-terminal child is
// killed); C-N14 pushes genuinely-moving commits and requires the observed
// hook rejection, nonempty protection log, and unchanged SHAs. Every external
// child here is launched ASYNC and bounded (helpers/acceptance-exec.mjs), and
// C-N13-outcome drives production recordSupervisorOutcome through its EXISTING
// coordinatorFn seam: the loopback double lives in THIS process, so a synchronous
// child — even one reached through a production default — deadlocks the checker.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sentinelPost } from './helpers/local-git-fixture.mjs';
import { Checks, assertTrue, httpClient } from './helpers/acceptance-evidence.mjs';
import { CONTROL_TIMEOUT_MS, assertSettled, runCoordinator, runExternal } from './helpers/acceptance-exec.mjs';
import {
  REPO, expectIngestRefusal, firstBlogImage, prepareScenario, recordOutcomeThroughSeam, shimPost, withSimEnv,
} from './helpers/acceptance-scenario.mjs';

const cleanPost = (context, slug) => ({ ...shimPost({ dirty: false, image: firstBlogImage(context.repoRoot) }), slug, publishedAt: '2026-01-01', updatedAt: '2026-01-01' });

const ingestPayload = ({ dataSha, dataBranch }) => ({
  kind: 'blog', data_sha: dataSha, data_branch: dataBranch,
  topic_key: 'acceptance-control-topic', regenerations: 0,
});

export async function run(context) {
  const ch = new Checks('live-ship-controls');
  // C-N1 — staging-parented candidate against main (Design A impossibility).
  {
    const scenario = await prepareScenario(context, {
      name: 'cn1', controls: { drive: 'immediate', ingestBase: 'staging' },
      mutateStaging: (build, git) => {
        fs.writeFileSync(path.join(build, 'scripts/evil.mjs'), '// planted hitchhiker\n');
        git(['add', '--all']);
        git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'commit', '-m', 'fixture: staging hitchhiker code']);
      },
    });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn1-candidate'));
    expectIngestRefusal(ch, 'C-N1', 'staging-parented branch opened against main is rejected (primary Design-A impossibility proof)',
      scenario, ingestPayload(branch), 'path policy');
    ch.check('C-N1b', 'production validatePaths independently rejects the staging-parented file set', () => {
      const files = scenario.fixture.threeDotFiles(scenario.fixture.rev('main'), branch.dataSha);
      const verdict = scenario.prod.validatePaths('blog-live', files);
      assertTrue(!verdict.ok, 'validatePaths accepted hitchhiker files');
      return verdict.errors.slice(0, 3);
    });
    await scenario.cleanup();
  }
  // C-N2 — workflow/coordinator file in the PR file set.
  {
    const scenario = await prepareScenario(context, { name: 'cn2', controls: { drive: 'immediate', injectFile: '.github/workflows/x.yml' } });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn2-candidate'));
    expectIngestRefusal(ch, 'C-N2', "validatePaths('blog-live') refuses a planted workflow file; no merge", scenario, ingestPayload(branch), 'path policy');
    await scenario.cleanup();
  }
  // C-N3 — two-dot posts.json divergence at ingest.
  {
    const scenario = await prepareScenario(context, { name: 'cn3', controls: { drive: 'immediate' } });
    scenario.fixture.commitOnStaging((wt) => {
      const file = path.join(wt, 'data/posts.json');
      const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
      posts.push(sentinelPost('acceptance-cn3-drift', { dirty: false }));
      fs.writeFileSync(file, `${JSON.stringify(posts, null, 2)}\n`);
    }, 'fixture: content drift between main and staging');
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn3-candidate'));
    expectIngestRefusal(ch, 'C-N3', 'non-empty two-dot blog-path diff fails ingest before gh pr create', scenario, ingestPayload(branch), 'two-dot');
    await scenario.cleanup();
  }
  // C-N4 — cumulative promotion stays off under exedev.
  await ch.checkAsync('C-N4', 'kind=promotion is disabled under exedev even with LV_PROMOTION_ENABLED=true (child COMPLETED, exit 0)', async () => {
    const promo = await runExternal(process.execPath, [path.join(context.repoRoot, 'scripts/automation/promotion-control.mjs')], {
      env: { ...process.env, LV_WEEKLY_OWNER: 'exedev', LV_PROMOTION_ENABLED: 'true' },
      timeoutMs: CONTROL_TIMEOUT_MS, label: 'C-N4-promotion-control',
    });
    assertSettled(promo, 'C-N4 promotion-control');
    assertTrue(promo.code === 0, `promotion-control exited ${promo.code}: ${promo.stderr.slice(-400)}`);
    assertTrue(/skipped/.test(promo.stdout), `promotion-control CLI did not skip: ${promo.stdout}`);
    return { output: promo.stdout.trim() };
  });
  // C-N5 — EXECUTE the production heal on a blog-live PR: a staging merge must
  // hard-fail (or be a base-keyed no-op) without any head movement.
  {
    const scenario = await prepareScenario(context, {
      name: 'cn5', controls: { drive: 'immediate' },
      mutateStaging: (build, git) => {
        fs.writeFileSync(path.join(build, 'scripts/evil.mjs'), '// staging-only code a wrong heal would drag in\n');
        const file = path.join(build, 'data/posts.json');
        const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
        posts.push(sentinelPost('acceptance-cn5-staging-post', { dirty: false }));
        fs.writeFileSync(file, `${JSON.stringify(posts, null, 2)}\n`);
        git(['add', '--all']);
        git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'commit', '-m', 'fixture: staging ahead with code + conflicting posts.json']);
      },
    });
    const { fixture } = scenario;
    const stagingSha = fixture.rev('staging');
    const mainSha = fixture.rev('main');
    const headWt = fs.mkdtempSync(path.join(scenario.root, 'cn5-head-'));
    fixture.bareGit(['worktree', 'add', '--detach', headWt, mainSha]);
    const posts = JSON.parse(fs.readFileSync(path.join(headWt, 'data/posts.json'), 'utf8'));
    posts.push(cleanPost(context, 'acceptance-cn5-candidate'));
    fs.writeFileSync(path.join(headWt, 'data/posts.json'), `${JSON.stringify(posts, null, 2)}\n`);
    execFileSync('git', ['-C', headWt, 'add', '--', 'data/posts.json'], { stdio: 'pipe' });
    execFileSync('git', ['-C', headWt, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'commit', '-m', 'blog: cn5 candidate'], { stdio: 'pipe' });
    const headSha = execFileSync('git', ['-C', headWt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fixture.bareGit(['update-ref', 'refs/heads/blog/auto-cn5head', headSha]);
    fixture.bareGit(['worktree', 'remove', '--force', headWt]);
    const pr = scenario.sim.addIssue({ title: 'cn5: heal control', pull: true, head: { ref: 'blog/auto-cn5head', sha: headSha }, base: 'main', files: ['data/posts.json'] });
    const healDir = path.join(scenario.root, 'cn5-heal');
    execFileSync('git', ['clone', '--no-tags', fixture.bare, healDir], { stdio: 'pipe' });
    execFileSync('git', ['-C', healDir, 'checkout', '--detach', headSha], { stdio: 'pipe' });
    const outFile = path.join(scenario.root, 'cn5-output.txt');
    fs.writeFileSync(outFile, '');
    // The heal talks to the in-process double, so it MUST be async+bounded.
    const heal = await runCoordinator(fixture.clone,
      ['heal-generator-base', '--repo', REPO, '--pr', String(pr.number), '--kind', 'blog-live', '--sha', headSha],
      { cwd: healDir, env: scenario.env, extraEnv: { GITHUB_OUTPUT: outFile }, label: 'C-N5-heal' });
    const exitCode = heal.code ?? 1;
    const stderr = heal.stderr;
    ch.check('C-N5', 'production heal-generator-base on a blog-live PR SETTLES (completed or hard-errored, never hung) and never merges origin/staging: head unmoved, no staging ancestry, refs unchanged', () => {
      assertSettled(heal, 'C-N5 heal-generator-base');
      const headAfter = execFileSync('git', ['-C', healDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      let stagingMergedIn = true;
      try { execFileSync('git', ['-C', healDir, 'merge-base', '--is-ancestor', stagingSha, headAfter], { stdio: 'pipe' }); }
      catch { stagingMergedIn = false; }
      assertTrue(!stagingMergedIn, `heal merged origin/staging into the blog-live head (staging ${stagingSha.slice(0, 12)} became an ancestor of ${headAfter.slice(0, 12)})`);
      const output = fs.readFileSync(outFile, 'utf8');
      assertTrue(exitCode !== 0 || !/healed=true/.test(output) || headAfter === headSha,
        `heal reported healed=true and moved the head: exit=${exitCode} output=${output.trim().slice(0, 200)}`);
      assertTrue(fixture.bareGit(['rev-parse', 'refs/heads/blog/auto-cn5head']) === headSha, 'the PR head ref was pushed/moved');
      assertTrue(fixture.rev('main') === mainSha && fixture.rev('staging') === stagingSha, 'a protected ref moved during heal');
      return { exitCode, headAfter: headAfter.slice(0, 12), output: fs.readFileSync(outFile, 'utf8').trim().slice(0, 160), stderr: stderr.slice(0, 160) };
    });
    await scenario.cleanup();
  }
  // C-N6 — sync would carry non-blog files into staging.
  {
    const scenario = await prepareScenario(context, { name: 'cn6', controls: { drive: 'immediate' } });
    const mainSha = scenario.fixture.commitOnBranch('main', (wt) => {
      fs.writeFileSync(path.join(wt, 'scripts/acceptance-extra.mjs'), '// non-blog main change\n');
    }, 'fixture: non-blog main commit');
    const stagingBefore = scenario.fixture.rev('staging');
    ch.check('C-N6', 'sync with a non-blog incoming delta aborts: no sync PR merged, staging unchanged', () => {
      scenario.sim.driveSync(mainSha, mainSha);
      assertTrue(scenario.sim.events.some((event) => event.type === 'sync-aborted'), 'sync did not abort');
      assertTrue(!scenario.sim.events.some((event) => event.type === 'sync-merge'), 'a sync PR merged');
      assertTrue(scenario.fixture.rev('staging') === stagingBefore, 'staging moved');
      return null;
    });
    await scenario.cleanup();
  }
  // C-N7 — untrusted author / fork / draft / stale SHA.
  {
    const scenario = await prepareScenario(context, { name: 'cn7', controls: { drive: 'immediate' } });
    ch.check('C-N7', 'validatePullRequest fails closed on untrusted author, fork, draft, and stale SHA', () => {
      const sha = scenario.fixture.rev('main');
      const base = {
        state: 'open', draft: false, user: { login: 'github-actions[bot]' }, labels: [],
        head: { ref: 'blog/auto-x', sha, repo: { full_name: REPO, fork: false } },
        base: { ref: 'main', repo: { full_name: REPO } },
      };
      const cases = [
        { ...base, user: { login: 'mallory' } },
        { ...base, head: { ...base.head, repo: { full_name: 'evil/fork', fork: true } } },
        { ...base, draft: true },
        base,
      ];
      const expectedShas = [sha, sha, sha, 'b'.repeat(40)];
      for (const [index, pr] of cases.entries()) {
        const verdict = scenario.prod.validatePullRequest({ repository: REPO, kind: 'blog-live', expectedSha: expectedShas[index], pr, files: ['data/posts.json'] });
        assertTrue(!verdict.ok, `case ${index} was accepted`);
      }
      return null;
    });
    await scenario.cleanup();
  }
  // C-N8 — coordinator cannot POST the Vercel context.
  {
    const scenario = await prepareScenario(context, { name: 'cn8', controls: { drive: 'immediate' } });
    await ch.checkAsync('C-N8', 'real `coordinator status --context Vercel` is REJECTED (settled, nonzero exit); the double refuses the POST as well', async () => {
      const sha = scenario.fixture.rev('main');
      const forged = await runCoordinator(scenario.fixture.clone,
        ['status', '--repo', REPO, '--sha', sha, '--context', 'Vercel', '--state', 'success', '--description', 'forged'],
        { cwd: scenario.fixture.clone, env: scenario.env, label: 'C-N8-status' });
      assertSettled(forged, 'C-N8 coordinator status');
      assertTrue(forged.code !== 0, 'publishStatus accepted the Vercel context');
      assertTrue(!scenario.sim.statusesFor(sha).some((status) => status.context === 'Vercel'), 'a forged Vercel status was stored');
      return { exitCode: forged.code };
    });
    await scenario.cleanup();
  }
  // C-N9 — squash merge: every other prerequisite satisfied, so the refusal
  // can only be the content-SHA non-containment on main.
  {
    const scenario = await prepareScenario(context, { name: 'cn9', controls: { drive: 'immediate', merge: 'squash' } });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn9-candidate'));
    await ch.checkAsync('C-N9', 'squash-merged content PR meets every OTHER prerequisite (statuses, production Vercel, staging sync) yet PUBLISHED_MAIN finalization refuses on content-SHA non-containment', async () => {
      const pr = scenario.sim.runIngest(ingestPayload(branch));
      const { fixture, sim, prod } = scenario;
      assertTrue(pr.merged && prod.isExactSha(pr.merge_commit_sha), 'squash-control PR did not merge');
      const mainNow = fixture.rev('main');
      assertTrue(mainNow === pr.merge_commit_sha || fixture.isAncestor(pr.merge_commit_sha, mainNow), 'squash commit is not on main');
      for (const context2 of ['automation/ci', 'automation/opus-gate', 'Vercel']) {
        assertTrue(sim.statusesFor(pr.headSha).some((status) => status.context === context2 && status.state === 'success'),
          `prerequisite missing: ${context2} success on the head`);
      }
      assertTrue(sim.statusesFor(pr.merge_commit_sha).some((status) => status.context === 'Vercel' && status.state === 'success' && status.actor === 'evaluator-vercel'),
        'prerequisite missing: production Vercel on the squash merge commit');
      assertTrue(fixture.isAncestor(pr.merge_commit_sha, fixture.rev('staging')), 'prerequisite missing: staging does not contain the merge commit');
      assertTrue(!fixture.isAncestor(pr.headSha, fixture.rev('main')), 'control broken: squash still contained the content SHA as itself');
      const client = httpClient(scenario.apiUrl);
      let error = null;
      try {
        await prod.finalizeOwnedPr({ repo: REPO, prNumber: pr.number, expectedSha: pr.headSha, terminal: 'PUBLISHED_MAIN', runId: 'cn9', githubClient: client, commentsClient: (p) => client(p).then((value) => (Array.isArray(value) ? value : [])) });
      } catch (caught) { error = caught; }
      assertTrue(error, 'finalizeOwnedPr minted PUBLISHED_MAIN over a squash merge');
      return { refusal: error.message.slice(0, 200) };
    });
    await scenario.cleanup();
  }
  // C-N10 — a prewritten PUBLISHED_MAIN ledger with no boundary evidence fails (also RED mock 5).
  ch.note('C-N10', 'covered by RED mock 5: a prewritten PUBLISHED_MAIN ledger with no merge on the bare remote fails the happy checker', null);
  // C-N11 — owner gha on trusted main.
  {
    const scenario = await prepareScenario(context, {
      name: 'cn11', ownerEnv: null, mainAt: 'staging',
      mutateStaging: (build, git) => {
        fs.writeFileSync(path.join(build, 'ops/exedev-supervisor/owner.txt'), 'gha\n');
        git(['add', '--all']);
        git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'commit', '-m', 'fixture: gha owner']);
      },
    });
    const result = await scenario.runChild(15 * 60_000);
    ch.check('C-N11', 'owner gha on trusted main yields SKIPPED_OWNER with no data branch and no main PR', () => {
      assertTrue(result.code === 0 && result.stdout.includes('SKIPPED_OWNER'), `exit ${result.code}: ${result.stdout.slice(0, 200)}`);
      assertTrue(!scenario.fixture.remoteHeads().some(([name]) => name.startsWith('supervisor/blog-data-')), 'a data branch exists');
      assertTrue(scenario.sim.pulls().length === 0, 'a PR exists');
      return null;
    });
    await scenario.cleanup();
  }
  // C-N12 — LV_CONTENT_SHIP_ENABLED=false.
  {
    const scenario = await prepareScenario(context, { name: 'cn12', contentShip: 'false', controls: { drive: 'immediate' } });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn12-candidate'));
    expectIngestRefusal(ch, 'C-N12', 'LV_CONTENT_SHIP_ENABLED=false makes the ingest/pass path throw before any merge', scenario, ingestPayload(branch), 'contentShip');
    await scenario.cleanup();
  }
  // C-N13 — merged content PR, staging synced, preview Vercel green, production
  // Vercel MISSING: the production monitor must stay non-terminal until its own
  // bound and then return MONITOR_TIMEOUT — proven with the spec-sanctioned
  // injected now/sleep, not by killing a non-terminal child.
  {
    const scenario = await prepareScenario(context, { name: 'cn13', controls: { drive: 'immediate', vercelProd: 'missing' } });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn13-candidate'));
    const pr = scenario.sim.runIngest(ingestPayload(branch));
    ch.check('C-N13-setup', 'control state: merged base=main PR, staging contains the merge, preview Vercel green, production Vercel absent', () => {
      const { fixture, sim } = scenario;
      assertTrue(pr.merged && pr.merge_commit_sha, 'the control never reached a merged content PR');
      assertTrue(fixture.isAncestor(pr.merge_commit_sha, fixture.rev('staging')), 'staging does not contain the merge');
      assertTrue(sim.statusesFor(pr.headSha).some((status) => status.context === 'Vercel' && status.state === 'success'), 'preview Vercel is not green');
      assertTrue(!sim.statusesFor(pr.merge_commit_sha).some((status) => status.context === 'Vercel'), 'a production Vercel status exists (control broken)');
      // Indirect-sync-spawn audit: monitorOwnedPr redispatches through the SYNCHRONOUS production
      // coordinator() only when ci AND gate are both missing past LOST_STATUS_MS; both are posted here.
      const contexts = sim.statusesFor(pr.headSha).map((status) => status.context);
      assertTrue(contexts.includes('automation/ci') && contexts.includes('automation/opus-gate'), `ci/gate missing at the pinned head (${contexts.join(', ')}): monitorOwnedPr would reach its synchronous coordinator redispatch and deadlock the checker`);
      return null;
    });
    await ch.checkAsync('C-N13', 'exported production monitor with injected now/sleep polls non-terminally past MONITOR_LIMIT_MS and returns MONITOR_TIMEOUT — never PUBLISHED_MAIN (primary preview≠live proof)', async () => {
      const { prod } = scenario;
      assertTrue(typeof prod.monitorOwnedPr === 'function',
        'host-run.mjs must export monitorOwnedPr accepting injected { now, sleep } (the spec-sanctioned clock seam) so eventual MONITOR_TIMEOUT is provable');
      assertTrue(Number.isFinite(prod.MONITOR_LIMIT_MS) && prod.MONITOR_LIMIT_MS === 4 * 60 * 60 * 1000, 'MONITOR_LIMIT_MS drifted from the untouched 4h production bound');
      const virtual = { t: 0, polls: 0 };
      const result = await withSimEnv(scenario, async () => {
        const monitored = Promise.resolve(prod.monitorOwnedPr({
          repoRoot: scenario.fixture.clone, repo: REPO, prNumber: pr.number, initialSha: pr.headSha,
          onUpdate: async () => {}, startedAt: 0,
          now: () => virtual.t,
          sleep: async (ms) => { virtual.t += ms; virtual.polls += 1; },
        }));
        monitored.catch(() => {});
        let timer = null;
        const expired = Symbol('monitor-clock-ignored');
        try {
          const winner = await Promise.race([
            monitored,
            new Promise((resolveExpiry) => { timer = setTimeout(() => resolveExpiry(expired), 180_000); }),
          ]);
          if (winner === expired) throw new Error('monitor ignored the injected clock (still running after 3 real minutes)');
          return winner;
        } finally { if (timer) clearTimeout(timer); }
      });
      assertTrue(virtual.t >= scenario.prod.MONITOR_LIMIT_MS, `monitor returned before its own bound (virtual elapsed ${virtual.t}ms)`);
      assertTrue(virtual.polls >= 2, 'monitor did not keep polling non-terminally before the bound');
      assertTrue(result?.terminal === 'MONITOR_TIMEOUT', `monitor terminal was ${result?.terminal}, not MONITOR_TIMEOUT`);
      assertTrue(result?.terminal !== 'PUBLISHED_MAIN' && result?.terminal !== 'MERGED_STAGING', 'a success terminal was minted without production Vercel');
      return { virtualElapsedMs: virtual.t, polls: virtual.polls, terminal: result.terminal };
    });
    await ch.checkAsync('C-N13-sentinel', 'sentinel screams for the merged-but-nonterminal run past the monitor bound', async () => {
      const { prod } = scenario;
      assertTrue(typeof prod.evaluateSentinel === 'function', 'sentinel.mjs must export evaluateSentinel');
      const client = httpClient(scenario.apiUrl);
      const prJson = await client(`/repos/${REPO}/pulls/${pr.number}`);
      const status = await client(`/repos/${REPO}/commits/${pr.headSha}/status`);
      const ledger = {
        schema_version: 1, lease: null,
        runs: [{
          run_id: 'cn13-run', kind: 'blog', state: 'MONITORING_CI', topic_key: 'acceptance-control-topic',
          pr_number: pr.number, head_sha: pr.headSha, sha_history: [], terminal: null, terminal_at: null,
          started_at: new Date(Date.now() - scenario.prod.MONITOR_LIMIT_MS - 60_000).toISOString(),
          updated_at: new Date(Date.now() - scenario.prod.MONITOR_LIMIT_MS - 60_000).toISOString(),
        }],
      };
      const findings = prod.evaluateSentinel({ ledger, observations: new Map([[pr.number, { pr: prJson, status }]]), pidAlive: () => false });
      assertTrue(Array.isArray(findings) && findings.some((finding) => finding.runId === 'cn13-run'),
        'sentinel produced no finding for a run merged to main but non-terminal past the bound (production has the post; the sentinel must scream)');
      return { findings: findings.map((finding) => finding.key) };
    });
    await ch.checkAsync('C-N13-outcome', 'MONITOR_TIMEOUT records a durable candidate outcome via the real coordinator — production recordSupervisorOutcome driven through its EXISTING coordinatorFn seam (bounded async child; the evaluator keeps serving its own loopback double), with production argument mapping, exit 0, durable issue and no orphan asserted', async () => {
      assertTrue(scenario.prod.terminalRequiresCandidateOutcome({ terminal: 'MONITOR_TIMEOUT', topicKey: 'acceptance-control-topic' }) === true, 'production says MONITOR_TIMEOUT requires no durable outcome');
      return recordOutcomeThroughSeam(scenario, {
        runId: 'cn13-run', topicKey: 'acceptance-control-topic', terminal: 'MONITOR_TIMEOUT', reason: 'production Vercel never landed on merge_commit_sha',
      });
    });
    await ch.checkAsync('C-N13b', 'finalizeOwnedPr refuses PUBLISHED_MAIN while production Vercel is missing', async () => {
      const client = httpClient(scenario.apiUrl);
      let refused = false;
      try {
        await scenario.prod.finalizeOwnedPr({ repo: REPO, prNumber: pr.number, expectedSha: pr.headSha, terminal: 'PUBLISHED_MAIN', runId: 'cn13', githubClient: client, commentsClient: (p) => client(p).then((value) => (Array.isArray(value) ? value : [])) });
      } catch { refused = true; }
      assertTrue(refused, 'finalizer accepted PUBLISHED_MAIN without production Vercel');
      return null;
    });
    ch.check('C-N13-secrets', 'shredAndScan result is clean for the control root', () => {
      const { hits } = scenario.shredAndScan({});
      assertTrue(hits.length === 0, `SECRET_LEAKED: ${hits.join(', ')}`);
      return null;
    });
    await scenario.cleanup();
  }
  // C-N14 — genuinely moving pushes at both protected branches are rejected by
  // the pre-receive hook; the protection log is nonempty; SHAs are unchanged.
  {
    const scenario = await prepareScenario(context, { name: 'cn14', controls: { drive: 'immediate' } });
    ch.check('C-N14', 'the double rejects GENUINE ref moves of staging and main: observed hook rejection, nonempty protection log, unchanged SHAs (primary PR-required proof)', () => {
      const { fixture, sim } = scenario;
      const stagingBefore = fixture.rev('staging');
      const mainBefore = fixture.rev('main');
      const looseStaging = fixture.makeLooseCommit('staging');
      const looseMain = fixture.makeLooseCommit('main');
      assertTrue(looseStaging !== stagingBefore && looseMain !== mainBefore, 'loose commits did not differ from the protected tips (push would be a no-op)');
      const first = sim.attemptDirectPush('staging', looseStaging);
      const second = sim.attemptDirectPush('main', looseMain);
      assertTrue(!first.accepted && !second.accepted, 'a protected-branch push was accepted');
      for (const attempt of [first, second]) {
        assertTrue(/GH006|pre-receive|protected/i.test(attempt.stderr), `rejection stderr does not show the protection hook: ${attempt.stderr.slice(0, 200)}`);
      }
      const log = fixture.protectionLog();
      assertTrue(log.length >= 2, `protection log has ${log.length} entries; the hook did not run for both pushes`);
      assertTrue(log.some((line) => line.includes('refs/heads/staging')) && log.some((line) => line.includes('refs/heads/main')),
        'protection log does not name both protected refs');
      assertTrue(fixture.rev('staging') === stagingBefore && fixture.rev('main') === mainBefore, 'a protected SHA changed');
      assertTrue(!sim.events.some((event) => event.type === 'direct-push-accepted'), 'the double recorded an accepted direct push');
      return { rejected: ['staging', 'main'], protectionLogEntries: log.length };
    });
    await scenario.cleanup();
  }
  // Check E — human infrastructure promotion ancestry fixture (2 min; not the happy path).
  {
    const scenario = await prepareScenario(context, { name: 'infra-e', cloneSplit: false, controls: { drive: 'immediate' } });
    ch.check('E-infra', 'human staging→main promotion is a 2-parent merge; immediate PR-shaped back-merge restores main ⊂ staging', () => {
      const { fixture } = scenario;
      const stagingHead = fixture.commitOnStaging((wt) => {
        fs.writeFileSync(path.join(wt, 'scripts/acceptance-infra-change.mjs'), '// human infra change\n');
      }, 'fixture: human infra commit on staging');
      const oldMain = fixture.rev('main');
      const mainMerge = fixture.mergeViaApi({ base: 'main', headSha: stagingHead, method: 'merge', message: 'promote: staging to main' });
      const parents = fixture.parentsOf(mainMerge);
      assertTrue(parents.length === 2 && parents[0] === oldMain && parents[1] === stagingHead,
        `merge parents ${parents.join(',')} != [old-main, exact-staging-head]`);
      assertTrue(fixture.isAncestor(stagingHead, mainMerge) && fixture.isAncestor(mainMerge, fixture.rev('main')), 'promotion ancestry broken');
      assertTrue(!fixture.isAncestor(fixture.rev('main'), fixture.rev('staging')), 'control error: back-merge already satisfied');
      const { headSha } = fixture.buildSyncHead(mainMerge);
      fixture.mergeViaApi({ base: 'staging', headSha, method: 'merge', message: 'sync: main into staging' });
      assertTrue(fixture.isAncestor(fixture.rev('main'), fixture.rev('staging')), 'back-merge did not restore the ancestor invariant');
      return { mainMerge, parents };
    });
    await scenario.cleanup();
  }
  return [ch];
}
