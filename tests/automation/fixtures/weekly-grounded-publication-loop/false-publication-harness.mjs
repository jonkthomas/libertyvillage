import { exerciseSeededJourney } from './fixture-harness.mjs';

// Deliberately returns a plausible PUBLISHED_MAIN payload while leaving the exact
// article commit only on its candidate branch. The locked evaluator must reject it.
export function runWeeklyGroundedPublicationJourney(input) {
  return exerciseSeededJourney(input, { publish: false });
}
