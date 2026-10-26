// One shared, dependency-free map from runner/gate/deploy failure codes to plain
// English, used by every #libvillage Slack message and the weekly digest page.
// The reader is a non-technical exec: say what happened, why it matters and what
// (if anything) John must do. Raw codes stay out of message bodies.
//
// Loaded three ways, so keep it self-contained (no imports):
// - the weekly digest on the Mac (install-mac.sh copies lib/),
// - scripts/content/* from the repo checkout,
// - the VM runner (installed as a single file) via a guarded import from the repo.

export const LINKS = Object.freeze({
  digest: 'https://ofia.tail97aece.ts.net/decks/lv-digest/',
  fixIt: 'https://github.com/jonkthomas/libertyvillage/issues?q=is%3Aissue+is%3Aopen+label%3Alv-digest-agent',
});

const RETRY = 'Nothing to do. It tries again at the next scheduled run.';
const NEXT_TOPIC = 'Nothing to do. The next scheduled run tries again, with another topic if needed.';
const SLOT_OPEN = 'No bad content went live, but that post slot is still open.';
const NO_CHANGE = 'That run changed nothing on the site.';
const FIX_IT = 'Nothing to do now. The fix-it agent reviews it on Monday; if it keeps happening it opens a ticket.';

// title: short group label (digest "what went wrong"); cause: why it happened;
// impact: why it matters; action: what happens next / what John does.
const ENTRIES = {
  'business-outside-pack': {
    title: 'Draft named a business we could not verify',
    cause: 'The draft mentioned a business that is not in the checked source list for its topic, so it was rejected before publishing.',
    impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  'draft-changed-topic': {
    title: 'Draft drifted off its topic',
    cause: 'The writer produced a post about a different subject than the one assigned, so it was rejected.',
    impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  'blog-lint': {
    title: 'Draft failed the fact check',
    cause: 'The draft included a detail our automatic fact check could not confirm, so it was rejected.',
    impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  'unsupported-grounding': {
    title: 'Draft made claims the sources do not back',
    cause: 'The finished draft made claims our sources do not support, so it was rejected before publishing.',
    impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  'near-duplicate': {
    title: 'Topic too close to an existing page',
    cause: 'The proposed post overlapped too much with a page we already have, so it was skipped.',
    impact: 'This avoids two of our pages competing for the same searches.', action: NEXT_TOPIC,
  },
  'gate blocked or rejected': {
    title: 'Quality review stopped a draft',
    cause: 'Our automatic quality review stopped the draft before it went live.',
    impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  'cadence content deficit': {
    title: 'Behind the 2-posts-a-week plan',
    cause: 'When this run checked, the week had fewer published posts than planned. This is a progress check, not a breakdown.',
    impact: 'The week can still catch up before it ends.',
    action: 'Nothing to do. The next blog slot (Wednesday or Sunday) tries again.',
  },
  'weekly content missed': {
    title: 'Missed the weekly post plan',
    cause: 'The week ended with fewer published posts than the 2-post plan.',
    impact: 'The site published less than planned that week.',
    action: 'Nothing to do. Next week runs as normal; the weekly report shows what stopped the posts.',
  },
  'weekly news missed': {
    title: 'Missed the weekly news roundup',
    cause: 'The week ended without a published news roundup.',
    impact: 'Readers got no roundup that week.',
    action: 'Nothing to do. Next week runs as normal; the weekly report shows why.',
  },
  'backfill publication incomplete': {
    title: 'Catch-up post did not publish',
    cause: 'The daily catch-up run could not get its post for a missed October date through the checks.',
    impact: 'One October date is still missing its post.',
    action: 'Nothing to do. It runs again tomorrow; after 3 failed tries on a date it moves on to the next date.',
  },
  'backfill exhausted': {
    title: 'Gave up on one October catch-up date',
    cause: 'Three tries at the post for this date all failed the checks.',
    impact: 'That date stays without a post; the remaining dates continue.',
    action: 'Nothing to do.',
  },
  'operational-error': {
    title: 'Unexpected technical error',
    cause: 'The run hit a technical problem that is not one of the known content issues.',
    impact: NO_CHANGE, action: FIX_IT,
  },
  timeout: {
    title: 'A run took too long and was stopped',
    cause: 'A step ran past its time limit and was stopped.', impact: NO_CHANGE, action: RETRY,
  },
  'no terminal event': {
    title: 'A run stopped without finishing',
    cause: 'The run started but never reported back (most likely a timeout, crash or server restart).',
    impact: NO_CHANGE, action: FIX_IT,
  },
  'cli-network': {
    title: 'Could not reach the content database',
    cause: 'A network problem stopped the run from talking to the content database.', impact: NO_CHANGE, action: RETRY,
  },
  'cli-server': {
    title: 'Content database had a server error',
    cause: 'The content database returned a server error.', impact: NO_CHANGE, action: RETRY,
  },
  'cli-timeout': {
    title: 'Content database was too slow',
    cause: 'A content database step ran past its time limit.', impact: NO_CHANGE, action: RETRY,
  },
  'cli-claim': {
    title: 'Another run was already on it',
    cause: 'Another run was already working on the same draft, so this one stood down.',
    impact: 'Nothing is lost; the other run carries on.', action: 'Nothing to do.',
  },
  'cli-conflict': {
    title: 'Content changed while the run worked',
    cause: 'The content changed underneath this run, so it stopped rather than overwrite it.', impact: NO_CHANGE, action: RETRY,
  },
  'cli-schema': {
    title: 'Content database needs an update',
    cause: 'The content database is missing a required update (a migration).',
    impact: 'Runs that need the update keep failing until it is applied.',
    action: 'Apply the pending database migration (see the runner README), then let the next run go.', needsYou: true,
  },
  'cli-target': {
    title: 'Run pointed at the wrong site or database',
    cause: 'The run was configured for a different site or database than the one it ran against, so it refused.',
    impact: 'Safety stop: nothing was written.', action: FIX_IT,
  },
  'cli-permission': {
    title: 'Run was not allowed to make the change',
    cause: 'The content system refused the change for lack of permission.', impact: NO_CHANGE, action: FIX_IT,
  },
  'cli-validation': {
    title: 'Content failed validation',
    cause: 'The content did not pass the format and safety checks, so it was refused.', impact: SLOT_OPEN, action: RETRY,
  },
  'cli-operation': {
    title: 'A content-system step failed',
    cause: 'One step of the content system failed, so the run stopped.', impact: NO_CHANGE, action: FIX_IT,
  },
  'invalid-json': {
    title: 'A step returned unreadable output',
    cause: 'One step of the run returned output that could not be read.', impact: NO_CHANGE, action: FIX_IT,
  },
  'runner hold active': {
    title: 'Automation is paused',
    cause: 'The pause switch (hold file) is on, so all publishing is stopped.',
    impact: 'Nothing publishes until the pause is lifted.',
    action: 'Lift the pause when you are ready to resume publishing.', needsYou: true,
  },
  'publish or propagation pending': {
    title: 'Published, waiting to show on the site',
    cause: 'The post was published but the site had not shown it yet when the run checked.',
    impact: 'It counts toward the plan once the site shows it.', action: 'Nothing to do. The next run checks it again.',
  },
  'blog generated no post': {
    title: 'Writer did not produce a post',
    cause: 'The writer finished without a usable post (often it declined a topic it could not support with sources).',
    impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  'no healthy news source': {
    title: 'No news source was reachable',
    cause: 'None of the news sources answered properly, so there was nothing to write about.', impact: NO_CHANGE, action: RETRY,
  },
  'news post artifact missing; manual recovery required': {
    title: 'A news post needs manual recovery',
    cause: 'A news post was half-finished and its saved copy is missing.',
    impact: 'News publishing stays stuck until it is recovered.',
    action: 'Ask for a manual recovery of the stuck news post.', needsYou: true,
  },
  'SEO code suggestion; human PR required': {
    title: 'SEO run suggested a code change',
    cause: 'The SEO run wanted to change site code, which automation is not allowed to do.',
    impact: 'The suggestion is saved; nothing changed on the site.',
    action: 'Review the suggestion and open a pull request if you want it.', needsYou: true,
  },
  'prior content unresolved': {
    title: 'An earlier post was still unresolved',
    cause: 'A post from an earlier slot was still pending or held, so this run waited instead of starting another.',
    impact: 'This avoids two runs fighting over the same week.', action: RETRY,
  },
  'counted too late': {
    title: 'Post went live too late to count',
    cause: 'The post went live after its week closed, or is no longer the live version, so it did not count toward that week.',
    impact: 'That week shows one fewer post than was written.', action: 'Nothing to do.',
  },
  'roundup held': {
    title: 'Weekly roundup held back',
    cause: 'There were not enough solid local items to publish a roundup this week.',
    impact: 'No roundup this week, rather than a thin one.', action: 'Nothing to do.',
  },
  'safety stop': {
    title: 'Run stopped at a safety check',
    cause: 'A built-in safety check found something inconsistent and stopped the run before it changed anything.',
    impact: NO_CHANGE, action: FIX_IT,
  },
  'roundup model technical failure': {
    title: 'Roundup writer had a technical failure',
    cause: 'The model writing the weekly roundup failed for technical reasons, not because of the content.',
    impact: NO_CHANGE, action: RETRY,
  },
  'backfill not due': {
    title: 'Catch-up not due yet',
    cause: 'The catch-up run started before its start date, so it did nothing.',
    impact: NO_CHANGE, action: 'Nothing to do.',
  },
  'writer safety rule': {
    title: 'Writer output broke a safety rule',
    cause: 'The writer produced files outside what it is allowed to change, so the output was thrown away.',
    impact: NO_CHANGE, action: RETRY,
  },
  'hook-failed': {
    title: 'Site rebuild did not start',
    cause: 'The post is saved, but the request to rebuild the site failed.',
    impact: 'Readers cannot see the post yet.',
    action: 'Re-run the site deploy (details below).', needsYou: true,
  },
  'smoke-timeout': {
    title: 'Post saved but not showing on the site yet',
    cause: 'The post is saved, but the page had not appeared on the site when the check gave up.',
    impact: 'Readers may not see the post yet.',
    action: 'Nothing to do if the next run picks it up; if the page is still missing tomorrow, re-run the site deploy.',
  },
  'smoke-failed': {
    title: 'New page broke and was rolled back',
    cause: 'The page failed its live check after publishing, so it was rolled back automatically.',
    impact: 'Readers see the previous version, not a broken page.', action: RETRY,
  },
  'compensation-conflict': {
    title: 'Could not roll back a broken page',
    cause: 'A new page failed its live check, but newer content had already replaced it, so the automatic rollback was skipped.',
    impact: 'The newer content was kept; the broken version may still be visible.',
    action: 'Check the page on the site.', needsYou: true,
  },
  'admin-smoke-failed': {
    title: 'Manual update failed its page check',
    cause: 'A manual content update went live but the page check failed.',
    impact: 'Manual updates have no automatic undo.', action: 'Check the affected page and fix or revert the update.', needsYou: true,
  },
  'not-converging': {
    title: 'Fixes were not improving the draft',
    cause: 'Automatic fixes stopped improving the draft, so it was dropped.', impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  unrepairable: {
    title: 'Draft could not be fixed',
    cause: 'The quality review found problems that automatic fixes cannot repair.', impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  exhausted: {
    title: 'Ran out of fix attempts',
    cause: 'The draft still had problems after the maximum number of automatic fixes.', impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  block: {
    title: 'Quality review stopped a draft',
    cause: 'Our automatic quality review blocked the draft.', impact: SLOT_OPEN, action: NEXT_TOPIC,
  },
  validation: {
    title: 'Content failed validation',
    cause: 'The content did not pass the format and safety checks, so it was refused.', impact: SLOT_OPEN, action: RETRY,
  },
  conflict: {
    title: 'Content changed while the run worked',
    cause: 'Someone or something changed the same content during review, so this version was dropped.', impact: NO_CHANGE, action: RETRY,
  },
  'state-error': {
    title: 'Draft was in an unexpected state',
    cause: 'The draft was not in the state this step expected, so the run stopped safely.', impact: NO_CHANGE, action: FIX_IT,
  },
};

const SUBCAUSE = {
  'blog-lint:unrecorded-business': 'named a business that is not in our directory',
  'blog-lint:unsupported-address': 'gave an address the sources do not confirm',
  'blog-lint:unsupported-date': 'gave a date the sources do not confirm',
  'blog-lint:unsupported-hours': 'gave opening hours the sources do not confirm',
  'blog-lint:unsupported-price': 'gave a price the sources do not confirm',
  'blog-lint:unsupported-operational-premise': 'claimed something about how a business operates that the sources do not support',
};

const ALIASES = {
  'weekly_content_missed': 'weekly content missed', 'missed-week': 'weekly content missed', 'missed week': 'weekly content missed',
  'deadline-missed': 'weekly content missed', 'weekly_news_missed': 'weekly news missed',
  lint: 'blog-lint', 'unrecorded-business': 'blog-lint:unrecorded-business',
  'cli-state': 'state-error', 'cli-database': 'cli-target', 'cli-database-target': 'cli-target',
  'blog generated no submission': 'blog generated no post', 'no-post': 'blog generated no post',
  rejected: 'gate blocked or rejected', blocked: 'gate blocked or rejected',
  'prior content slot held': 'prior content unresolved', 'prior content publication pending': 'prior content unresolved',
  'prior content backlog exceeds recovery budget': 'prior content unresolved', 'prior content smoke not current-live': 'prior content unresolved',
  'prior roundup slot held': 'prior content unresolved', 'prior roundup publication pending': 'prior content unresolved',
  'prior roundup backlog exceeds recovery budget': 'prior content unresolved', 'prior roundup smoke not current-live': 'prior content unresolved',
  'cadence attempt already open': 'prior content unresolved',
  'smoked but not counted for week': 'counted too late', 'late smoke; old week missed': 'counted too late',
  'roundup consumed but no longer live': 'counted too late', 'smoked but not current-live': 'counted too late',
  'roundup-hold': 'roundup held', 'roundup hold': 'roundup held', 'roundup publication disabled': 'roundup held', 'roundup-publication-disabled': 'roundup held',
  'scratch output outside allowlist': 'writer safety rule', 'scratch output too large': 'writer safety rule', 'generator changed pinned commit': 'writer safety rule',
  error: 'operational-error', 'cli-failure': 'cli-operation',
  'weekly-roundup is staging-only': 'safety stop', 'weekly-roundup options unsupported': 'safety stop', 'backfill options unsupported': 'safety stop',
  'invalid cadence start week': 'safety stop', 'idempotency kind mismatch': 'safety stop', 'roundup intent already attempted': 'safety stop',
  'roundup submit refused': 'safety stop', 'roundup artifact invalid': 'safety stop', 'roundup artifact inconsistent': 'safety stop',
  'roundup census invalid': 'safety stop', 'news resume snapshot changed': 'safety stop', 'submission lacks smoke success': 'safety stop',
};

const FALLBACK = Object.freeze({
  title: 'Unexpected problem (investigating)',
  cause: 'This one does not have a plain-English explanation yet.',
  impact: 'We are investigating; nothing else is affected that we know of.',
  action: 'Nothing to do yet. The fix-it agent investigates it; see its tickets.',
  needsYou: false,
  link: LINKS.fixIt,
});

/** Normalize one raw reason (runner failure, gate decision, alert kind) to a map key. */
export function normalizeCode(raw) {
  const code = String(raw ?? '').trim();
  if (!code) return '';
  if (/^cli:\s/.test(code)) return 'cli-operation';
  if (/^no terminal event/i.test(code)) return 'no terminal event';
  if (/^roundup hold/i.test(code)) return 'roundup held';
  // "cli-validation exit 2" -> "cli-validation": a known code followed by detail.
  const head = code.split(/\s/)[0];
  for (const c of [code, code.toLowerCase(), head]) {
    if (Object.hasOwn(ENTRIES, c) || c.startsWith('blog-lint:')) return c;
    if (Object.hasOwn(ALIASES, c)) return ALIASES[c];
  }
  return code;
}

/**
 * Plain-English explanation for one code. Always returns
 * {code, known, title, cause, impact, action, needsYou, link}; unknown codes
 * fall back to "investigating" with the fix-it agent's tickets as the link.
 */
export function explain(raw) {
  const code = normalizeCode(raw);
  const base = code.startsWith('blog-lint:') ? 'blog-lint' : code;
  const entry = Object.hasOwn(ENTRIES, base) ? ENTRIES[base] : null;
  if (!entry) return { code, known: false, ...FALLBACK };
  const detail = Object.hasOwn(SUBCAUSE, code) ? SUBCAUSE[code] : null;
  return {
    code, known: true,
    title: entry.title,
    cause: detail ? `The draft ${detail}, so our automatic fact check rejected it.` : entry.cause,
    impact: entry.impact, action: entry.action,
    needsYou: entry.needsYou === true,
    link: LINKS.digest,
  };
}

/** Every code the map knows (for tests and docs). */
export const KNOWN_CODES = Object.freeze([...Object.keys(ENTRIES), ...Object.keys(SUBCAUSE), ...Object.keys(ALIASES)]);

/** Bracketed lint codes like "[unrecorded-business]" inside validation error strings. */
export function codesInErrors(errors) {
  const out = [];
  for (const e of Array.isArray(errors) ? errors : []) {
    for (const m of String(e).matchAll(/\[([a-z][a-z0-9-]{1,60})\]/g)) out.push(`blog-lint:${m[1]}`);
  }
  return [...new Set(out)];
}

const JOBS = {
  'weekly-blog': 'Weekly blog post', 'october-blog-backfill': 'October catch-up post', 'topic-discovery': 'Topic research',
  'discover-businesses': 'Business directory refresh', news: 'Daily news check', 'weekly-growth-report': 'Weekly growth report',
  'weekly-roundup': 'Weekly news roundup', 'seo-improvements': 'SEO improvements', blog: 'Blog post', admin: 'Manual content update', manual: 'Manual content change',
  'guide-hub': 'Neighbourhood guide', 'deploy-retry': 'Site rebuild retry',
};
/** "weekly-blog" -> "Weekly blog post"; unknown slugs become words. */
export function jobName(job) {
  const j = String(job ?? '').trim();
  if (Object.hasOwn(JOBS, j)) return JOBS[j];
  const words = j.replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Content job';
}

/** Lower-case a title's first letter for mid-sentence use, unless it starts with a name or acronym. */
export function midSentence(title) {
  const s = String(title ?? '');
  return /^(?:[A-Z]{2,}|October)\b/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

/** "production" -> "libertyvillage.co", "staging" -> "the test site". */
export function siteName(target) {
  if (target === 'production') return 'libertyvillage.co';
  if (target === 'staging') return 'the test site';
  return target ? `the ${target} site` : 'the site';
}

/**
 * The standard four-part Slack body: what happened / why it matters / what to do / link,
 * plus an optional trailing reference line (ids for operators, never in the body).
 */
export function slackBody({ what, why, todo, link, ref, prefix = '' }) {
  return [
    `${prefix}${what}`,
    why ? `Why it matters: ${why}` : null,
    `What you need to do: ${todo || 'Nothing to do.'}`,
    link || null,
    ref ? `Ref: ${ref}` : null,
  ].filter(Boolean).join('\n');
}
