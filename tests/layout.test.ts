// layout.ts — 배치·라우팅이 모든 픽스처에서 성립해야 하는 성질들.
// 특정 좌표를 못박는 대신 (디자인 조정마다 깨진다) 구조적 성질만 검사한다.
import { describe, expect, test } from 'vitest';
import { declutter, layout, nodeObstacles, type LabelBox } from '../src/layout';
import { allGraphs } from './helpers';

const finite = (n: number) => Number.isFinite(n);

describe('layout over every fixture', () => {
  test.each(allGraphs)('%s: routed edges connect placed nodes, coords finite', (_slug, g) => {
    for (const engineer of [false, true]) {
      const view = layout(g, new Set(), engineer);
      const placed = new Set(view.nodes.map((n) => n.id));
      expect(view.nodes.length).toBeGreaterThan(0);
      for (const e of view.edges) {
        expect(placed).toContain(e.from);
        expect(placed).toContain(e.to);
        expect(e.points.length).toBeGreaterThanOrEqual(2);
        for (const p of e.points) expect(finite(p.x) && finite(p.y)).toBe(true);
        expect(e.label.rowsY.length).toBe(e.rows.length);
        for (const r of e.rows) expect(() => BigInt(r.amount)).not.toThrow();
      }
      expect(view.viewBox.w).toBeGreaterThan(0);
      expect(view.viewBox.h).toBeGreaterThan(0);
      expect([view.viewBox.x, view.viewBox.y].every(finite)).toBe(true);
    }
  });

  test.each(allGraphs)('%s: engineer mode adds accounting trunks on top of trader view', (_slug, g) => {
    const trader = layout(g, new Set(), false);
    const engineer = layout(g, new Set(), true);
    expect(trader.edges.every((e) => e.kind === 'settlement')).toBe(true);
    expect(engineer.edges.length).toBeGreaterThanOrEqual(trader.edges.length);
  });

  test('expanding hooks materializes reach edges (aegis-swap)', () => {
    const g = allGraphs.find(([slug]) => slug === 'aegis-swap')![1];
    const hookIds = g.nodes.filter((n) => n.type === 'hook').map((n) => n.id);
    const collapsed = layout(g, new Set());
    const expanded = layout(g, new Set(hookIds));
    expect(collapsed.reach.length).toBe(0);
    expect(expanded.reach.length).toBeGreaterThan(0);
    expect(expanded.nodes.length).toBeGreaterThanOrEqual(collapsed.nodes.length);
  });
});

describe('declutter', () => {
  const box = (key: string, x: number, y: number, w = 100, h = 20): LabelBox => ({ key, x, y, w, h });

  const overlaps = (a: LabelBox, b: LabelBox, gap = 6) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;

  test('stacked labels get pushed apart until nothing overlaps', () => {
    const boxes = [box('a', 0, 0), box('b', 0, 2), box('c', 0, 4), box('d', 300, 0)];
    const nudge = declutter(boxes);
    const moved = boxes.map((b) => ({ ...b, y: b.y + (nudge.get(b.key) ?? 0) }));
    for (let i = 0; i < moved.length; i++)
      for (let j = i + 1; j < moved.length; j++) expect(overlaps(moved[i], moved[j])).toBe(false);
    // 떨어져 있던 라벨은 건드리지 않는다
    expect(nudge.has('d')).toBe(false);
  });

  test('fixed obstacles push labels but never move themselves', () => {
    const obstacle = box('node:pm', 0, 10, 200, 80);
    const label = box('l', 0, 0);
    const nudge = declutter([label], [obstacle]);
    const dy = nudge.get('l') ?? 0;
    expect(dy).toBeGreaterThan(0);
    expect(overlaps({ ...label, y: label.y + dy }, obstacle)).toBe(false);
  });

  test('labels only move down (blocks slide, never jump above)', () => {
    for (const [, g] of allGraphs) {
      const view = layout(g, new Set(), true);
      const boxes: LabelBox[] = view.edges.map((e, i) => ({
        key: e.key,
        x: e.label.x,
        y: e.label.rowsY[0] + i, // 실측 대신 근사 — 성질만 본다
        w: 120,
        h: 16,
      }));
      for (const dy of declutter(boxes, nodeObstacles(view.nodes)).values())
        expect(dy).toBeGreaterThan(0);
    }
  });
});
