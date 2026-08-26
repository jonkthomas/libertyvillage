// Hitchhiker/deploy controls C-N1–C-N14 (architecture §6.2 N1–N14) plus the
// human-infra promotion ancestry fixture (check E). Eval-owned; FROZEN by
// evals/local-supervisor-acceptance.sha256. None of these calls the live model.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sentinelPost } from './helpers/local-git-fixture.mjs';
import { Checks, assertTrue, runChildCli } from './helpers/acceptance-evidence.mjs';
import { prepareScenario, writeGenerateShim, shimPost, firstBlogImage, REPO } from './local-acceptance-happy.eval.mjs';

const cleanPost = (context, slug) => ({ ...shimPost({ dirty: false, image: firstBlogImage(context.repoRoot) }), slug, publishedAt: '2026-01-01', updatedAt: '2026-01-01' });

const ingestPayload = ({ dataSha, dataBranch }) => ({
  kind: 'blog', data_sha: dataSha, data_branch: dataBranch,
  topic_key: 'acceptance-control-topic', regenerations: 0,
});

function expectIngestRefusal(ch, id, description, scenario, payload, needle) {
  ch.check(id, description, () => {
    const mainBefore = scenario.fixture.rev('main');
    let error = null;
    try { scenario.sim.runIngest(payload); } catch (caught) { error = caught; }
    assertTrue(error, 'ingest was NOT refused');
    if (needle) assertTrue(error.message.includes(needle), `refusal reason drifted: ${error.message}`);
    assertTrue(scenario.fixture.rev('main') === mainBefore, 'main tip moved');
    assertTrue(scenario.sim.pulls().every((pr) => pr.baseRef !== 'main' || !pr.merged), 'a main PR merged');
    return { error: error.message.slice(0, 200) };
  });
}

