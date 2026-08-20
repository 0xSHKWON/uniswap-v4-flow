// 사전 두 개짜리 최소 i18n. 라이브러리 없음.
//
// 언어는 URL(?lang=ko)에 담는다 — 공유 링크가 보던 화면 그대로 열려야 한다는
// 기획서 §4의 규칙(모드를 URL에 담는다)을 언어에도 똑같이 적용한 것.
// 기본값은 영어. 파라미터가 없으면 en이고, en일 때는 URL을 더럽히지 않는다.
import { useEffect, useState } from 'react';

export type Locale = 'en' | 'ko';

const en = {
  title: 'Uniswap v4 Transaction Flow',

  'role.pool': 'V4 Core',
  'role.payer': 'Paid',
  'role.recipient': 'Received',
  'role.hook': 'Hook',
  'role.external': 'Called by hook',

  'node.pm.sub': 'Every settlement passes through here',
  'node.wallet.sub': 'The wallet that sent this tx',
  'node.hook.noInfo': 'No permission info',
  'node.hook.externals': '{n} external contracts',

  'trait.aroundSwap': 'Acts around swaps',
  'trait.beforeSwap': 'Acts before swaps',
  'trait.afterSwap': 'Acts after swaps',
  'trait.fees': 'Can take fees',
  'trait.addLiquidity': 'Acts on liquidity adds',
  'trait.removeLiquidity': 'Acts on liquidity removals',

  'edge.noTransfer': 'No Transfer event',
  'edge.intervened': 'Intervened · no value moved',
  'edge.calls': '{n} calls',

  'legend.settled': 'Settled flow',
  'legend.hidden': 'Flow with no Transfer event',
  'legend.hook': 'Hook',
  note: 'A factual account of what happened in this transaction — it does not rate pools or hooks.',

  'detail.call': 'Call',
  'detail.movements': '{n} movements',
  'detail.claimNote':
    'This is an ERC-6909 claim: the tokens never leave PoolManager, so no Transfer event is emitted and ordinary explorers do not show this movement.',

  'examples.label': 'Examples',
  'examples.meta': '{nodes} nodes · {hooks} hooks',

  'diagram.aria': 'Money flow diagram for transaction {hash}',

  'hash.copied': 'Copied',

  'side.tx': 'Transaction',
  'side.summary': 'Summary',
  'sum.movements': 'Value movements',
  'sum.hidden': 'No Transfer event',
  'sum.tokens': 'Tokens',
  'sum.hooks': 'Hooks',

  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.fit': 'Fit to view',

  'follow.label': 'Follow the flow',
  'follow.prev': 'Previous step',
  'follow.next': 'Next step',
  'follow.exit': 'Exit',
} as const;

export type StringKey = keyof typeof en;

const ko: Record<StringKey, string> = {
  title: 'Uniswap v4 트랜잭션 흐름',

  'role.pool': 'V4 코어',
  'role.payer': '지불',
  'role.recipient': '수령',
  'role.hook': '훅',
  'role.external': '훅이 호출한 컨트랙트',

  'node.pm.sub': '모든 정산이 여기를 통과한다',
  'node.wallet.sub': '이 트랜잭션을 보낸 지갑',
  'node.hook.noInfo': '권한 정보 없음',
  'node.hook.externals': '외부 컨트랙트 {n}개',

  'trait.aroundSwap': '스왑 전후 개입',
  'trait.beforeSwap': '스왑 전 개입',
  'trait.afterSwap': '스왑 후 개입',
  'trait.fees': '수수료 회수 가능',
  'trait.addLiquidity': '유동성 공급 개입',
  'trait.removeLiquidity': '유동성 회수 개입',

  'edge.noTransfer': 'Transfer 이벤트 없음',
  'edge.intervened': '개입 · 값 이동 없음',
  'edge.calls': '호출 {n}회',

  'legend.settled': '정산된 이동',
  'legend.hidden': 'Transfer 이벤트가 없는 이동',
  'legend.hook': '훅',
  note: '이 화면은 이 트랜잭션에서 일어난 일을 그대로 서술한다. 풀이나 훅에 대한 평가는 하지 않는다.',

  'detail.call': '호출',
  'detail.movements': '이동 {n}건',
  'detail.claimNote':
    'ERC-6909 청구권이라 토큰이 PoolManager 밖으로 나가지 않는다. Transfer 이벤트가 없으므로 일반 익스플로러에는 이 이동이 표시되지 않는다.',

  'examples.label': '예시 트랜잭션',
  'examples.meta': '노드 {nodes} · 훅 {hooks}',

  'diagram.aria': '트랜잭션 {hash} 자금 흐름도',

  'hash.copied': '복사됨',

  'side.tx': '트랜잭션',
  'side.summary': '요약',
  'sum.movements': '값 이동',
  'sum.hidden': 'Transfer 이벤트 없음',
  'sum.tokens': '토큰',
  'sum.hooks': '훅',

  'zoom.in': '확대',
  'zoom.out': '축소',
  'zoom.fit': '전체 보기',

  'follow.label': '흐름 따라가기',
  'follow.prev': '이전 단계',
  'follow.next': '다음 단계',
  'follow.exit': '닫기',
};

const STRINGS: Record<Locale, Record<StringKey, string>> = { en, ko };

export function t(locale: Locale, key: StringKey, vars?: Record<string, string | number>): string {
  let s = STRINGS[locale][key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function useLocale(): [Locale, (l: Locale) => void] {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const p = new URLSearchParams(window.location.search).get('lang');
    return p === 'ko' ? 'ko' : 'en';
  });

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    const url = new URL(window.location.href);
    if (l === 'en') url.searchParams.delete('lang');
    else url.searchParams.set('lang', l);
    history.replaceState(null, '', url);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t(locale, 'title');
  }, [locale]);

  return [locale, setLocale];
}
