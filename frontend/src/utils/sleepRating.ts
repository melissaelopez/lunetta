import { DateTime } from 'luxon';

export type SleepTier = 'excellent' | 'good' | 'solid' | 'tough';

export interface TierMeta {
  tier: SleepTier;
  label: string;
  chipClass: string;
  dotClass: string;
  headlinePhrase: string;
  subtitle: string;
}

const TIER_META: Record<SleepTier, TierMeta> = {
  excellent: {
    tier: 'excellent',
    label: 'Excellent',
    chipClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
    headlinePhrase: 'an excellent night',
    subtitle: 'Restful, well-paced sleep all night.',
  },
  good: {
    tier: 'good',
    label: 'Good',
    chipClass: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
    dotClass: 'bg-teal-500 dark:bg-teal-400',
    headlinePhrase: 'a good night',
    subtitle: 'Steady rest with strong sleep stretches.',
  },
  solid: {
    tier: 'solid',
    label: 'Solid',
    chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    headlinePhrase: 'a solid night',
    subtitle: 'Building strong sleep skills.',
  },
  tough: {
    tier: 'tough',
    label: 'Tough',
    chipClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    dotClass: 'bg-rose-500 dark:bg-rose-400',
    headlinePhrase: 'a tough night',
    subtitle: 'A bumpy stretch — hang in there.',
  },
};

export function getTierMeta(tier: SleepTier): TierMeta {
  return TIER_META[tier];
}

export function rateTotalScore(score: number): SleepTier {
  if (score >= 88) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'solid';
  return 'tough';
}

export function rateDuration(durationScore: number): SleepTier {
  if (durationScore >= 35) return 'excellent';
  if (durationScore >= 30) return 'good';
  if (durationScore >= 25) return 'solid';
  return 'tough';
}

export function rateContinuity(continuityScore: number): SleepTier {
  if (continuityScore >= 33) return 'excellent';
  if (continuityScore >= 28) return 'good';
  if (continuityScore >= 20) return 'solid';
  return 'tough';
}

export function rateStretch(onsetScore: number): SleepTier {
  if (onsetScore >= 15) return 'excellent';
  if (onsetScore >= 12) return 'good';
  if (onsetScore >= 9) return 'solid';
  return 'tough';
}

export function rateTiming(timingScore: number): SleepTier {
  if (timingScore >= 15) return 'excellent';
  if (timingScore >= 12) return 'good';
  if (timingScore >= 8) return 'solid';
  return 'tough';
}

export function rateWakeTime(wakeIso: string, expectedWakeHour: number): SleepTier | null {
  const dt = DateTime.fromISO(wakeIso);
  if (!dt.isValid) return null;
  const localHour = dt.hour + dt.minute / 60;
  const diff = Math.abs(localHour - expectedWakeHour);
  if (diff <= 0.5) return 'excellent';
  if (diff <= 1.0) return 'good';
  if (diff <= 1.5) return 'solid';
  return 'tough';
}
