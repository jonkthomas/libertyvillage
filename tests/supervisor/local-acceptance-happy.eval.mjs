// Happy-path scenario (LIVE MODEL) + shared happy-evidence verifier for the
// local supervisor acceptance gate. Eval-owned; FROZEN by
// evals/local-supervisor-acceptance.sha256.
//
// The happy path runs the real `node scripts/supervisor/cli.mjs run` as a child
// against the eval-owned bare origin + loopback GitHub double, generates with
// the approved local live route (lv-vercel-acceptance @ ai-gateway.vercel.sh,
// openai-responses, openai/gpt-5.6-sol), and accepts only the full Design C
// chain ending in ledger terminal PUBLISHED_MAIN. Checks A–D and P0–P13 are
// observations of external boundaries (bare refs, HTTP log, statuses actors,
// session JSONL, ledger, spawn log) — never the child's self-report alone.
// P0 asserts the COMPLETE externally-driven event order: the synchronous PR is
// created inside the dispatch handler, but statuses, exact merge-ref
// validation, merge, production Vercel, and the PR-shaped sync happen only
// after the host is observed polling the pinned OPEN head.
import fs from 'node:fs';
import path from 'node:path';
import { assertContainedOrigin } from './helpers/local-git-fixture.mjs';
import {
  APPROVED_LIVE_ROUTE, Checks, REPORT_LANGUAGE, assertLiveRoute, assertTrue,
  lintInvocation, pathContains, readSpawnLog,
} from './helpers/acceptance-evidence.mjs';
import { REPO, liveGenerationChecks, prepareScenario } from './helpers/acceptance-scenario.mjs';

export { REPO };
const BLOG_FILE = /^data\/posts\.json$|^public\/images\/blog\//;

