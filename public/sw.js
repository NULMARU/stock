/* 스페이스AI 스톡랩 서비스워커
 * - 설치: 앱 셸 프리캐시
 * - ./data/*.json : network-first (실패 시 캐시). 쿼리(cache-busting) 무시하고 경로로 판별·저장
 * - JS/CSS 등 해시 에셋: cache-first
 * - 그 외: network-first
 * - 활성화: 구버전 캐시 정리
 */
const VERSION = 'v1';
const SHELL_CACHE = `stocklab-shell-${VERSION}`;
const DATA_CACHE = `stocklab-data-${VERSION}`;
const ASSET_CACHE = `stocklab-asset-${VERSION}`;
const ALL_CACHES = [SHELL_CACHE, DATA_CACHE, ASSET_CACHE];

const APP_SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// 쿼리를 제거한 요청을 캐시 키로 사용 (cache-busting 쿼리 대응)
function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(url.origin + url.pathname, { method: 'GET' });
}

function isDataJson(url) {
  return url.pathname.includes('/data/') && url.pathname.endsWith('.json');
}

function isHashedAsset(url) {
  // Vite 빌드 에셋(assets/ 아래 해시 파일명) 또는 확장자 기준 정적 에셋
  return (
    url.pathname.includes('/assets/') ||
    /\.(js|css|woff2?|ttf|otf)$/.test(url.pathname)
  );
}

async function networkFirst(request, cacheName, ignoreQuery) {
  const key = ignoreQuery ? cacheKey(request) : request;
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // 항상 최신 응답으로 캐시 교체
      await cache.put(key, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 외부 요청(CDN 폰트 등)은 그대로 통과

  // 데이터 JSON: network-first, 쿼리 무시 키
  if (isDataJson(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE, true));
    return;
  }

  // 해시 에셋: cache-first
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // 내비게이션: network-first, 실패 시 앱 셸로 폴백 (HashRouter라 index.html 하나면 충분)
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE, false).catch(() =>
        caches.match('./index.html', { ignoreSearch: true })
      )
    );
    return;
  }

  // 그 외(아이콘, 매니페스트 등): network-first
  event.respondWith(networkFirst(request, SHELL_CACHE, false));
});