export async function run(context) {
  const ch = new Checks('live-ship-controls');
  // C-N1 — staging-parented candidate against main (Design A impossibility).
  {
    const scenario = await prepareScenario(context, {
      name: 'cn1', controls: { ingestBase: 'staging' },
      mutateStaging: (build, git) => {
        fs.writeFileSync(path.join(build, 'scripts/evil.mjs'), '// planted hitchhiker\n');
        git(['add', '--all']);
        git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=a@b.c', 'commit', '-m', 'fixture: staging hitchhiker code']);
      },
    });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn1-candidate'));
    expectIngestRefusal(ch, 'C-N1', 'staging-parented branch opened against main is rejected (primary Design-A impossibility proof)',
      scenario, ingestPayload(branch), 'path policy');
    ch.check('C-N1b', 'production validatePullRequest independently rejects the staging-parented file set', () => {
      const files = scenario.fixture.threeDotFiles(scenario.fixture.rev('main'), branch.dataSha);
      const verdict = scenario.prod.validatePaths('blog-live', files);
      assertTrue(!verdict.ok, 'validatePaths accepted hitchhiker files');
      return verdict.errors.slice(0, 3);
    });
    await scenario.cleanup();
  }
  // C-N2 — workflow/coordinator file in the PR file set.
  {
    const scenario = await prepareScenario(context, { name: 'cn2', controls: { injectFile: '.github/workflows/x.yml' } });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn2-candidate'));
    expectIngestRefusal(ch, 'C-N2', "validatePaths('blog-live') refuses a planted workflow file; no merge", scenario, ingestPayload(branch), 'path policy');
    await scenario.cleanup();
  }
  // C-N3 — two-dot posts.json divergence at ingest.
  {
    const scenario = await prepareScenario(context, { name: 'cn3' });
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
  await ch.checkAsync('C-N4', 'kind=promotion is disabled under exedev even with LV_PROMOTION_ENABLED=true', async () => {
    const output = execFileSync(process.execPath, [path.join(context.repoRoot, 'scripts/automation/promotion-control.mjs')], {
      encoding: 'utf8', env: { ...process.env, LV_WEEKLY_OWNER: 'exedev', LV_PROMOTION_ENABLED: 'true' },
    });
    assertTrue(/skipped/.test(output), `promotion-control CLI did not skip: ${output}`);
    return { output: output.trim() };
  });
  // C-N5 — heal of a blog-live PR must never merge staging.
  ch.check('C-N5', 'heal/refresh are keyed by policy.base=main for blog-live; staging merge into a main-bound head is structurally absent', () => {
    const text = fs.readFileSync(path.join(context.repoRoot, 'scripts/automation/coordinator.mjs'), 'utf8');
    assertTrue(/KIND_POLICIES\[[^\]]+\]\.base|policy\.base/.test(text), 'coordinator heal/refresh is not keyed by the kind policy base');
    return null;
  });
  // C-N6 — sync would carry non-blog files into staging.
  {
    const scenario = await prepareScenario(context, { name: 'cn6' });
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
    const scenario = await prepareScenario(context, { name: 'cn7' });
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
    const scenario = await prepareScenario(context, { name: 'cn8' });
    ch.check('C-N8', 'real `coordinator status --context Vercel` throws; the double refuses the POST as well', () => {
      const sha = scenario.fixture.rev('main');
      let failed = false;
      try {
        execFileSync(process.execPath, [
          path.join(scenario.fixture.clone, 'scripts/automation/coordinator.mjs'), 'status',
          '--repo', REPO, '--sha', sha, '--context', 'Vercel', '--state', 'success', '--description', 'forged',
        ], { cwd: scenario.fixture.clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...scenario.env, NODE_OPTIONS: '', LV_ACCEPT_SPAWN_LOG: '' } });
      } catch { failed = true; }
      assertTrue(failed, 'publishStatus accepted the Vercel context');
      assertTrue(!scenario.sim.statusesFor(sha).some((status) => status.context === 'Vercel'), 'a forged Vercel status was stored');
      return null;
    });
    await scenario.cleanup();
  }
  // C-N9 — squash merge of the content PR cannot mint PUBLISHED_MAIN.
  {
    const scenario = await prepareScenario(context, { name: 'cn9', controls: { merge: 'squash', sync: 'none' } });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn9-candidate'));
    await ch.checkAsync('C-N9', 'after a squash merge the content SHA is not contained as itself and PUBLISHED_MAIN finalization refuses', async () => {
      const pr = scenario.sim.runIngest(ingestPayload(branch));
      assertTrue(pr.merged && pr.merge_commit_sha, 'squash-control PR did not merge');
      assertTrue(!scenario.fixture.isAncestor(pr.headSha, scenario.fixture.rev('main')), 'squash still contained the content SHA (control broken)');
      const client = httpClient(scenario.apiUrl);
      let refused = false;
      try {
        await scenario.prod.finalizeOwnedPr({ repo: REPO, prNumber: pr.number, expectedSha: pr.headSha, terminal: 'PUBLISHED_MAIN', runId: 'cn9', githubClient: client, commentsClient: (p) => client(p).then((v) => (Array.isArray(v) ? v : [])) });
      } catch { refused = true; }
      assertTrue(refused, 'finalizeOwnedPr minted PUBLISHED_MAIN over a squash merge');
      return null;
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
    const scenario = await prepareScenario(context, { name: 'cn12', contentShip: 'false' });
    const branch = scenario.fixture.makeDataBranch(cleanPost(context, 'acceptance-cn12-candidate'));
    expectIngestRefusal(ch, 'C-N12', 'LV_CONTENT_SHIP_ENABLED=false makes the ingest/pass path throw before any merge', scenario, ingestPayload(branch), 'contentShip');
    await scenario.cleanup();
  }
  // C-N13 — merged content PR with missing production Vercel stays non-terminal.
  {
    const scenario = await prepareScenario(context, { name: 'cn13', controls: { vercelProd: 'missing' } });
    writeGenerateShim(scenario, { post: shimPost({ dirty: false, image: firstBlogImage(context.repoRoot) }) });
    const handle = {};
    const childPromise = runChildCli({ cloneDir: scenario.fixture.clone, env: scenario.env, deadlineMs: 15 * 60_000, handle });
    await ch.checkAsync('C-N13', 'merged base=main PR with missing production Vercel on merge_commit_sha never terminalizes (primary preview≠live proof)', async () => {
      const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      let merged = null;
      const mergeDeadline = Date.now() + 12 * 60_000;
      while (!merged && Date.now() < mergeDeadline) {
        merged = scenario.sim.events.find((event) => event.type === 'content-merge');
        if (!merged) await sleep(5_000);
      }
      assertTrue(merged, 'the control never reached a merged content PR');
      await sleep(150_000);
      const runRow = scenario.ledgerRows().at(-1);
      assertTrue(runRow && !runRow.terminal, `run terminalized as ${runRow?.terminal} despite missing production Vercel`);
      return { observedNonTerminalState: runRow.state };
    });
    handle.kill?.();
    const result = await childPromise;
    ch.check('C-N13-exit', 'the killed non-terminal run never printed or recorded PUBLISHED_MAIN', () => {
      assertTrue(!result.stdout.includes('PUBLISHED_MAIN:'), 'PUBLISHED_MAIN was printed without production Vercel');
      const finalRow = scenario.ledgerRows().at(-1);
      assertTrue(!finalRow || finalRow.terminal !== 'PUBLISHED_MAIN', 'ledger minted PUBLISHED_MAIN without production Vercel');
      return null;
    });
    await ch.checkAsync('C-N13b', 'finalizeOwnedPr refuses PUBLISHED_MAIN while production Vercel is missing', async () => {
      const pr = scenario.sim.pulls().find((entry) => entry.baseRef === 'main');
      const client = httpClient(scenario.apiUrl);
      let refused = false;
      try {
        await scenario.prod.finalizeOwnedPr({ repo: REPO, prNumber: pr.number, expectedSha: pr.headSha, terminal: 'PUBLISHED_MAIN', runId: 'cn13', githubClient: client, commentsClient: (p) => client(p).then((v) => (Array.isArray(v) ? v : [])) });
      } catch { refused = true; }
      assertTrue(refused, 'finalizer accepted PUBLISHED_MAIN without production Vercel');
      return null;
    });
    scenario.shredAndScan({});
    await scenario.cleanup();
  }
  // C-N14 — direct push of a protected branch is rejected by the double.
  {
    const scenario = await prepareScenario(context, { name: 'cn14', controls: { sync: 'direct-push' } });
    ch.check('C-N14', 'the GitHub double rejects git push of staging and main; protected SHAs unchanged (primary PR-required proof)', () => {
      const stagingBefore = scenario.fixture.rev('staging');
      const mainBefore = scenario.fixture.rev('main');
      scenario.sim.attemptDirectPush('staging', stagingBefore);
      scenario.sim.attemptDirectPush('main', mainBefore);
      const rejects = scenario.sim.events.filter((event) => event.type === 'direct-push-rejected');
      assertTrue(rejects.length === 2, `expected 2 rejections, saw ${rejects.length}`);
      assertTrue(!scenario.sim.events.some((event) => event.type === 'direct-push-accepted'), 'a protected-branch push was accepted');
      assertTrue(scenario.fixture.rev('staging') === stagingBefore && scenario.fixture.rev('main') === mainBefore, 'a protected SHA changed');
      assertTrue(scenario.fixture.protectionLog().length >= 2, 'the protection hook recorded no rejection');
      return { rejects: rejects.map((event) => event.branch) };
    });
    await scenario.cleanup();
  }
  // Check E — human infrastructure promotion ancestry fixture (2 min; not the happy path).
  {
    const scenario = await prepareScenario(context, { name: 'infra-e', cloneSplit: false });
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

function httpClient(apiUrl) {
  return async (apiPath, { method = 'GET', body } = {}) => {
    const response = await fetch(`${apiUrl}${apiPath}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`double ${method} ${apiPath} failed (${response.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}
