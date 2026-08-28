// 픽스처를 fs로 읽는다 — 슬러그가 동적이라 import 글롭보다 단순하다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEntry, Graph } from '../src/types';

const DIR = join(import.meta.dirname, '../src/fixtures');

export const apps: AppEntry[] = JSON.parse(readFileSync(join(DIR, 'apps.json'), 'utf8'));

export const fixtureFiles: string[] = readdirSync(DIR).filter(
  (f) => f.endsWith('.json') && f !== 'apps.json',
);

export const loadGraph = (slug: string): Graph =>
  JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf8'));

/** [slug, graph] 전체 목록 — describe.each/test.each 용. */
export const allGraphs: Array<[string, Graph]> = fixtureFiles.map((f) => {
  const slug = f.replace(/\.json$/, '');
  return [slug, loadGraph(slug)];
});
