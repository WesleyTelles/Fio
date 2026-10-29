import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { beginBusy, flashMascot, FLASH_MS, mascotBusy, mascotFlash, mascotMood, resetMascot, resolveMood } from '../../src/lib/mascot.ts';

beforeEach(() => { vi.useFakeTimers(); resetMascot(); });
afterEach(() => { resetMascot(); vi.useRealTimers(); });

describe('mascote: hierarquia de estados', () => {
  it('oops > happy > busy > idle', () => {
    expect(resolveMood(0, null)).toBe('idle');
    expect(resolveMood(2, null)).toBe('busy');
    expect(resolveMood(2, { kind: 'happy', id: 1 })).toBe('happy');
    expect(resolveMood(2, { kind: 'oops', id: 2 })).toBe('oops');
    expect(resolveMood(0, { kind: 'oops', id: 2 })).toBe('oops');
  });
  it('só fica "busy" enquanto há trabalho real e volta ao repouso quando termina', () => {
    expect(mascotMood.value).toBe('idle');
    const end = beginBusy(); expect(mascotMood.value).toBe('busy');
    end(); expect(mascotMood.value).toBe('idle');
  });
  it('encerrar duas vezes não zera a contagem de outra operação em andamento', () => {
    const a = beginBusy(), b = beginBusy(); expect(mascotBusy.value).toBe(2);
    a(); a(); expect(mascotBusy.value).toBe(1); expect(mascotMood.value).toBe('busy');
    b(); expect(mascotMood.value).toBe('idle');
  });
  it('reação "happy" é curta e expira sozinha', () => {
    flashMascot('happy'); expect(mascotMood.value).toBe('happy');
    vi.advanceTimersByTime(FLASH_MS.happy - 1); expect(mascotMood.value).toBe('happy');
    vi.advanceTimersByTime(2); expect(mascotMood.value).toBe('idle');
  });
  it('nova reação substitui a anterior sem empilhar nem ser apagada pelo timer antigo', () => {
    flashMascot('happy'); vi.advanceTimersByTime(1000); flashMascot('oops');
    vi.advanceTimersByTime(FLASH_MS.happy - 1000 + 5);           // o timer do "happy" original já passou
    expect(mascotFlash.value?.kind).toBe('oops'); expect(mascotMood.value).toBe('oops');
    vi.advanceTimersByTime(FLASH_MS.oops); expect(mascotMood.value).toBe('idle');
  });
});
