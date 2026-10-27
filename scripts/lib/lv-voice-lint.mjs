// Editorial checks only. Claim, scope and grounding checks keep their own policy.
export const VOICE_POLICY = Object.freeze({ warnOnlySince: '2026-10-27', blocking: false });
export const voiceBlocking = (env = process.env) => VOICE_POLICY.blocking || env.LV_VOICE_BLOCKING === '1';
export const BANNED_PHRASES = Object.freeze([
  'delve', 'nestled', 'vibrant', 'bustling', 'hidden gem', 'tapestry', 'elevate',
  'seamless', 'leverage', 'robust', 'game changer', "whether you're", 'in conclusion',
]);

// Markdown destinations and code are not reader-facing prose. Do not alter the draft.
const prose = (text) => String(text).replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
  .replace(/[‘’]/g, "'");

export function lintVoiceFields(fields, { blocking = voiceBlocking() } = {}) {
  const findings = [];
  for (const { field, text } of fields) {
    const value = prose(text);
    const add = (rule, claim, detail) => findings.push({ rule, field, claim, detail,
      severity: blocking ? 'high' : 'warning', businessSlug: null });
    for (const phrase of BANNED_PHRASES) {
      const pattern = new RegExp(`\\b${phrase.replaceAll(' ', '[\\s-]+')}\\b`, 'i');
      if (pattern.test(value)) add('voice-banned-phrase', phrase, `${field}: replace filler with a sourced local fact`);
    }
    if (/\bnot\b[^.!?\n]{1,100},\s*but\b[^.!?\n]{1,100}/i.test(value))
      add('voice-framing', 'not X, but Y', `${field}: state the useful fact directly`);
    if (/\bthat's\s+it\b/i.test(value))
      add('voice-framing', "that's it", `${field}: remove the stock closing`);
    const dashes = (value.match(/—/g) ?? []).length;
    const words = (value.match(/[\p{L}\p{N}]+/gu) ?? []).length;
    // One per 100 words in each field; a single dash is tolerated.
    if (dashes > Math.max(1, Math.floor(words / 100)))
      add('voice-em-dash-density', `${dashes} em dashes / ${words} words`, `${field}: use full stops or commas`);
  }
  return { ok: !blocking || findings.length === 0, findings };
}

export function voiceWarningEvent(warnings = []) {
  return { event: 'lv-voice-warning', warnOnlySince: VOICE_POLICY.warnOnlySince,
    // Only bounded identifiers leave the lint process, never generated prose.
    ruleCodes: [...new Set(warnings.map((f) => f.rule))].filter((c) =>
      ['voice-banned-phrase', 'voice-framing', 'voice-em-dash-density'].includes(c)) };
}
