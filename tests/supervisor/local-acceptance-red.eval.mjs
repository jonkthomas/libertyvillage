// RED mocks 1–7: evaluator-owned adversarial controls that MUST fail
// acceptance. Eval-owned; FROZEN by evals/local-supervisor-acceptance.sha256.
// A checker that cannot reject a dishonest implementation is not a checker;
// each mock plants one dishonest shape and proves the frozen happy-path
// verifier (or the production guard) refuses it.
import fs from 'node:fs';
import http from 'node:http';
import { Checks, assertLiveRoute, assertTrue, runChildCli } from './helpers/acceptance-evidence.mjs';
import { prepareScenario, verifyHappyEvidence, shimPost, firstBlogImage } from './local-acceptance-happy.eval.mjs';

const cleanPost = (context, slug) => ({ ...shimPost({ dirty: false, image: firstBlogImage(context.repoRoot) }), slug });

const payloadFor = ({ dataSha, dataBranch }) => ({
  kind: 'blog', data_sha: dataSha, data_branch: dataBranch, topic_key: 'acceptance-red-topic', regenerations: 0,
});

function fabricatedRow(pr) {
  return {
    run_id: 'red-mock-run', kind: 'blog', state: 'TERMINAL', terminal: 'PUBLISHED_MAIN',
    pr_state: 'closed', pr_number: pr?.number ?? 999, head_sha: pr?.headSha ?? 'a'.repeat(40),
    data_sha: pr?.headSha ?? 'a'.repeat(40), topic_key: 'acceptance-red-topic', pi_session_file: null,
  };
}

async function drive(context, name, controls, { ingest = true } = {}) {
  const scenario = await prepareScenario(context, { name, controls });
  let pr = null;
  let branch = null;
  if (ingest) {
    branch = scenario.fixture.makeDataBranch(cleanPost(context, `acceptance-${name}-candidate`));
    pr = scenario.sim.runIngest(payloadFor(branch));
    scenario.fixture.bareGit(['update-ref', '-d', `refs/heads/${branch.dataBranch}`]);
  }
  return { scenario, pr, branch };
}

function expectVerifierRefusal(ch, id, description, scenario, ev, mustFailIds) {
  ch.check(id, description, () => {
    const sub = new Checks(`${id}-verifier`);
    verifyHappyEvidence(scenario, ev, sub);
    assertTrue(!sub.ok, 'the happy-path verifier ACCEPTED the dishonest shape');
    const failedIds = sub.failed.map((result) => result.id);
    assertTrue(mustFailIds.some((wanted) => failedIds.includes(wanted)),
      `expected one of ${mustFailIds.join('/')} to fail; observed failures: ${failedIds.join(', ')}`);
    return { failed: failedIds };
  });
}

