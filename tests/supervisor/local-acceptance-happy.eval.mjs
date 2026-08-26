// Happy-path scenario (LIVE MODEL) + shared scenario runner for the local
// supervisor acceptance gate. Eval-owned; FROZEN by
// evals/local-supervisor-acceptance.sha256.
//
// The happy path runs the real `node scripts/supervisor/cli.mjs run` as a child
// against the eval-owned bare origin + loopback GitHub double, generates with
// the approved local live route (lv-vercel-acceptance @ ai-gateway.vercel.sh,
// openai-responses, openai/gpt-5.6-sol), and accepts only the full Design C
// chain ending in ledger terminal PUBLISHED_MAIN. Checks A–D and P1–P13 are
// observations of external boundaries (bare refs, HTTP log, statuses actors,
// session JSONL, ledger, spawn log) — never the child's self-report alone.
import fs from 'node:fs';
import path from 'node:path';
import { assertContainedOrigin, createFixture } from './helpers/local-git-fixture.mjs';
import { createSupervisorGithub } from './helpers/fake-supervisor-github.mjs';
import {
  APPROVED_LIVE_ROUTE, Checks, REPORT_LANGUAGE, assertLiveRoute, assertTrue,
  childEnv, loadProd, parsePiSessionTools, readSpawnLog, runChildCli,
  scanForLiteral, shredFile, spawnEntriesFor, writeModelsJson, writeSpawnLogger,
} from './helpers/acceptance-evidence.mjs';

export const REPO = 'acceptance/libertyvillage';
const BLOG_FILE = /^data\/posts\.json$|^public\/images\/blog\//;

