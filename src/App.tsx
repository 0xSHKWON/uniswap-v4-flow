// M1 — 단일 트랜잭션 렌더링. 해시 하드코딩, 배포 안 함 (기획서 §8).
//
// 입력창은 M2, 모드 토글은 M3이므로 여기엔 없다.
// 예시 선택기는 레이아웃이 복잡도 사다리 전체에서 무너지지 않는지 확인하려고 둔 개발용 장치다.
import { useState } from 'react';
import { Diagram } from './Diagram';
import type { FixtureIndexEntry, Graph } from './types';

import index from './fixtures/index.json';
import noHook from './fixtures/01-no-hook.json';
import hookFee from './fixtures/02-hook-takes-fee.json';
import hookReach from './fixtures/03-hook-with-reach.json';
import dense from './fixtures/04-dense.json';
import twoHooks from './fixtures/05-two-hooks.json';
import multihop from './fixtures/06-multihop-three-hooks.json';

const GRAPHS: Record<string, Graph> = {
  '01-no-hook': noHook as Graph,
  '02-hook-takes-fee': hookFee as Graph,
  '03-hook-with-reach': hookReach as Graph,
  '04-dense': dense as Graph,
  '05-two-hooks': twoHooks as Graph,
  '06-multihop-three-hooks': multihop as Graph,
};

const FIXTURES = index as FixtureIndexEntry[];
const DEFAULT_SLUG = '03-hook-with-reach';

export default function App() {
  const [slug, setSlug] = useState(DEFAULT_SLUG);
  const graph = GRAPHS[slug];
  const meta = FIXTURES.find((f) => f.slug === slug);

  return (
    <div className="viz-root">
      <header className="header">
        <div>
          <h1>Uniswap v4 트랜잭션 흐름</h1>
          <p className="tx-hash">
            <span className="chain">{graph.chain}</span>
            <code>{graph.txHash}</code>
          </p>
        </div>
      </header>

      {meta && (
        <p className="blurb">
          <strong>{meta.title}</strong> — {meta.blurb}
        </p>
      )}

      <Diagram key={slug} graph={graph} />

      <footer className="footer">
        <p className="legend">
          <span className="swatch swatch-flow" /> 정산된 이동
          <span className="swatch swatch-hidden" /> Transfer 이벤트가 없는 이동
          <span className="swatch swatch-hook" /> 훅
        </p>
        <p className="note">
          이 화면은 이 트랜잭션에서 일어난 일을 그대로 서술한다. 풀이나 훅에 대한 평가는 하지 않는다.
        </p>
      </footer>

      {/* 개발용: 복잡도 사다리를 훑어보며 레이아웃을 점검한다. M2의 예시 버튼과는 별개. */}
      <nav className="devbar" aria-label="개발용 예시 전환">
        {FIXTURES.map((f) => (
          <button key={f.slug} className={f.slug === slug ? 'is-active' : ''} onClick={() => setSlug(f.slug)}>
            {f.title}
            <span>
              노드 {f.nodes} · 훅 {f.hooks}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
