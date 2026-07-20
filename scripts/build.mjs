// vite.config.ts 파일 로딩이 이 환경에서 멈추는 문제를 우회하는 인라인 빌드 스크립트.
// 설정은 vite.config.ts와 동일하게 유지한다.
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

await build({
  configFile: false,
  base: './',
  logLevel: 'info',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(process.cwd(), './src') } },
})
console.log('BUILD DONE')
