// 앱 카탈로그 후보 tx 훑기 — 각 후보의 노드/엣지/숨은 이동/훅 구성을 요약한다.
// 대표 tx 선정용 일회성 도구.
import { trace } from './rpc.mjs';
import { toGraph } from './graph.mjs';

const CANDIDATES = {
  'Aegis v2': [
    '0x161b0ba23da2ac3ea73202fffe0aa558bf1e26a04e520f67357ef26e26c81c01',
    '0x35bc7dc0cd829f5a8240fda49e0d30868ee1bd4485720c9687808615780f3c70',
    '0x465366894c27a85ad5cadd575848b0c00b4b8f262ed7c3524fcb1365fdf4c489',
    '0xe0a7208ca3ea14960608d6a2d32b9b5cced5b4480437b2428a72d5a1e09594c1',
  ],
  'Aegis v3': [
    '0xbd31a2249ce2d5e6ed10a3de7a6e2aa7d32830295fd0f446925bfec3fa8fc10a',
    '0xe84009a28799a4bb408a7a4991d7170ee9d35a0083cabb1702ab5e25a60fc0bf',
  ],
  'EulerSwap': [
    '0x74803911a975a65f424bf2bce3bfa8ec46892c794629fa401ecfc5ea3f8ab088',
    '0xa9ce5a09256abd53a2a8091e62ca6e3973f35d42930ccd793e204410e715c1c3',
  ],
  'BackGeoOracle': [
    '0x5c146270cf05fe1fbbcdb1925b9281486bf3951983143d0eeaad6ae697cbd51d',
    '0x65c8aeb0a3724cd3760308de861bab99fa2867b2de0cf186abc43e4f24acda68',
    '0xbb3f5dcc2f6ff09674351712b80c1dc81e9ad0d7f57ac042a5040c695cbfc667',
  ],
  'Limit Order': [
    '0x95f8e3adae13181bf353b76cc1e99101a9c5ec00e6a00e9dbee4a80fbb1d1d31',
    '0xb7ba37dc7adc8100152ed48da9f8ca754626955b2763b8db7fd1f9a10895e27d',
    '0x616c88e8a70eb94eb7241f69357529c9ea6bbeda39d82d2c942d2b17a60f21da',
  ],
};

for (const [app, hashes] of Object.entries(CANDIDATES)) {
  console.log(`\n== ${app}`);
  for (const hash of hashes) {
    try {
      const g = toGraph(await trace(hash), { txHash: hash });
      const settlements = g.edges.filter((e) => e.layer === 'settlement');
      const hidden = settlements.filter((e) => e.hidden).length;
      const hooks = g.nodes.filter((n) => n.type === 'hook').map((n) => n.known ?? n.label);
      console.log(
        `${hash.slice(0, 10)}  nodes=${String(g.nodes.length).padStart(2)} edges=${String(g.edges.length).padStart(2)}` +
        ` moves=${String(settlements.length).padStart(2)} hidden=${String(hidden).padStart(2)}` +
        ` balanced=${g.balanced} hooks=[${hooks.join(', ')}]`
      );
    } catch (e) {
      console.log(`${hash.slice(0, 10)}  FAIL ${e.message.slice(0, 60)}`);
    }
  }
}
