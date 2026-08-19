import type { TokenMeta } from './types';

/**
 * raw 정수 + decimals → 사람이 읽는 금액.
 *
 * 토큰 금액은 정수부가 매우 크고 소수부가 매우 작을 수 있어서 Number로 옮기면
 * 정밀도가 깨진다. 문자열 단위로 자른다.
 */
export function formatAmount(raw: string, decimals: number): string {
  const neg = raw.startsWith('-');
  const digits = (neg ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const frac = decimals ? digits.slice(digits.length - decimals) : '';

  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let shown: string;
  if (whole !== '0') {
    // 정수부가 있으면 소수 4자리면 충분하다.
    shown = trimZeros(frac.slice(0, 4));
  } else {
    // 0.0000123 같은 값 — 유효숫자가 나올 때까지 자릿수를 늘린다.
    const firstSig = frac.search(/[1-9]/);
    shown = firstSig < 0 ? '' : trimZeros(frac.slice(0, firstSig + 3));
  }

  return (neg ? '-' : '') + wholeGrouped + (shown ? `.${shown}` : '');
}

const trimZeros = (s: string) => s.replace(/0+$/, '');

export function tokenOf(tokens: Record<string, TokenMeta>, address: string | null): TokenMeta {
  if (!address) return { address: '', symbol: '', decimals: 18, name: null };
  return tokens[address] ?? { address, symbol: shortAddress(address), decimals: 18, name: null };
}

export function formatEdgeAmount(
  tokens: Record<string, TokenMeta>,
  amount: string | null,
  token: string | null,
): string {
  if (!amount || !token) return '';
  const meta = tokenOf(tokens, token);
  return `${formatAmount(amount, meta.decimals)} ${meta.symbol}`;
}

export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export type HookTraitKey =
  | 'trait.aroundSwap'
  | 'trait.beforeSwap'
  | 'trait.afterSwap'
  | 'trait.fees'
  | 'trait.addLiquidity'
  | 'trait.removeLiquidity';

/**
 * 훅 권한 비트 → i18n 키. 주소에서 공짜로 읽히므로 M4 매핑 전에도 쓸 수 있다.
 * 번역과 말줄임은 렌더링 쪽 몫 — 언어에 따라 글자 폭이 달라서 여기서 자르면 틀린다.
 */
export function describeHookKeys(permissions: string[] = []): HookTraitKey[] {
  const out: HookTraitKey[] = [];
  const has = (p: string) => permissions.includes(p);
  if (has('BEFORE_SWAP') && has('AFTER_SWAP')) out.push('trait.aroundSwap');
  else if (has('BEFORE_SWAP')) out.push('trait.beforeSwap');
  else if (has('AFTER_SWAP')) out.push('trait.afterSwap');
  if (has('BEFORE_SWAP_RETURNS_DELTA') || has('AFTER_SWAP_RETURNS_DELTA')) out.push('trait.fees');
  if (has('BEFORE_ADD_LIQUIDITY') || has('AFTER_ADD_LIQUIDITY')) out.push('trait.addLiquidity');
  if (has('BEFORE_REMOVE_LIQUIDITY') || has('AFTER_REMOVE_LIQUIDITY')) out.push('trait.removeLiquidity');
  return out;
}
