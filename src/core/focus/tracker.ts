export type FocusDay = { milliseconds: number; switches: number };
export type FocusState = FocusDay & { active: boolean; inFlow: boolean; continuous: number; shield: boolean };
const day = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export class FocusTracker {
  private days: Record<string, FocusDay> = {};
  private lastActivity?: number;
  private continuous = 0;
  private focused: boolean;
  private previous: number;
  constructor(now: number, focused: boolean, stored: unknown = {}, private readonly idleMs = 120_000) {
    this.previous = now; this.focused = focused;
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') { continue; }
        const item = value as Record<string, unknown>;
        if (typeof item.milliseconds === 'number' && Number.isFinite(item.milliseconds) && item.milliseconds >= 0
          && typeof item.switches === 'number' && Number.isSafeInteger(item.switches) && item.switches >= 0) {
          this.days[key] = { milliseconds: Math.min(item.milliseconds, 86_400_000), switches: item.switches };
        }
      }
    }
  }
  private today(time: number): FocusDay { return this.days[day(time)] ??= { milliseconds: 0, switches: 0 }; }
  tick(now: number): void {
    now = Math.max(now, this.previous);
    if (this.focused && this.lastActivity !== undefined) {
      const end = Math.min(now, this.lastActivity + this.idleMs);
      let cursor = this.previous;
      while (cursor < end) {
        const date = new Date(cursor); date.setHours(24, 0, 0, 0);
        const next = Math.min(end, date.getTime());
        this.today(cursor).milliseconds += next - cursor;
        this.continuous += next - cursor; cursor = next;
      }
      if (now >= this.lastActivity + this.idleMs) { this.continuous = 0; }
    }
    this.previous = now;
    for (const key of Object.keys(this.days).sort().slice(0, -7)) { delete this.days[key]; }
  }
  heartbeat(now: number): void {
    this.tick(now);
    if (this.focused) { this.lastActivity = now; }
  }
  switchContext(now: number): void {
    this.tick(now); if (this.focused) { this.today(now).switches++; }
  }
  windowFocus(focused: boolean, now: number): void {
    this.tick(now);
    if (!focused && this.focused) { this.today(now).switches++; }
    if (focused !== this.focused) { this.continuous = 0; this.lastActivity = undefined; }
    this.focused = focused;
  }
  state(now: number, flowMs: number, shield: boolean): FocusState {
    this.tick(now);
    const active = this.focused && this.lastActivity !== undefined && now < this.lastActivity + this.idleMs;
    return { ...this.today(now), active, continuous: this.continuous, inFlow: active && this.continuous >= flowMs, shield };
  }
  snapshot(): Record<string, FocusDay> { return structuredClone(this.days); }
}
