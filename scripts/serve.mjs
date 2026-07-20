// 프리뷰용 정적 서버: dist/ 를 SPA 폴백과 함께 서빙한다.
// 이 환경(샌드박스)에서는 esbuild/rolldown 같은 외부 프로세스 네이티브 바이너리가
// 의존성 해석 시 멈추기 때문에, 개발 서버 대신 프로덕션 빌드(dist)를 서빙하는 방식으로
// `npm run dev` 프리뷰를 제공한다. dist가 없으면 먼저 빌드한다.
// 사용: npm run dev -- --port 7100 --host 0.0.0.0
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const port = Number(opt('--port', process.env.PORT || 3000))
const host = opt('--host', '0.0.0.0')
const root = process.cwd()
const dist = path.join(root, 'dist')

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('[serve] dist/가 없어 빌드를 먼저 실행합니다...')
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { stdio: 'inherit', cwd: root })
  if (r.status !== 0) {
    console.error('[serve] 빌드 실패')
    process.exit(1)
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let filePath = path.join(dist, urlPath)
    if (!filePath.startsWith(dist)) {
      res.writeHead(403); res.end('Forbidden'); return
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA 폴백: 에셋이 아니면 index.html
      filePath = path.join(dist, 'index.html')
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    fs.createReadStream(filePath).pipe(res)
  } catch (e) {
    res.writeHead(500); res.end('Server Error')
  }
})

server.listen(port, host, () => {
  console.log(`[serve] 스페이스AI 스톡랩 프리뷰: http://localhost:${port}/`)
})
