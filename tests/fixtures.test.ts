// 카탈로그(apps.json)와 픽스처 파일이 서로 어긋나지 않는지.
// UI는 이 정합성을 전제로 동작한다 — 슬러그로 글롭을 찾고, 메타 숫자를 그대로 그린다.
// 픽스처를 재생성(spike/build-fixtures.mjs)한 뒤 여기가 깨지면 파이프라인 버그다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { allGraphs, apps, fixtureFiles, loadGraph } from './helpers';

const flows = apps.flatMap((a) => a.flows.map((f) => ({ app: a, flow: f })));

describe('catalog ↔ fixture consistency', () => {
  test('flow slugs are unique across all chains (URL ?flow= relies on this)', () => {
    const slugs = flows.map(({ flow }) => flow.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('app urls are https or explicitly null', () => {
    for (const a of apps) {
      expect(a).toHaveProperty('url');
      if (a.url !== null) expect(a.url).toMatch(/^https:\/\//);
    }
  });

  test('every fixture file is referenced by exactly one flow', () => {
    const slugs = new Set(flows.map(({ flow }) => flow.slug));
    for (const f of fixtureFiles) expect(slugs).toContain(f.replace(/\.json$/, ''));
    expect(fixtureFiles.length).toBe(slugs.size);
  });

  test.each(flows.map(({ app, flow }) => [flow.slug, app, flow] as const))(
    '%s: metadata matches fixture contents',
    (slug, app, flow) => {
      const g = loadGraph(slug);
      expect(flow.file).toBe(`${slug}.json`);
      expect(g.txHash).toBe(flow.hash);
      expect(g.chain).toBe(app.chain);
      expect(g.nodes.length).toBe(flow.nodes);
      expect(g.edges.length).toBe(flow.edges);
      expect(g.nodes.filter((n) => n.type === 'hook').length).toBe(flow.hooks);
      expect(g.edges.filter((e) => e.hidden && e.amount).length).toBe(flow.hiddenValueEdges);
      expect(g.balanced).toBe(flow.balanced);
    },
  );
});

// build-fixtures.mjs는 같은 내용을 src/fixtures와 spike/fixtures 양쪽에 쓴다.
// 한쪽만 고치면 이 대조가 깨진다 — 실제로 한 번 그랬다 (커밋 53d1238의 CI 실패).
describe('src ↔ spike fixture copies stay in sync', () => {
  const SPIKE = join(import.meta.dirname, '../spike/fixtures');

  test('same file list on both sides', () => {
    const spikeFiles = readdirSync(SPIKE).filter((f) => f.endsWith('.json'));
    expect(spikeFiles.sort()).toEqual([...fixtureFiles, 'apps.json'].sort());
  });

  test.each([...fixtureFiles, 'apps.json'])('%s: identical content', (file) => {
    const src = JSON.parse(readFileSync(join(import.meta.dirname, '../src/fixtures', file), 'utf8'));
    const spike = JSON.parse(readFileSync(join(SPIKE, file), 'utf8'));
    expect(src).toEqual(spike);
  });
});

describe('graph structural invariants', () => {
  test.each(allGraphs)('%s: node ids unique, edges reference real nodes', (_slug, g) => {
    const ids = g.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(ids);
    for (const e of g.edges) {
      expect(known).toContain(e.from);
      expect(known).toContain(e.to);
      if (e.via) expect(known).toContain(e.via);
    }
  });

  test.each(allGraphs)('%s: amount/token pairing and token metadata', (_slug, g) => {
    for (const e of g.edges) {
      // reach 엣지는 값이 없고, 값이 있는 엣지는 토큰과 항상 짝이다.
      if (e.layer === 'reach') {
        expect(e.amount).toBeNull();
        expect(e.token).toBeNull();
      }
      expect(e.amount === null).toBe(e.token === null);
      if (e.amount !== null) expect(() => BigInt(e.amount!)).not.toThrow();
      if (e.token !== null) expect(g.tokens[e.token]).toBeDefined();
      expect(e.engineer.call).toBeTruthy();
    }
  });
});
