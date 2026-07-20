// vite.config.ts 파일 로딩 및 optimizeDeps 자동 탐색이 이 환경에서 멈추는 문제를 우회하는 dev 서버 스크립트.
// `npm run dev -- --port 7100 --host 0.0.0.0` 형태의 CLI 인자를 그대로 전달한다.
import path from 'node:path'
import fs from 'node:fs'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const args = process.argv.slice(2)
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const port = Number(opt('--port', process.env.PORT || 3000))
const host = opt('--host', undefined)

// 브라우저에서 쓰는 런타임 의존성만 사전 번들 대상으로 명시 (자동 탐색 스캔 대신).
// rolldown-vite 사용 환경에서는 자동 탐색에 맡긴다 (esbuild 스캔 hang 우회용 레거시 설정 제거).
const server = await createServer({
  configFile: false,
  base: './',
  logLevel: 'info',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(process.cwd(), './src') } },
  server: { port, host, strictPort: false },
})
await server.listen()
server.printUrls()
server.bindCLIShortcuts({ print: true })
