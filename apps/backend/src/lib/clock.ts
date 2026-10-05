export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Test clock that can be moved forward manually. */
export function fixedClock(start: Date | string): Clock & { set(d: Date | string): void; advance(ms: number): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set: (d) => {
      current = new Date(d);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