export function verifyHappyEvidence(scenario, ev, ch) {
  const { fixture, sim, prod } = scenario;
  const runRow = ev.runRow;
  ch.check('C0', 'resolve/plan candidate reads preceded the first content mutation (ingest dispatch)', () => {
    const firstRead = sim.requests.findIndex((entry) => entry.method === 'GET' && entry.path.includes('/issues'));
    const firstDispatch = sim.requests.findIndex((entry) => entry.method === 'POST' && entry.path.endsWith('/dispatches'));
    assertTrue(firstRead >= 0 && firstDispatch > firstRead, `read@${firstRead} dispatch@${firstDispatch}`);
    return null;
  });
  ch.check('P0', 'complete event order: dispatch → sync PR create → host pins OPEN head (no statuses yet) → publish statuses + preview Vercel → host observes statuses → exact merge-ref validation → merge → production Vercel → PR-shaped sync', () => {
    const head = ev.contentPr?.headSha;
    assertTrue(head, 'no content PR head to order events around');
    const seq = sim.events;
    const at = (type, filter = () => true) => seq.findIndex((event) => event.type === type && filter(event));
    const order = [
      ['dispatch', at('dispatch', (event) => event.event_type === 'supervisor-ingest-blog')],
      ['ingest-pr-created', at('ingest-pr-created', (event) => event.sha === head)],
      ['host-observed-pinned-head', at('host-observed-pinned-head', (event) => event.number === ev.contentPr.number)],
      ['status:ci@head', at('status', (event) => event.sha === head && event.context === 'automation/ci' && event.state === 'success')],
      ['status:gate@head', at('status', (event) => event.sha === head && event.context === 'automation/opus-gate' && event.state === 'success')],
      ['status:vercel@head', at('status', (event) => event.sha === head && event.context === 'Vercel' && event.state === 'success')],
      ['host-observed-head-statuses', at('host-observed-head-statuses', (event) => event.number === ev.contentPr.number)],
      ['merge-ref-validated', at('merge-ref-validated', (event) => event.headSha === head)],
      ['content-merge', at('content-merge', (event) => event.number === ev.contentPr.number)],
      ['status:vercel@merge', at('status', (event) => event.sha === ev.contentPr.merge_commit_sha && event.context === 'Vercel')],
    ];
    const syncIndex = Math.max(at('sync-merge'), at('sync-noop'));
    order.push(['sync', syncIndex]);
    let previous = -1;
    for (const [label, index] of order) {
      assertTrue(index >= 0, `event missing from the lifecycle: ${label}`);
      assertTrue(index > previous, `event out of order: ${label} at ${index} did not follow its predecessor at ${previous}`);
      previous = index;
    }
    const pinned = seq[order[2][1]];
    assertTrue(pinned.prState === 'open' && pinned.merged === false, `host observed a ${pinned.prState}/merged=${pinned.merged} PR, not an open unmerged one`);
    assertTrue(pinned.statusesAtObservation === 0, `${pinned.statusesAtObservation} statuses already existed when the host pinned the head`);
    const refCheck = seq[order[7][1]];
    assertTrue(refCheck.parents.length === 2 && refCheck.parents[0] === refCheck.mainSha && refCheck.parents[1] === head,
      `synthetic merge-ref parents drifted: [${refCheck.parents.join(', ')}]`);
    assertTrue(refCheck.mainSha === ev.mainBefore, `merge-ref validated against ${refCheck.mainSha}, not the live pre-merge main ${ev.mainBefore}`);
    return { order: order.map(([label, index]) => `${label}@${index}`) };
  });
  ch.check('P1', 'Actions-authored PR: base=main, head blog/auto-*, bot author, exact head', () => {
    const pr = ev.contentPr;
    assertTrue(pr, 'no content PR exists in the double');
    assertTrue(pr.baseRef === 'main', `PR base is ${pr.baseRef}`);
    assertTrue(/^blog\/auto-/.test(pr.headRef), `PR head is ${pr.headRef}`);
    assertTrue(pr.author === 'github-actions[bot]', `PR author is ${pr.author}`);
    assertTrue(prod.isExactSha(pr.headSha), 'PR head SHA is not exact');
    return { number: pr.number, head: pr.headRef, sha: pr.headSha };
  });
  ch.check('P2', 'PR files are blog-only and non-empty', () => {
    const files = ev.contentPr.files;
    assertTrue(files.length >= 1, 'PR has no files');
    assertTrue(files.every((file) => BLOG_FILE.test(file)), `non-blog PR file: ${files.join(', ')}`);
    return files;
  });
  ch.check('P3', 'head parent is the pre-ship main SHA', () => {
    const parents = fixture.parentsOf(ev.contentPr.headSha);
    assertTrue(parents.length === 1 && parents[0] === ev.mainBefore, `head parents ${parents.join(',')} != pre-ship main ${ev.mainBefore}`);
    return parents;
  });
  ch.check('P4', 'automation/ci + automation/opus-gate success on the exact head via the coordinator double', () => {
    const list = sim.statusesFor(ev.contentPr.headSha);
    for (const context of ['automation/ci', 'automation/opus-gate']) {
      assertTrue(list.some((status) => status.context === context && status.state === 'success' && status.actor === 'coordinator-double'),
        `missing coordinator ${context} success on head`);
    }
    return null;
  });
  ch.check('P5', 'Vercel success on the head was evaluator-owned and never a coordinator POST', () => {
    const list = sim.statusesFor(ev.contentPr.headSha);
    assertTrue(list.some((status) => status.context === 'Vercel' && status.state === 'success' && status.actor === 'evaluator-vercel'),
      'missing evaluator-owned Vercel success on head');
    assertTrue(!sim.coordinatorPostedVercel(), 'a coordinator actor posted the Vercel context');
    return null;
  });
  ch.check('P5b', 'Vercel success on the main merge_commit_sha (production), evaluator-owned; main agrees', () => {
    const merge = ev.contentPr.merge_commit_sha;
    assertTrue(prod.isExactSha(merge), 'no exact merge_commit_sha');
    const list = sim.statusesFor(merge);
    assertTrue(list.some((status) => status.context === 'Vercel' && status.state === 'success' && status.actor === 'evaluator-vercel'),
      'missing evaluator-owned Vercel success on merge_commit_sha');
    const mainAfter = fixture.rev('main');
    assertTrue(mainAfter === merge || fixture.isAncestor(merge, mainAfter), 'live main does not contain the merge commit');
    return { merge };
  });
  ch.check('P6', 'main contains the content SHA through a 2-parent merge (never squash)', () => {
    assertTrue(fixture.isAncestor(ev.contentPr.headSha, fixture.rev('main')), 'content SHA is not an ancestor of main');
    const parents = fixture.parentsOf(ev.contentPr.merge_commit_sha);
    assertTrue(parents.length === 2 ? parents.includes(ev.contentPr.headSha) : ev.contentPr.merge_commit_sha === ev.contentPr.headSha,
      `merge commit parents ${parents.join(',')} do not carry the content SHA`);
    return parents;
  });
  ch.check('P7', 'staging advanced by blog paths only', () => {
    const delta = fixture.diffNames(ev.stagingBefore, fixture.rev('staging'));
    assertTrue(delta.every((file) => BLOG_FILE.test(file)), `non-blog staging delta: ${delta.join(', ')}`);
    return delta;
  });
  ch.check('P8', 'main is an ancestor of staging after the run', () => {
    assertTrue(fixture.isAncestor(fixture.rev('main'), fixture.rev('staging')), 'ancestor invariant broken');
    return null;
  });
  ch.check('P9', 'two-dot blog-path diff main vs staging is empty', () => {
    const delta = fixture.diffNames(fixture.rev('main'), fixture.rev('staging'), ['data/posts.json', 'public/images/blog/']);
    assertTrue(delta.length === 0, `blog-path drift: ${delta.join(', ')}`);
    return null;
  });
  ch.check('P10', 'durable ledger: exactly one run row, monotonic timestamps, exact topic/staging/PR/head/session fields, lease and locks released', () => {
    assertTrue(runRow, 'no ledger row for the run');
    assertTrue(Array.isArray(ev.ledger.runs) && ev.ledger.runs.length === 1, `${ev.ledger.runs?.length} ledger rows exist; expected exactly one`);
    assertTrue(runRow.state === 'TERMINAL' && runRow.terminal === 'PUBLISHED_MAIN', `terminal is ${runRow.terminal} (${runRow.state})`);
    assertTrue(runRow.terminal !== 'MERGED_STAGING', 'MERGED_STAGING is not happy-path success');
    assertTrue(runRow.pr_state === 'closed', `pr_state is ${runRow.pr_state}`);
    const started = Date.parse(runRow.started_at);
    const terminalAt = Date.parse(runRow.terminal_at);
    const updatedAt = Date.parse(runRow.updated_at);
    assertTrue(Number.isFinite(started) && Number.isFinite(terminalAt) && Number.isFinite(updatedAt), 'run timestamps are not parseable');
    let cursor = started;
    for (const entry of runRow.sha_history || []) {
      const at = Date.parse(entry.at);
      assertTrue(Number.isFinite(at) && at >= cursor, `sha_history timestamp regressed at ${entry.sha}`);
      cursor = at;
    }
    assertTrue(terminalAt >= cursor && updatedAt >= started, 'terminal/updated timestamps are not monotonic with the run');
    const dispatch = sim.events.find((event) => event.type === 'dispatch' && event.event_type === 'supervisor-ingest-blog');
    assertTrue(dispatch, 'no ingest dispatch payload to compare exact fields against');
    assertTrue(runRow.topic_key === dispatch.payload.topic_key, `ledger topic ${runRow.topic_key} != dispatched topic ${dispatch.payload.topic_key}`);
    assertTrue(runRow.data_sha === dispatch.payload.data_sha && runRow.data_branch === dispatch.payload.data_branch,
      'ledger data branch/SHA differ from the dispatched payload');
    assertTrue(runRow.trusted_staging_sha === ev.stagingBefore, `trusted_staging_sha ${runRow.trusted_staging_sha} != fixture staging ${ev.stagingBefore}`);
    assertTrue(runRow.pr_number === ev.contentPr.number, `ledger pr_number ${runRow.pr_number} != ${ev.contentPr.number}`);
    assertTrue(runRow.head_sha === ev.contentPr.headSha, `ledger head_sha ${runRow.head_sha} != ${ev.contentPr.headSha}`);
    assertTrue(pathContains(path.join(scenario.stateDir, 'pi-sessions'), runRow.pi_session_file), 'ledger session path is outside the scenario state root');
    assertTrue(ev.ledger.lease === null || ev.ledger.lease === undefined, 'ledger lease was not released');
    assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'run.owner')), 'run.owner lock remains');
    assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'ledger.json.write-lock')), 'ledger write lock remains');
    return { run_id: runRow.run_id, topic_key: runRow.topic_key };
  });
  ch.check('P11', 'owned data branch and supervisor worktree gone; every unrelated ref is byte-for-byte unchanged', () => {
    const heads = new Map(fixture.remoteHeads());
    assertTrue(![...heads.keys()].some((name) => name.startsWith('supervisor/blog-data-')), 'owned data branch still exists');
    assertTrue(ev.headsBefore, 'no pre-run ref snapshot exists to compare unrelated refs against');
    for (const [name, sha] of ev.headsBefore) {
      if (name === 'main' || name === 'staging' || name.startsWith('supervisor/blog-data-')) continue;
      assertTrue(heads.get(name) === sha, `unrelated ref moved or vanished: ${name} was ${sha}, is ${heads.get(name)}`);
    }
    for (const name of heads.keys()) {
      const allowed = name === 'main' || name === 'staging' || /^blog\/auto-/.test(name) || /^sync\/main-/.test(name)
        || ev.headsBefore.has(name);
      assertTrue(allowed, `unexpected ref appeared: ${name}`);
    }
    assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'work', runRow.run_id)), 'supervisor worktree directory remains');
    const worktrees = fixture.cloneGit(['worktree', 'list', '--porcelain']).split('\n\n').filter(Boolean);
    assertTrue(worktrees.length === 1, `acceptance worktree leaked: ${worktrees.length} entries`);
    return null;
  });
  ch.check('P12', 'dispatch kinds: exactly one supervisor-ingest-blog, blog-live coordinated, zero promotion', () => {
    const ingests = sim.events.filter((event) => event.type === 'dispatch' && event.event_type === 'supervisor-ingest-blog');
    assertTrue(ingests.length === 1, `${ingests.length} ingest dispatches`);
    const kinds = sim.dispatchKinds().filter(Boolean);
    assertTrue(kinds.includes('blog-live'), 'no blog-live coordinator dispatch recorded');
    assertTrue(!kinds.includes('promotion'), 'a kind=promotion dispatch occurred');
    return kinds;
  });
  ch.check('P13', 'staging advanced only via the merged Actions-authored sync PR: bot author, exact sync-head statuses, blog-only file set, merge ancestry; no successful direct push', () => {
    const sync = sim.events.find((event) => event.type === 'sync-merge') || sim.events.find((event) => event.type === 'sync-noop');
    assertTrue(sync, 'no PR-shaped sync (or no-op) was recorded');
    if (sync.type === 'sync-merge') {
      const pr = [...sim.issues.values()].find((entry) => entry.pull && entry.number === sync.number);
      assertTrue(pr.baseRef === 'staging' && /^sync\/main-/.test(pr.headRef) && pr.merged, 'sync PR identity drifted');
      assertTrue(pr.author === 'github-actions[bot]', `sync PR author is ${pr.author}`);
      assertTrue(sync.method === 'merge', `sync merge method was ${sync.method}`);
      const syncStatuses = sim.statusesFor(pr.headSha);
      for (const context of ['automation/ci', 'automation/opus-gate']) {
        assertTrue(syncStatuses.some((status) => status.context === context && status.state === 'success' && status.actor === 'coordinator-double'),
          `missing coordinator ${context} success on the exact sync head`);
      }
      assertTrue(!syncStatuses.some((status) => status.context === 'Vercel'), 'a Vercel status was posted on the sync head');
      assertTrue(pr.files.every((file) => BLOG_FILE.test(file)), `non-blog sync PR file: ${pr.files.join(', ')}`);
      const newStaging = fixture.rev('staging');
      assertTrue(sync.merge_commit_sha === newStaging || fixture.isAncestor(sync.merge_commit_sha, newStaging), 'staging tip does not carry the sync merge');
      assertTrue(sync.parents.length === 2 && sync.parents[0] === sync.oldStaging && sync.parents[1] === pr.headSha,
        `sync merge ancestry drifted: [${sync.parents.join(', ')}] != [old staging, sync head]`);
    }
    assertTrue(!sim.events.some((event) => event.type === 'direct-push-accepted'), 'a direct protected-branch push succeeded');
    assertTrue(fixture.isAncestor(ev.contentPr.headSha, fixture.rev('staging')), 'staging does not contain the content SHA');
    return { via: sync.type };
  });
  ch.note('NOTE-doubled', REPORT_LANGUAGE.doubled, null);
  return ch;
}