export async function run(context) {
  const ch = new Checks('red-mocks');
  ch.check('RED1a', 'preflight allowlist refuses canned/loopback and non-approved live routes', () => {
    for (const bad of [
      { provider: 'lv-vercel-acceptance', model: 'openai/gpt-5.6-sol', baseUrl: 'http://127.0.0.1:4242/v1' },
      { provider: 'vercel', model: 'anthropic/claude-opus-5', baseUrl: 'https://ai-gateway.vercel.sh/v1' },
    ]) {
      let refused = false;
      try { assertLiveRoute(bad); } catch (error) {
        refused = /LIVE_MODEL_ROUTE_REFUSED|FORBIDDEN_VERCEL_ANTHROPIC_ROUTE/.test(error.message);
      }
      assertTrue(refused, `route not refused with a named code: ${JSON.stringify(bad)}`);
    }
    return null;
  });
  // RED mock 1b — the child really starts against a canned loopback model and
  // still cannot produce accepted live-generation evidence.
  {
    const canned = http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'canned', object: 'response', output: [], status: 'completed' }));
    });
    await new Promise((resolve) => { canned.listen(0, '127.0.0.1', resolve); });
    const cannedUrl = `http://127.0.0.1:${canned.address().port}/v1`;
    const scenario = await prepareScenario(context, {
      name: 'red1b',
      pi: { baseUrl: cannedUrl, apiKey: 'red-mock-dummy', modelsOverride: { baseUrl: cannedUrl } },
    });
    const result = await runChildCli({ cloneDir: scenario.fixture.clone, env: scenario.env, deadlineMs: 5 * 60_000 });
    ch.check('RED1b', 'canned-model child starts but yields no accepted live generation; the route itself is off-allowlist', () => {
      assertTrue(fs.existsSync(scenario.ledgerFile) || result.stdout.length > 0 || result.stderr.length > 0, 'the child never started');
      let refused = false;
      try { assertLiveRoute({ provider: scenario.env.PI_PROVIDER, model: scenario.env.PI_MODEL, baseUrl: scenario.env.PI_BASE_URL }); } catch { refused = true; }
      assertTrue(refused, 'the canned route would have passed the operator preflight');
      for (const file of scenario.sessionFiles()) {
        assertTrue(!fs.readFileSync(file, 'utf8').includes('Accepted. End the session.'),
          'a canned session produced an accepted submit_candidate');
      }
      assertTrue(!result.stdout.includes('PUBLISHED_MAIN:'), 'the canned run claimed success');
      return { exit: result.code, deadlineHit: result.deadlineHit };
    });
    await scenario.cleanup();
    await new Promise((resolve) => { canned.close(resolve); });
  }
  // RED mock 2 — API says merged, bare remote says otherwise.
  {
    const { scenario, pr } = await drive(context, 'red2', { dishonestMerged: true });
    expectVerifierRefusal(ch, 'RED2', 'a dishonest merged=true with an unmoved bare main fails the verifier', scenario,
      { runRow: fabricatedRow(pr), ledger: { lease: null }, contentPr: pr, mainBefore: scenario.fixture.baseSha, stagingBefore: scenario.fixture.stagingSha },
      ['P5b', 'P6']);
    await scenario.cleanup();
  }
  // RED mock 3 — plausible PUBLISHED_MAIN ledger with zero boundary events.
  {
    const scenario = await prepareScenario(context, { name: 'red3' });
    expectVerifierRefusal(ch, 'RED3', 'a prewritten PUBLISHED_MAIN ledger with no dispatch/PR/status evidence fails the verifier', scenario,
      { runRow: fabricatedRow(null), ledger: { lease: null }, contentPr: undefined, mainBefore: scenario.fixture.baseSha, stagingBefore: scenario.fixture.stagingSha },
      ['P1', 'P12']);
    await scenario.cleanup();
  }
  // RED mock 4 — success statuses whose payload SHA is not the PR head.
  {
    const scenario = await prepareScenario(context, { name: 'red4' });
    ch.check('RED4', 'statusForExactSha throws immediately on a payload-SHA mismatch (no missing/missing wait)', () => {
      const head = scenario.fixture.rev('staging');
      let threw = null;
      try {
        scenario.prod.statusForExactSha({
          sha: 'b'.repeat(40),
          statuses: [{ context: 'automation/ci', state: 'success' }, { context: 'automation/opus-gate', state: 'success' }],
        }, head);
      } catch (error) { threw = error; }
      assertTrue(threw && /drifted/.test(threw.message), 'mismatched payload SHA was accepted');
      return null;
    });
    await scenario.cleanup();
  }
  // RED mock 5 (C-N10 analogue) — PUBLISHED_MAIN with a closed PR record but no
  // merge commit on the bare remote and no production Vercel.
  {
    const scenario = await prepareScenario(context, { name: 'red5' });
    const pr = scenario.sim.addIssue({
      title: 'fabricated', pull: true, base: 'main',
      head: { ref: 'blog/auto-fabricated', sha: scenario.fixture.rev('staging') }, files: ['data/posts.json'],
    });
    pr.state = 'closed'; pr.merged = true; pr.merge_commit_sha = 'c0ffee'.padEnd(40, '0');
    expectVerifierRefusal(ch, 'RED5', 'PUBLISHED_MAIN without a real merge commit or production Vercel fails the verifier', scenario,
      { runRow: fabricatedRow(pr), ledger: { lease: null }, contentPr: pr, mainBefore: scenario.fixture.baseSha, stagingBefore: scenario.fixture.stagingSha },
      ['P3', 'P5b', 'P6', 'P4']);
    await scenario.cleanup();
  }
  // RED mock 6 (C-N13 analogue) — merged + synced but production Vercel missing.
  {
    const { scenario, pr } = await drive(context, 'red6', { vercelProd: 'missing' });
    expectVerifierRefusal(ch, 'RED6', 'green preview + merged + synced but missing production Vercel fails the verifier', scenario,
      { runRow: fabricatedRow(pr), ledger: { lease: null }, contentPr: pr, mainBefore: scenario.fixture.baseSha, stagingBefore: scenario.fixture.stagingSha },
      ['P5b']);
    await scenario.cleanup();
  }
  // RED mock 7 (C-N14 analogue) — "sync" via direct push of staging.
  {
    const { scenario, pr } = await drive(context, 'red7', { sync: 'direct-push' });
    ch.check('RED7-reject', 'the protection double rejected the direct staging push', () => {
      assertTrue(scenario.sim.events.some((event) => event.type === 'direct-push-rejected' && event.branch === 'staging'), 'no rejection recorded');
      assertTrue(!scenario.sim.events.some((event) => event.type === 'direct-push-accepted'), 'a direct push was accepted');
      return null;
    });
    expectVerifierRefusal(ch, 'RED7', 'an implementation that syncs by pushing staging cannot go GREEN', scenario,
      { runRow: fabricatedRow(pr), ledger: { lease: null }, contentPr: pr, mainBefore: scenario.fixture.baseSha, stagingBefore: scenario.fixture.stagingSha },
      ['P13', 'P8']);
    await scenario.cleanup();
  }
  return [ch];
}
