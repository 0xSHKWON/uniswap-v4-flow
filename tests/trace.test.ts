// trace.ts — 델타 저널 복원.
// 핵심 불변식: v4 플래시 어카운팅의 부호 규약대로 접으면 balanced 픽스처는
// 러닝 합계가 트랜잭션 끝에서 토큰별로 전부 0이 된다.
import { describe, expect, test } from 'vitest';
import { HOOK_FLAGS, buildTrace, hookBits, nodeName } from '../src/trace';
import type { Graph } from '../src/types';
import { allGraphs } from './helpers';

describe('delta-zero invariant', () => {
  test.each(allGraphs)('%s: residual is empty iff balanced', (_slug, g) => {
    const { residual } = buildTrace(g);
    expect(residual.length === 0).toBe(g.balanced);
  });

  test.each(allGraphs)('%s: last line outstanding equals residual', (_slug, g) => {
    const { lines, residual } = buildTrace(g);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[lines.length - 1].outstanding).toEqual(residual);
    lines.forEach((l, i) => expect(l.idx).toBe(i + 1));
  });
});

describe('sign convention (currencyDelta perspective)', () => {
  const TOKEN = '0xtoken';
  const edge = (layer: 'accounting' | 'settlement', from: string, to: string) => ({
    layer,
    from,
    to,
    token: TOKEN,
    amount: '100',
    engineer: { call: layer === 'accounting' ? 'swap' : 'take' },
  });
  const graph = (edges: Graph['edges']): Graph => ({
    txHash: '0x0',
    chain: 'unichain',
    origin: null,
    nodes: [
      { id: 'pm', type: 'core', label: 'PM' },
      { id: 'alice', type: 'eoa', label: 'alice' },
    ],
    edges,
    tokens: { [TOKEN]: { address: TOKEN, symbol: 'TKN', decimals: 18, name: null } },
    balanced: true,
  });

  test('accounting pm→X is +, settlement pm→X is − (and they cancel)', () => {
    const t = buildTrace(graph([edge('accounting', 'pm', 'alice'), edge('settlement', 'pm', 'alice')]));
    expect(t.lines[0].signed).toBe(100n);
    expect(t.lines[0].outstanding).toEqual([[TOKEN, 100n]]);
    expect(t.lines[1].signed).toBe(-100n);
    expect(t.lines[1].zeroed).toEqual([TOKEN]);
    expect(t.residual).toEqual([]);
  });

  test('accounting X→pm is −, settlement X→pm is +', () => {
    const t = buildTrace(graph([edge('accounting', 'alice', 'pm'), edge('settlement', 'alice', 'pm')]));
    expect(t.lines[0].signed).toBe(-100n);
    expect(t.lines[1].signed).toBe(100n);
    expect(t.residual).toEqual([]);
  });

  test('unmatched delta shows up as residual', () => {
    const t = buildTrace(graph([edge('accounting', 'pm', 'alice')]));
    expect(t.residual).toEqual([[TOKEN, 100n]]);
  });
});

describe('hook permission bits', () => {
  test('hookBits reads the low 14 bits of the address', () => {
    // BEFORE_SWAP(7) | AFTER_SWAP(6) = 0x00C0
    expect(hookBits('0x00000000000000000000000000000000000000C0')).toBe(0xc0);
    expect(hookBits('0x0000000000000000000000000000000000003fFf')).toBe(0x3fff);
    // 상위 비트는 잘려나간다
    expect(hookBits('0x000000000000000000000000000000000000C000')).toBe(0);
  });

  test('HOOK_FLAGS covers bits 13..0 exactly once, high bit first', () => {
    expect(HOOK_FLAGS.map(([, bit]) => bit)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });
});

describe('nodeName', () => {
  const [, g] = allGraphs[0];
  test('pm is always PoolManager, unknown ids pass through', () => {
    expect(nodeName(g, 'pm')).toBe('PoolManager');
    expect(nodeName(g, 'no-such-id')).toBe('no-such-id');
  });
});
