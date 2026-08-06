import assert from 'node:assert/strict';
import test from 'node:test';

const analytics = await import('../../lib/analytics.ts');

test('analytics configuration fails closed and accepts only the US ingest host', () => {
  assert.equal(analytics.parseAnalyticsConfig({}), null);
  assert.equal(
    analytics.parseAnalyticsConfig({
      key: 'phc_public',
      host: 'https://example.com',
      environment: 'production',
    }),
    null,
  );
  assert.equal(
    analytics.parseAnalyticsConfig({
      key: 'phx_personal-token',
      environment: 'production',
    }),
    null,
  );
  assert.deepEqual(
    analytics.parseAnalyticsConfig({
      key: 'phc_public',
      environment: 'preview',
    }),
    {
      key: 'phc_public',
      host: 'https://us.i.posthog.com',
      environment: 'preview',
    },
  );
});

test('paths and landing attribution omit queries and raw referrers', () => {
  assert.equal(analytics.sanitizePath('/guide/parking?email=person@example.com#map'), '/guide/parking');

  const landing = analytics.buildLandingProperties({
    pathname: '/guide/parking?secret=value',
    search: '?utm_source=person%40example.com&utm_medium=organic&utm_campaign=private%20raw%20text&email=person@example.com',
    referrer: 'https://www.google.ca/search?q=private+query',
  });

  assert.deepEqual(landing, {
    landing_path: '/guide/parking',
    referrer_host: 'google.ca',
    channel: 'organic_search',
  });
  assert.doesNotMatch(
    JSON.stringify(landing),
    /person@example\.com|private\+query|private raw text|secret=value/,
  );
});

test('explicit landing media take precedence over conflicting inferred referrers', () => {
  assert.equal(
    analytics.classifyLandingChannel({ referrerHost: 'google.ca', utmMedium: 'cpc' }),
    'paid_search',
  );
  assert.equal(
    analytics.classifyLandingChannel({ referrerHost: 'google.ca', utmMedium: 'email' }),
    'email',
  );
  assert.equal(
    analytics.classifyLandingChannel({ referrerHost: 'google.ca', utmMedium: 'social' }),
    'social',
  );
  assert.equal(
    analytics.classifyLandingChannel({ referrerHost: 'facebook.com', utmMedium: 'organic' }),
    'organic_search',
  );
  assert.equal(
    analytics.classifyLandingChannel({ referrerHost: 'google.ca', utmMedium: 'referral' }),
    'referral',
  );
  assert.equal(
    analytics.classifyLandingChannel({ referrerHost: 'example.com' }),
    'referral',
  );
  assert.equal(analytics.classifyLandingChannel({}), 'direct');
});

test('PostHog payload sanitization removes persistent identity and raw URL data', () => {
  const properties = analytics.sanitizePosthogProperties({
    token: 'phx_personal-token',
    distinct_id: 'unique-person',
    $device_id: 'unique-device',
    $session_id: 'unique-session',
    $window_id: 'unique-window',
    $initial_current_url: 'https://libertyvillage.co/?email=person@example.com',
    $initial_referrer: 'https://google.ca/search?q=private',
    $current_url: 'https://libertyvillage.co/guide/parking?email=person@example.com',
    $referrer: 'https://google.ca/search?q=private',
    $referring_domain: 'google.ca',
    $geoip_disable: true,
    path: '/guide/parking?email=person@example.com',
    deployment_environment: 'production',
    site_hostname: 'libertyvillage.co',
    raw_text: 'private button label',
    outbound_url: 'https://localpubliceatery.com/private',
    utm_campaign: 'person@example.com',
  });

  assert.equal(properties.distinct_id, 'anonymous');
  assert.equal(properties.$current_url, 'https://libertyvillage.co/guide/parking');
  assert.equal(properties.$referrer, 'google.ca');
  assert.equal(properties.$referring_domain, 'google.ca');
  assert.equal(properties.$geoip_disable, true);
  for (const forbidden of [
    '$device_id',
    '$session_id',
    '$window_id',
    '$initial_current_url',
    '$initial_referrer',
    'raw_text',
    'outbound_url',
    'utm_campaign',
    'token',
  ]) {
    assert.equal(forbidden in properties, false, forbidden);
  }
  assert.doesNotMatch(
    JSON.stringify(properties),
    /unique-|person@example\.com|private|localpubliceatery\.com/,
  );
});
