// format.ts — 문자열 기반 금액 포매팅. Number 정밀도를 안 타는 게 요점이라
// 큰 정수부/작은 소수부 경계를 집중적으로 본다.
import { describe, expect, test } from 'vitest';
import { describeHookKeys, formatAmount, shortAddress, tokenOf } from '../src/format';

describe('formatAmount', () => {
  test.each([
    // [raw, decimals, expected]
    ['1234567890000000000000', 18, '1,234.5678'], // 정수부 있으면 소수 4자리
    ['1000000000000000000', 18, '1'], // 소수부 0은 통째로 떨어진다
    ['1500000', 6, '1.5'], // 뒤 0 제거
    ['0', 18, '0'],
    ['123', 18, '0.000000000000000123'], // 유효숫자 나올 때까지 확장
    ['100000000000000', 18, '0.0001'],
    ['-1500000', 6, '-1.5'],
    ['1234567', 0, '1,234,567'], // decimals 0
    ['999', 2, '9.99'],
  ] as Array<[string, number, string]>)('%s (dec %i) → %s', (raw, decimals, expected) => {
    expect(formatAmount(raw, decimals)).toBe(expected);
  });

  test('precision beyond Number.MAX_SAFE_INTEGER survives', () => {
    // 2^53+1 스케일 — Number를 거치면 마지막 자리가 깨진다.
    expect(formatAmount('9007199254740993', 0)).toBe('9,007,199,254,740,993');
  });
});

describe('shortAddress / tokenOf', () => {
  test('long addresses get elided, short strings pass through', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(shortAddress('native')).toBe('native');
  });

  test('unknown token falls back to elided address + 18 decimals', () => {
    const m = tokenOf({}, '0x1234567890abcdef1234567890abcdef12345678');
    expect(m.symbol).toBe('0x1234…5678');
    expect(m.decimals).toBe(18);
  });

  test('null token yields empty symbol', () => {
    expect(tokenOf({}, null).symbol).toBe('');
  });
});

describe('describeHookKeys', () => {
  test('BEFORE+AFTER collapses to aroundSwap', () => {
    expect(describeHookKeys(['BEFORE_SWAP', 'AFTER_SWAP'])).toEqual(['trait.aroundSwap']);
  });
  test('returns-delta flags mean fees', () => {
    expect(describeHookKeys(['AFTER_SWAP', 'AFTER_SWAP_RETURNS_DELTA'])).toEqual([
      'trait.afterSwap',
      'trait.fees',
    ]);
  });
  test('empty permissions yield nothing', () => {
    expect(describeHookKeys([])).toEqual([]);
    expect(describeHookKeys()).toEqual([]);
  });
});
