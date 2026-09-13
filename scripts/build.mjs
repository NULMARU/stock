// vite.config.ts 파일 로딩이 이 환경에서 멈추는 문제를 우회하는 인라인 빌드 스크립트.
// 설정은 vite.config.ts와 동일하게 유지한다.
import path from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
const version=process.env.STOCK_BUILD_ID || process.env.GITHUB_SHA?.slice(0,12) || new Date().toISOString().replace(/[^0-9]/g,'')
import { build } from 'vite'
import react from '@vitejs/plugin-react'

await build({
  configFile: false,
  base: './',
  logLevel: 'info',
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(version) },
  resolve: { alias: { '@': path.resolve(process.cwd(), './src') } },
})
await writeFile('dist/version.json',JSON.stringify({version,builtAt:new Date().toISOString()})+'\n')
const worker=await readFile('dist/sw.js','utf8')
await writeFile('dist/sw.js',worker.replace('__BUILD_ID__',version))
console.log('BUILD DONE',version)
