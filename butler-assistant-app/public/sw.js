// Service Worker — Live2D モデルファイルのキャッシュ
// キャッシュファースト戦略: キャッシュヒット→即返却、ミス→ネットワーク→キャッシュ保存

const CACHE_NAME = 'live2d-models-v1'

// モデル CDN のホスト名パターン
const MODEL_CDN_PATTERN = /\.cloudfront\.net\//

// キャッシュ対象の拡張子
const CACHEABLE_EXTENSIONS = [
  '.model3.json',
  '.moc3',
  '.exp3.json',
  '.motion3.json',
  '.physics3.json',
  '.pose3.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]

/**
 * リクエストがキャッシュ対象かどうか判定
 */
function isCacheable(url) {
  // CloudFront CDN からのモデルファイルのみキャッシュ
  if (!MODEL_CDN_PATTERN.test(url)) return false
  return CACHEABLE_EXTENSIONS.some((ext) => url.toLowerCase().includes(ext))
}

// インストール時: 即座にアクティブ化
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

// アクティベーション時: 古いキャッシュを削除、即座にクライアント制御
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// フェッチ: キャッシュファースト戦略
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (!isCacheable(event.request.url)) return

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached

        return fetch(event.request).then((response) => {
          // 成功レスポンスのみキャッシュ
          if (response.ok) {
            cache.put(event.request, response.clone())
          }
          return response
        })
      })
    )
  )
})
