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
  'legend.acct': 'Accounting delta (obligation)',
  'legend.hook': 'Hook',

  'mode.label': 'View mode',
  'mode.trader': 'Trader',
  'mode.engineer': 'Engineer',
  note: 'A factual account of what happened in this transaction — it does not rate pools or hooks.',

  'detail.call': 'Call',
  'detail.movements': '{n} movements',
  'detail.claimNote':
    'This is an ERC-6909 claim: the tokens never leave PoolManager, so no Transfer event is emitted and ordinary explorers do not show this movement.',

  'apps.label': 'Apps on v4',
  'apps.flows': '{n} flows',
  'flow.meta': '{nodes} nodes · {hooks} hooks',

  'diagram.aria': 'Money flow diagram for transaction {hash}',

  'hash.explorer': 'View on the block explorer',

  'side.app': 'App',
  'side.tx': 'Transaction',
  'sum.moves': '{n} value movements',
  'sum.move1': '1 value movement',
  'sum.hiddenShort': '{n} with no Transfer event',
  'sum.hooks': 'Hooks',

  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.fit': 'Fit to view',

  'chain.select': 'Select chain',
  'chain.soon': 'Soon',

  'follow.label': 'Follow the flow',
  'follow.prev': 'Previous step',
  'follow.next': 'Next step',
  'follow.exit': 'Exit',

  'trace.title': 'Call trace',
  'trace.ops': '{n} ledger ops inside unlock()',
  'trace.outstanding': 'Outstanding deltas',
  'trace.afterLine': 'after #{n}',
  'trace.atEnd': 'at end of unlock()',
  'trace.allZero': 'all deltas settled to 0 ✓',
  'trace.unbalanced': 'deltas do not zero out — reconstruction incomplete',
  'trace.signHint': '+ PoolManager owes · − owed to PoolManager',
  'trace.hooks': 'Hook permission bits',
  'trace.hooksSub': 'v4 encodes hook permissions in the low 14 bits of the hook address',
  'trace.callbacks': 'callbacks in this tx',
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
  'legend.acct': '회계 델타 (채무)',
  'legend.hook': '훅',

  'mode.label': '보기 모드',
  'mode.trader': '트레이더',
  'mode.engineer': '엔지니어',
  note: '이 화면은 이 트랜잭션에서 일어난 일을 그대로 서술한다. 풀이나 훅에 대한 평가는 하지 않는다.',

  'detail.call': '호출',
  'detail.movements': '이동 {n}건',
  'detail.claimNote':
    'ERC-6909 청구권이라 토큰이 PoolManager 밖으로 나가지 않는다. Transfer 이벤트가 없으므로 일반 익스플로러에는 이 이동이 표시되지 않는다.',

  'apps.label': 'v4 위의 앱들',
  'apps.flows': '흐름 {n}개',
  'flow.meta': '노드 {nodes} · 훅 {hooks}',

  'diagram.aria': '트랜잭션 {hash} 자금 흐름도',

  'hash.explorer': '블록 익스플로러에서 보기',

  'side.app': '앱',
  'side.tx': '트랜잭션',
  'sum.moves': '값 이동 {n}건',
  'sum.move1': '값 이동 1건',
  'sum.hiddenShort': 'Transfer 이벤트 없는 이동 {n}건',
  'sum.hooks': '훅',

  'zoom.in': '확대',
  'zoom.out': '축소',
  'zoom.fit': '전체 보기',

  'chain.select': '체인 선택',
  'chain.soon': '예정',

  'follow.label': '흐름 따라가기',
  'follow.prev': '이전 단계',
  'follow.next': '다음 단계',
  'follow.exit': '닫기',

  'trace.title': '호출 트레이스',
  'trace.ops': 'unlock() 안의 장부 기록 {n}건',
  'trace.outstanding': '미정산 델타',
  'trace.afterLine': '#{n} 이후',
  'trace.atEnd': 'unlock() 종료 시점',
  'trace.allZero': '모든 델타가 0으로 정산됨 ✓',
  'trace.unbalanced': '델타가 0이 되지 않음 — 복원 불완전',
  'trace.signHint': '+ PoolManager가 줄 것 · − PoolManager가 받을 것',
  'trace.hooks': '훅 권한 비트',
  'trace.hooksSub': 'v4는 훅 권한을 훅 주소의 하위 14비트에 인코딩한다',
  'trace.callbacks': '이번 트랜잭션의 콜백',
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
