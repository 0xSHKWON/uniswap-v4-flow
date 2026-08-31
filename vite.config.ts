import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// BASE_PATH: GitHub Pages는 /uniswap-v4-flow/ 하위에서 서빙된다 — 배포 워크플로가 넣어준다.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
