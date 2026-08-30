import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { KIND_POLICIES, STATUS_CONTEXTS } from '../../scripts/automation/constants.mjs';
import { contentShipEnabled, promotionEnabled } from '../../scripts/automation/promotion-control.mjs';
import { buildGeneratorPrompt } from '../../scripts/supervisor/pi-session.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/supervisor-ingest.yml', import.meta.url), 'utf8');

test('blog-live kind is content-only onto main and does not mutate blog or promotion', () => {
  const live = KIND_POLICIES['blog-live'];
  assert.equal(live.base, 'main');
  assert.deepEqual(live.headPrefixes, ['blog/auto-']);
  assert.deepEqual(live.allowedPaths, ['data/posts.json', 'public/images/blog/']);
  assert.equal(KIND_POLICIES.blog.base, 'staging');
  assert.equal(KIND_POLICIES.promotion.exactHead, 'staging');
  assert.equal(STATUS_CONTEXTS.publish.ci, 'automation/ci');
  assert.equal(STATUS_CONTEXTS.wait.vercel, 'Vercel');
  assert.equal(Object.values(STATUS_CONTEXTS.publish).includes('Vercel'), false);
});

test('ingest transplants onto main as blog-live', () => {
  assert.match(workflow, /--kind blog-live/);
  assert.match(workflow, /gh pr create --base main/);
  assert.match(workflow, /git checkout -B "blog\/auto-supervisor-\$\{DATA_SHA:0:12\}" origin\/main/);
});

test('generation prompt binds publishedAt and updatedAt to the exact UTC run date', () => {
  const now = new Date('2026-08-26T15:04:05Z');
  const prompt = buildGeneratorPrompt({
    topic: { key: 'k', title: 't', source: 's', rationale: 'r' },
    contextFiles: ['data/posts.json'],
    businesses: JSON.parse(fs.readFileSync('data/businesses.json', 'utf8')),
    now,
  });
  assert.match(prompt, /publishedAt/);
  assert.match(prompt, /updatedAt/);
  assert.match(prompt, /exact UTC run date 2026-08-26/);
  assert.match(prompt, /must equal 2026-08-26/);
  assert.doesNotMatch(prompt, /2026-08-25|2026-08-27/);
  assert.match(prompt, /exact slug field/);
  assert.match(prompt, /copied verbatim from the linked repository record/);
  assert.match(prompt, /Current trusted phrase-to-route index/);
  assert.match(prompt, /Duplicate display names require an exact linked route/);
  assert.match(prompt, /Do not invent or approximate any clock range/);
  assert.doesNotMatch(prompt, /the only safe Liberty Village slugs/);
});

test('content ship is on only for exedev and fails closed on the emergency override', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-content-ship-'));
  const exedevOwner = path.join(directory, 'owner.txt');
  const ghaOwner = path.join(directory, 'gha-owner.txt');
  fs.writeFileSync(exedevOwner, 'exedev\n');
  fs.writeFileSync(ghaOwner, 'gha\n');
  assert.equal(contentShipEnabled({ LV_WEEKLY_OWNER: 'exedev' }, { ownerFile: exedevOwner }), true);
  assert.equal(contentShipEnabled({ LV_WEEKLY_OWNER: 'exedev', LV_CONTENT_SHIP_ENABLED: 'false' }, { ownerFile: exedevOwner }), false);
  assert.equal(contentShipEnabled({}, { ownerFile: ghaOwner, owner: 'gha' }), false);
  assert.equal(promotionEnabled({ LV_WEEKLY_OWNER: 'exedev', LV_PROMOTION_ENABLED: 'true' }, { ownerFile: exedevOwner }), false);
  const output = execFileSync(process.execPath, ['scripts/automation/promotion-control.mjs', '--content-ship'], {
    encoding: 'utf8', env: { ...process.env, LV_WEEKLY_OWNER: 'exedev' },
  });
  assert.match(output, /enabled/);
  assert.throws(() => execFileSync(process.execPath, ['scripts/automation/promotion-control.mjs', '--content-ship'], {
    encoding: 'utf8', env: { ...process.env, LV_WEEKLY_OWNER: 'exedev', LV_CONTENT_SHIP_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }), (error) => {
    assert.match(String(error.stderr || error.message), /emergency override/);
    return true;
  });
});

