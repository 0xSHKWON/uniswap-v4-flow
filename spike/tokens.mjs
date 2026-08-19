// Resolve ERC20 symbol/decimals so fixtures can carry human-readable amounts.
// Baked into the static JSON at build time — the renderer must never need an RPC.
import { rpc } from './rpc.mjs';
import { NATIVE } from './v4.mjs';

const SYMBOL = '0x95d89b41';
const DECIMALS = '0x313ce567';
const NAME = '0x06fdde03';

/** ABI-decode a string return, tolerating the old bytes32-symbol convention. */
function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const raw = hex.replace(/^0x/, '');
  if (raw.length === 64) {
    // bytes32: right-padded ASCII
    const bytes = raw.replace(/(00)+$/, '');
    if (!bytes.length) return null;
    return Buffer.from(bytes, 'hex').toString('utf8').replace(/\0/g, '') || null;
  }
  // dynamic string: offset, length, data
  if (raw.length < 128) return null;
  const len = Number(BigInt('0x' + raw.slice(64, 128)));
  if (!len || len > 128) return null;
  return Buffer.from(raw.slice(128, 128 + len * 2), 'hex').toString('utf8') || null;
}

async function call(to, data) {
  try {
    return await rpc('eth_call', [{ to, data }, 'latest']);
  } catch {
    return null;
  }
}

export async function tokenMeta(address) {
  if (address === 'native' || address?.toLowerCase() === NATIVE) {
    return { address: 'native', symbol: 'ETH', decimals: 18, name: 'Ether' };
  }
  const [sym, dec, nm] = await Promise.all([call(address, SYMBOL), call(address, DECIMALS), call(address, NAME)]);
  return {
    address,
    symbol: decodeString(sym) ?? `${address.slice(0, 6)}…`,
    decimals: dec && dec !== '0x' ? Number(BigInt(dec)) : 18,
    name: decodeString(nm),
  };
}

/** Resolve every token referenced by a graph's edges into a lookup map. */
export async function resolveTokens(graph) {
  const addrs = [...new Set(graph.edges.map((e) => e.token).filter(Boolean))];
  const metas = await Promise.all(addrs.map(tokenMeta));
  return Object.fromEntries(metas.map((m) => [m.address, m]));
}