export async function prepareScenario(context, {
  name, mutateStaging = null, controls = {}, pi = null, proxyAuth = 'false',
  ownerEnv = 'exedev', contentShip, cloneSplit = true, stagingSentinel = true, seedIssue = true, mainAt = 'base',
} = {}) {
  const root = fs.mkdtempSync(path.join(context.tmpBase, `scn-${name}-`));
  fs.chmodSync(root, 0o700);
  const fixture = createFixture({ root, sourceRepo: context.repoRoot, sourceSha: context.sourceSha, mutateStaging, cloneSplit, stagingSentinel, mainAt });
  const prod = await loadProd(context.repoRoot);
  const childEnvLike = { LV_WEEKLY_OWNER: ownerEnv ?? undefined, LV_CONTENT_SHIP_ENABLED: contentShip };
  const sim = createSupervisorGithub({ repo: REPO, fixture, prod, controls, childEnvLike });
  const apiUrl = await sim.listen();
  if (seedIssue && prod.renderCandidateState && prod.emptyCandidateState) sim.seedCandidateStateIssue();
  const stateDir = path.join(root, 'state');
  const home = path.join(root, 'home');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const { loggerPath, spawnLog } = writeSpawnLogger(path.join(root, 'observe'));
  const piEnv = pi === null ? {} : {
    provider: pi.provider ?? APPROVED_LIVE_ROUTE.provider,
    model: pi.model ?? APPROVED_LIVE_ROUTE.model,
    baseUrl: pi.baseUrl ?? APPROVED_LIVE_ROUTE.baseUrl,
    apiKey: pi.apiKey ?? process.env.PI_API_KEY,
    sdkPath: pi.sdkPath ?? process.env.PI_SDK_PATH,
  };
  if (pi && pi.models !== false) writeModelsJson(path.join(stateDir, 'pi-runtime'), pi.modelsOverride);
  assertContainedOrigin(fixture.clone, root);
  const scenario = {
    name, root, fixture, prod, sim, apiUrl, stateDir, home,
    ledgerFile: path.join(stateDir, 'ledger.json'),
    spawnLog, piEnv,
    env: childEnv({
      apiUrl, stateDir, ledger: path.join(stateDir, 'ledger.json'), repo: REPO, home,
      spawnLog, loggerPath, proxyAuth, ownerEnv, contentShip, npmCache: context.npmCache, pi: piEnv,
    }),
    runChild: (deadlineMs) => runChildCli({ cloneDir: fixture.clone, env: scenario.env, deadlineMs }),
    ledgerRows() {
      if (!fs.existsSync(scenario.ledgerFile)) return [];
      try { return prod.readLedger(scenario.ledgerFile).runs; }
      catch { return JSON.parse(fs.readFileSync(scenario.ledgerFile, 'utf8')).runs || []; }
    },
    sessionFiles() {
      const dir = path.join(stateDir, 'pi-sessions');
      return fs.existsSync(dir) ? fs.readdirSync(dir).map((file) => path.join(dir, file)) : [];
    },
    shredAndScan(streams = {}) {
      const shredded = shredFile(path.join(stateDir, 'pi-runtime', 'auth.json'));
      const files = [scenario.ledgerFile, ...scenario.sessionFiles(), scenario.spawnLog];
      const hits = scanForLiteral({ files, strings: streams, literal: process.env.PI_API_KEY });
      return { shredded, hits };
    },
    retain(reportDir, label, extra = {}) {
      const dir = path.join(reportDir, label);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      for (const file of [scenario.ledgerFile, ...scenario.sessionFiles()]) {
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, path.basename(file)));
      }
      fs.writeFileSync(path.join(dir, 'http-requests.json'), `${JSON.stringify(scenario.sim.requests, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, 'sim-events.json'), `${JSON.stringify(scenario.sim.events, null, 2)}\n`);
      for (const [file, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, file), text ?? '');
      return dir;
    },
    async cleanup() {
      await sim.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return scenario;
}

// Writes the evaluator-owned generateWithPi shim into a scenario CLONE only
// (serial N3/N4, mutation M138, hitchhiker C-N13). Explicitly NOT generation
// proof; it never counts against the live budget and never claims a live route.
export function writeGenerateShim(scenario, { post }) {
  const dir = path.join(scenario.fixture.clone, 'scripts/supervisor');
  fs.renameSync(path.join(dir, 'pi-session.mjs'), path.join(dir, 'pi-session.real.mjs'));
  fs.writeFileSync(path.join(dir, 'acceptance-shim-post.json'), `${JSON.stringify(post, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'pi-session.mjs'), [
    '// EVALUATOR-OWNED clone-local shim (serial N3 boundary test; not generation proof).',
    "export * from './pi-session.real.mjs';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { validateSubmittedPost } from './pi-session.real.mjs';",
    'export async function generateWithPi({ sessionsDir, topic }) {',
    "  const post = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'acceptance-shim-post.json'), 'utf8'));",
    "  post.publishedAt = new Date().toISOString().slice(0, 10); post.updatedAt = post.publishedAt;",
    '  const checked = validateSubmittedPost(post, topic, topic.key);',
    "  if (!checked.ok) throw new Error(`shim post failed validateSubmittedPost: ${checked.errors.join('; ')}`);",
    '  fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });',
    "  const sessionFile = path.join(sessionsDir, `shim-${Date.now()}.jsonl`);",
    "  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: 'acceptance-shim', note: 'not a live session' })}\\n`);",
    '  return { post, sessionFile };',
    '}',
    '',
  ].join('\n'));
}

export function shimPost({ dirty, image }) {
  const body = dirty
    ? 'Neighbourhood notes. **Acceptance Fictitious Cafe** pours espresso for $4.25 and stays open 7 am to 9 pm daily, per its own posted menu board and signage.'
    : 'Liberty Village keeps a steady weekly rhythm, and this overview simply links the reader to guides the site has already published without asserting any new venue details.';
  return {
    slug: dirty ? 'acceptance-serial-n3-candidate' : 'acceptance-clean-candidate',
    title: dirty ? 'Acceptance Serial N3 Candidate' : 'Acceptance Clean Candidate',
    description: body, content: `${body}\n\n${body}`, answerBlock: body,
    publishedAt: '2026-01-01', updatedAt: '2026-01-01', category: 'community',
    image, author: 'LibertyVillage.co',
    tags: ['liberty-village', 'community', 'weekly', 'notes'],
    faqs: [1, 2, 3, 4].map((n) => ({ question: `Question ${n} about the neighbourhood?`, answer: 'The site keeps grounded answers in its published guides.' })),
    relatedServices: [], relatedTopics: [], relatedPosts: [],
    keyTakeaways: ['One', 'Two', 'Three', 'Four'].map((n) => `${n} grounded takeaway with no venue specifics.`),
  };
}

export function firstBlogImage(repoRoot) {
  const dir = path.join(repoRoot, 'public/images/blog');
  const file = fs.readdirSync(dir).filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name)).sort()[0];
  assertTrue(file, 'no committed blog image exists under public/images/blog');
  return `/images/blog/${file}`;
}

