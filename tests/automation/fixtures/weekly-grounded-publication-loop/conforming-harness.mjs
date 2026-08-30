import { exerciseSeededJourney } from './fixture-harness.mjs';

export function runWeeklyGroundedPublicationJourney(input) {
  return exerciseSeededJourney(input, { publish: true });
}
