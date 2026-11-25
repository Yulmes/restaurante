import { describe, expect, it } from 'vitest';
import { addDays, localDateOf, localDateTime, localTimeOf } from './time.ts';

const CR = 'America/Costa_Rica';

describe('fechas locales del local', () => {
  it('el día local de Costa Rica empieza a las 06:00 UTC', () => {
    expect(localDateTime('2026-11-24', CR).toISOString()).toBe('2026-11-24T06:00:00.000Z');
    expect(localDateTime('2026-11-24', CR, 7 * 60 + 30).toISOString()).toBe('2026-11-24T13:30:00.000Z');
  });

  it('la fecha y la hora local de un instante', () => {
    // 03:00 UTC del 25 son las 21:00 del 24 en Costa Rica.
    const instant = new Date('2026-11-25T03:00:00.000Z');
    expect(localDateOf(instant, CR)).toBe('2026-11-24');
    expect(localTimeOf(instant, CR)).toBe('21:00');
  });

  it('respeta el horario de verano de otras zonas', () => {
    // Nueva York: UTC−4 en julio, UTC−5 en enero.
    expect(localDateTime('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(localDateTime('2026-01-01', 'America/New_York').toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });

  it('suma días de calendario cruzando meses y años', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-11-24', -6)).toBe('2026-11-18');
  });
});
