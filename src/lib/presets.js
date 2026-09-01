/**
 * Animal presets — from the Broodiinnox User Manual (Section 6: Factory Reset
 * presets: Chicken, Pig, Turkey, Duck). Targets auto step down with age.
 */
export const ANIMALS = {
  chicken: { key: 'chicken', baseMin: 35, baseMax: 37, durationDays: 21, safetyFloor: 20, tips: 'Keep bedding dry. Raise the lamp 2 cm every week.' },
  duck: { key: 'duck', baseMin: 33, baseMax: 35, durationDays: 28, safetyFloor: 20, tips: 'Ducklings need a slightly cooler start and extra water access.' },
  turkey: { key: 'turkey', baseMin: 34, baseMax: 36, durationDays: 28, safetyFloor: 20, tips: 'Poults are sensitive to drafts — keep the box shielded.' },
  pig: { key: 'pig', baseMin: 30, baseMax: 32, durationDays: 21, safetyFloor: 20, tips: 'Piglets pile when cold — check for huddling under the lamp.' },
};

export const ANIMAL_KEYS = Object.keys(ANIMALS);
