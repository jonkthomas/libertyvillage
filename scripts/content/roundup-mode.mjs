// Weekly roundup publication mode per content target (docs/specs/weekly-roundup-v2.md
// §10.1). Compiled code at the pinned SHA: never an environment, request or CLI
// toggle. Changing either value requires a reviewed PR; the production value is
// the owner's protected action. The runner loads this from the pinned tree and
// the trusted CLI checks it before opening a DB.
export const ROUNDUP_PUBLICATION = Object.freeze({ staging: 'structured-v2', production: 'census-only' });
export const ROUNDUP_OPTIONAL_SOURCES = Object.freeze({ instagram: Object.freeze({ enabled: true, provider: 'apify' }) });
export const ROUNDUP_MODES = Object.freeze(['census-only', 'structured-v2']);

// The mode for a target, or null (fail closed: `roundup publication disabled`).
export function roundupPublicationMode(target) {
  const mode = Object.hasOwn(ROUNDUP_PUBLICATION, target) ? ROUNDUP_PUBLICATION[target] : null;
  return ROUNDUP_MODES.includes(mode) ? mode : null;
}
