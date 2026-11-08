import type { CardSegment, Fight } from './schema';

const SEGMENT_LABELS: { [K in CardSegment]: string } = {
  main: 'Main card',
  prelims: 'Prelims',
  early_prelims: 'Early prelims',
};

export function segmentLabel(segment: CardSegment): string {
  return SEGMENT_LABELS[segment];
}

export interface SegmentGroup {
  segment: CardSegment | null;
  fights: Fight[];
}

const SEGMENT_ORDER: (CardSegment | null)[] = ['main', 'prelims', 'early_prelims', null];

/**
 * Fights grouped main card, prelims, early prelims, then unknown, keeping card order within each.
 * ufcstats appends late additions to the end of its list, so the segment decides the group, not the position.
 */
export function groupBySegment(fights: readonly Fight[]): SegmentGroup[] {
  return SEGMENT_ORDER.map((segment) => ({
    segment,
    fights: fights.filter((f) => (f.segment ?? null) === segment),
  })).filter((g) => g.fights.length > 0);
}

/**
 * The card as the page shows it (groupBySegment's groups, top to bottom), with the main event first wherever its
 * segment puts it, as the page marks it. Read bottom-up, this is the running order: the live "Live now" pick reads it.
 */
export function runningOrder<F extends Pick<Fight, 'segment'>>(fights: readonly F[]): F[] {
  const [main, ...rest] = fights;
  if (!main) return [];
  return [main, ...groupBySegment(rest as unknown as Fight[]).flatMap((g) => g.fights as unknown as F[])];
}
