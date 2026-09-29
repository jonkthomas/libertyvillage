import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyStopReason } = require('../../scripts/weekly-blog-agent.js');

test('blog agent separates SDK completion from a written post and classifies bounded stop reasons', () => {
  assert.equal(classifyStopReason({ written: true, lastAssistantText: '', errors: [] }), 'post-written');
  assert.equal(classifyStopReason({ written: false, lastAssistantText: 'I need to halt. This violates the grounding rules for local facts.', errors: [] }), 'unsupported-grounding');
  assert.equal(classifyStopReason({ written: false, lastAssistantText: 'Stop: duplicate article already exists.', errors: [] }), 'duplicate');
  assert.equal(classifyStopReason({ written: false, lastAssistantText: 'No credible sources support this article.', errors: [] }), 'insufficient-sources');
  assert.equal(classifyStopReason({ written: false, lastAssistantText: 'Looks good.', errors: [] }), 'no-post-unspecified');
  assert.equal(classifyStopReason({ written: false, lastAssistantText: 'Looks good.', errors: ['subtype:error'] }), 'sdk-error');
});