export function verifyHappyEvidence(scenario, ev, ch) {
  const { fixture, sim, prod } = scenario;
  const runRow = ev.runRow;
  ch.check('C0', 'resolve/plan candidate reads preceded the first content mutation (ingest dispatch)', () => {
    const firstRead = sim.requests.findIndex((entry) => entry.method === 'GET' && entry.path.includes('/issues'));
    const firstDispatch = sim.requests.findIndex((entry) => entry.method === 'POST' && entry.path.endsWith('/dispatches'));
    assertTrue(firstRead >= 0 && firstDispatch > firstRead, `read@${firstRead} dispatch@${firstDispatch}`);
    return null;
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
  ch.check('P10', 'durable ledger: single TERMINAL/PUBLISHED_MAIN row, closed PR, lease and owner lock released', () => {
    assertTrue(runRow, 'no ledger row for the run');
    assertTrue(runRow.state === 'TERMINAL' && runRow.terminal === 'PUBLISHED_MAIN', `terminal is ${runRow.terminal} (${runRow.state})`);
    assertTrue(runRow.terminal !== 'MERGED_STAGING', 'MERGED_STAGING is not happy-path success');
    assertTrue(runRow.pr_state === 'closed', `pr_state is ${runRow.pr_state}`);
    assertTrue(ev.ledger.lease === null || ev.ledger.lease === undefined, 'ledger lease was not released');
    assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'run.owner')), 'run.owner lock remains');
    assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'ledger.json.write-lock')), 'ledger write lock remains');
    return { run_id: runRow.run_id, topic_key: runRow.topic_key };
  });
  ch.check('P11', 'owned data branch and supervisor worktree are gone; unrelated refs untouched', () => {
    const heads = fixture.remoteHeads().map(([name]) => name);
    assertTrue(!heads.some((name) => name.startsWith('supervisor/blog-data-')), 'owned data branch still exists');
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
  ch.check('P13', 'staging advanced only via the merged Actions-authored sync PR (or was already contained); no successful direct push', () => {
    const sync = sim.events.find((event) => event.type === 'sync-merge') || sim.events.find((event) => event.type === 'sync-noop');
    assertTrue(sync, 'no PR-shaped sync (or no-op) was recorded');
    if (sync.type === 'sync-merge') {
      const pr = [...sim.issues.values()].find((entry) => entry.pull && entry.number === sync.number);
      assertTrue(pr.baseRef === 'staging' && /^sync\/main-/.test(pr.headRef) && pr.merged, 'sync PR identity drifted');
      assertTrue(sync.method === 'merge', `sync merge method was ${sync.method}`);
    }
    assertTrue(!sim.events.some((event) => event.type === 'direct-push-accepted'), 'a direct protected-branch push succeeded');
    assertTrue(fixture.isAncestor(ev.contentPr.headSha, fixture.rev('staging')), 'staging does not contain the content SHA');
    return { via: sync.type };
  });
  ch.note('NOTE-doubled', REPORT_LANGUAGE.doubled, null);
  ch.note('NOTE-dialect', REPORT_LANGUAGE.dialect, null);
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
      const attemptResult = await candidate.runChild(25 * 60_000);
      if (attemptResult.code === 0 && /PUBLISHED_MAIN: /.test(attemptResult.stdout)) {
        scenario = candidate; result = attemptResult;
      } else {
        ch.note(`attempt-${attempt}`, `live attempt failed (exit ${attemptResult.code}, deadline=${attemptResult.deadlineHit})`, attemptResult.stderr.slice(-1500));
        candidate.shredAndScan({});
        if (attempt === 2) { await candidate.cleanup(); throw new Error('happy path never reached PUBLISHED_MAIN within the live-attempt budget'); }
        await candidate.cleanup();
      }
    }
    const { fixture, sim, prod } = scenario;
    const ledger = fs.existsSync(scenario.ledgerFile) ? prod.readLedger(scenario.ledgerFile) : { runs: [], lease: null };
    const runRow = ledger.runs.at(-1);
    const contentPr = sim.pulls().find((entry) => entry.baseRef === 'main' && /^blog\/auto-/.test(entry.headRef));
    const ev = {
      exit: result, ledger, runRow, contentPr,
      mainBefore: fixture.baseSha, stagingBefore: fixture.stagingSha,
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
    ch.check('B1', 'live Pi session JSONL exists under the scenario state root and matches the ledger', () => {
      const sessions = scenario.sessionFiles();
      assertTrue(sessions.length >= 1, 'no session JSONL under <state>/pi-sessions');
      assertTrue(runRow.pi_session_file && sessions.includes(runRow.pi_session_file), 'ledger session path is not under the scenario state root');
      return { sessionFile: runRow.pi_session_file, bytes: fs.statSync(runRow.pi_session_file).size };
    });
    ch.check('B2', 'JSONL-derived tool contract: subset of the allowlist, submit_candidate accepted, context tool used', () => {
      const parsed = parsePiSessionTools(runRow.pi_session_file, prod.PI_TOOL_ALLOWLIST);
      assertTrue(parsed.extras.length === 0, `extra tools invoked: ${parsed.extras.join(', ')}`);
      assertTrue(parsed.invoked.includes('submit_candidate'), 'no submit_candidate call in the live transcript');
      assertTrue(parsed.invoked.some((name) => name.startsWith('context_')), 'no context_* tool call in the live transcript');
      assertTrue(parsed.accepted, 'host acceptance of submit_candidate is missing from the transcript');
      if (parsed.active) {
        assertTrue(JSON.stringify([...parsed.active].sort()) === JSON.stringify([...prod.PI_TOOL_ALLOWLIST].sort()),
          `registered tool set drifted: ${parsed.active.join(', ')}`);
      }
      return { invoked: parsed.invoked, active: parsed.active };
    });
    ch.check('B3', 'session identifies the resolved live route (no canned/loopback generation)', () => {
      const text = fs.readFileSync(runRow.pi_session_file, 'utf8');
      assertTrue(text.includes(APPROVED_LIVE_ROUTE.model) || text.includes(APPROVED_LIVE_ROUTE.provider),
        'session transcript never names the approved live provider/model');
      assertTrue(!text.includes('127.0.0.1') || !/base.?url"?\s*:\s*"http:\/\/127\.0\.0\.1/i.test(text), 'session transcript points at a loopback model endpoint');
      return null;
    });
    ch.check('B4', 'candidate is new vs the staging baseline and the data commit carries exactly that post', () => {
      const baseline = JSON.parse(fixture.show(ev.stagingBefore, 'data/posts.json'));
      const dataSha = runRow.data_sha;
      assertTrue(prod.isExactSha(dataSha), 'ledger has no exact data_sha');
      const shipped = JSON.parse(fixture.show(dataSha, 'data/posts.json'));
      assertTrue(shipped.length === baseline.length + 1, 'data commit does not append exactly one post');
      const candidate = shipped.at(-1);
      assertTrue(!baseline.some((post) => post.slug === candidate.slug), 'candidate slug pre-existed in the baseline');
      const headPosts = JSON.parse(fixture.show(ev.contentPr.headSha, 'data/posts.json'));
      assertTrue(JSON.stringify(headPosts.at(-1)) === JSON.stringify(candidate), 'PR head post differs from the submitted data commit');
      return { slug: candidate.slug };
    });
    ch.check('B5', 'auth.json shredded before retention; literal PI_API_KEY appears in no retained evidence', () => {
      assertTrue(shredded === true || !process.env.PI_API_KEY, 'auth.json was not present to shred');
      assertTrue(!fs.existsSync(path.join(scenario.stateDir, 'pi-runtime', 'auth.json')), 'auth.json survived the shred');
      assertTrue(hits.length === 0, `SECRET_LEAKED: ${hits.join(', ')}`);
      return null;
    });
    ch.check('C1', 'trusted linter invocation shape: repoRoot script, cwd=workDir, relative data paths', () => {
      const entries = spawnEntriesFor(readSpawnLog(scenario.spawnLog), 'scripts/blog-lint.mjs');
      const lint = entries.find((entry) => entry.cwd.includes(path.join('state', 'work')));
      assertTrue(lint, 'no observed blog-lint invocation from the staging worktree');
      assertTrue(lint.argv[1] === path.join(fixture.clone, 'scripts/blog-lint.mjs'), `lint script path was ${lint.argv[1]}`);
      assertTrue(lint.argv.includes('--posts') && lint.argv[lint.argv.indexOf('--posts') + 1] === 'data/posts.json', 'non-relative --posts');
      assertTrue(lint.argv[lint.argv.indexOf('--businesses') + 1] === 'data/businesses.json', 'non-relative --businesses');
      assertTrue(lint.cwd.startsWith(path.join(scenario.stateDir, 'work')), `lint cwd was ${lint.cwd}`);
      return { argv: lint.argv.slice(1), cwd: lint.cwd };
    });
    ch.check('C2', 'baseline gates all ran in order before generation', () => {
      const npm = readSpawnLog(scenario.spawnLog);
      const seen = ['ci', 'lint:automation', 'lint:supervisor', 'test:automation', 'test:supervisor'];
      const observed = [];
      for (const entry of npm) {
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
