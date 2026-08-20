# uniswapv4-flow

Shows how apps (hook protocols) on Uniswap v4 **move money in a single swap**,
as one flow diagram.

Ordinary explorers draw flows from ERC20 `Transfer` events, but v4's flash
accounting means the value a hook takes never shows up in a Transfer log.
This tool draws that invisible flow too.

```bash
npm install
npm run dev
```