export async function run(context) {
  const ch = new Checks('happy');
  let scenario = null;
  let result = null;
  try {
    for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
      context.budget.claim('happy', attempt);
      assertLiveRoute({ provider: APPROVED_LIVE_ROUTE.provider, model: APPROVED_LIVE_ROUTE.model, baseUrl: APPROVED_LIVE_ROUTE.baseUrl });
      const candidate = await prepareScenario(context, { name: `happy-a${attempt}`, pi: { live: true } });
      candidate.headsBefore = new Map(candidate.fixture.remoteHeads());
      const attemptResult = await candidate.runChild(25 * 60_000);
      if (attemptResult.code === 0 && /PUBLISHED_MAIN: /.test(attemptResult.stdout)) {
        scenario = candidate; result = attemptResult;
      } else {
        ch.note(`attempt-${attempt}`, `live attempt failed (exit ${attemptResult.code}, deadline=${attemptResult.deadlineHit})`, attemptResult.stderr.slice(-1500));
        const failedScan = candidate.shredAndScan({ stdout: attemptResult.stdout, stderr: attemptResult.stderr });
        await candidate.cleanup();
        if (failedScan.hits.length) throw new Error(`SECRET_LEAKED after a failed live attempt: ${failedScan.hits.join(', ')}`);
        if (attempt === 2) throw new Error('happy path never reached PUBLISHED_MAIN within the live-attempt budget');
      }
    }
    const { fixture, prod, sim } = scenario;
    const ledger = fs.existsSync(scenario.ledgerFile) ? prod.readLedger(scenario.ledgerFile) : { runs: [], lease: null };
    const runRow = ledger.runs.at(-1);
    const contentPr = sim.pulls().find((entry) => entry.baseRef === 'main' && /^blog\/auto-/.test(entry.headRef));
    const ev = {
      exit: result, ledger, runRow, contentPr,
      mainBefore: fixture.baseSha, stagingBefore: fixture.stagingSha, headsBefore: scenario.headsBefore,
    };
    const { shredded, hits } = scenario.shredAndScan({ stdout: result.stdout, stderr: result.stderr });
    scenario.retain(context.reportDir, 'happy', {
      'child-stdout.txt': result.stdout, 'child-stderr.txt': result.stderr,
      'spawn-log.jsonl': fs.existsSync(scenario.spawnLog) ? fs.readFileSync(scenario.spawnLog, 'utf8') : '',
    });
    ch.check('A1', 'clone origin is a contained local path; GitHub is loopback', () => {
      const origin = assertContainedOrigin(fixture.clone, scenario.root);
      assertTrue(scenario.apiUrl.startsWith('http://127.0.0.1:'), `api url ${scenario.apiUrl}`);
      return { origin };
    });
    ch.check('A2', 'child env is allowlist-built: fake token only, no inherited GitHub credentials', () => {
      assertTrue(scenario.env.GH_TOKEN === 'test-token' && !('GITHUB_TOKEN' in scenario.env) && !('GH_HOST' in scenario.env),
        'child env carries non-fake GitHub configuration');
      assertTrue(scenario.env.LV_EXE_GITHUB_PROXY_AUTH === 'false', 'happy path must run CLI GitHub calls with proxy auth false');
      return null;
    });
    ch.check('A3', 'fixture remote already satisfies the Design C graph invariant', () => {
      assertTrue(fixture.isAncestor(ev.mainBefore, ev.stagingBefore), 'fixture ancestor invariant does not hold');
      return null;
    });
    ch.check('A4', 'live child route is exactly the approved local route', () => {
      assertLiveRoute({ provider: scenario.env.PI_PROVIDER, model: scenario.env.PI_MODEL, baseUrl: scenario.env.PI_BASE_URL });
      return { provider: scenario.env.PI_PROVIDER, model: scenario.env.PI_MODEL, baseUrl: scenario.env.PI_BASE_URL };
    });
    ch.check('D1', 'child exits 0 printing PUBLISHED_MAIN: <run-id>', () => {
      assertTrue(result.code === 0, `exit ${result.code}`);
      const match = result.stdout.match(/PUBLISHED_MAIN: (\S+)/);
      assertTrue(match && runRow && match[1] === runRow.run_id, 'stdout run id does not match the ledger row');
      return match[1];
    });
    liveGenerationChecks({ scenario, runRow, stagingBefore: ev.stagingBefore, ch, prefix: 'B', context });
    ch.check('B6', 'submitted candidate also matches the PR head post byte-for-byte', () => {
      const headPosts = JSON.parse(fixture.show(ev.contentPr.headSha, 'data/posts.json'));
      const shipped = JSON.parse(fixture.show(runRow.data_sha, 'data/posts.json'));
      assertTrue(JSON.stringify(headPosts.at(-1)) === JSON.stringify(shipped.at(-1)), 'PR head post differs from the submitted data commit');
      return null;
    });
    ch.check('B7', 'auth.json shredded before retention; literal PI_API_KEY appears in no retained evidence, HTTP log, or simulator events', () => {
      assertTrue(shredded === true || !process.env.PI_API_KEY, 'auth.json was not present to shred');
      assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'pi-runtime', 'auth.json')), 'auth.json survived the shred');
      assertTrue(hits.length === 0, `SECRET_LEAKED: ${hits.join(', ')}`);
      return null;
    });
    ch.check('C2', 'baseline gates all ran in order before generation', () => {
      const entries = readSpawnLog(scenario.spawnLog);
      const seen = ['ci', 'lint:automation', 'lint:supervisor', 'test:automation', 'test:supervisor'];
      const observed = [];
      for (const entry of entries) {
        const argv = entry.argv || [];
        const npmIndex = argv.findIndex((part) => /npm-cli\.js$/.test(String(part)));
        if (npmIndex >= 0) {
          const rest = argv.slice(npmIndex + 1).filter((part) => !String(part).startsWith('-'));
          if (rest[0] === 'ci') observed.push('ci');
          if (rest[0] === 'run' && seen.includes(rest[1])) observed.push(rest[1]);
        }
      }
      for (const [index, step] of seen.entries()) {
        assertTrue(observed.indexOf(step) >= 0, `baseline step never ran: ${step}`);
        if (index > 0) assertTrue(observed.indexOf(step) > observed.indexOf(seen[index - 1]), `baseline order broke at ${step}`);
      }
      const lint = lintInvocation(entries, path.join(scenario.stateDir, 'work'));
      assertTrue(lint && lint.cwd.includes(path.join('state', 'work')), 'lint cwd was not the staging worktree');
      return { observed };
    });
    verifyHappyEvidence(scenario, ev, ch);
    await scenario.cleanup();
  } catch (error) {
    ch.check('HAPPY', 'happy path reached PUBLISHED_MAIN with full boundary evidence', () => { throw error; });
    if (scenario) { try { await scenario.cleanup(); } catch { /* best effort */ } }
  }
  return [ch];
}
