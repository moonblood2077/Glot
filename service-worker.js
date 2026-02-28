/**
 * Glot! — Extension Service Worker
 * 번역 요청을 Cloudflare Worker로 프록시합니다.
 * Gemini API 키는 Cloudflare Worker 환경변수로 관리됩니다.
 */

const WORKER_URL = 'https://glot-api.moonblood2077.workers.dev/translate';

// ── 인메모리 캐시 (세션 내 중복 API 호출 방지) ────────────────────────────
const MAX_CACHE = 60;
const cache = new Map();   // key → 번역 결과 문자열 (LRU)
const pending = new Map(); // key → Promise<string> (진행 중 중복 요청 공유)

function cacheKey(text, lang) {
  return `${lang}:${text}`;
}

function cacheGet(key) {
  if (!cache.has(key)) return null;
  // LRU: 접근 시 맨 뒤로 재삽입
  const val = cache.get(key);
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE) {
    cache.delete(cache.keys().next().value); // 가장 오래된 항목 제거
  }
  cache.set(key, value);
}

// ── Message Handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATE') {
    handleTranslation(message.text, message.targetLanguage)
      .then(translation => sendResponse({ success: true, translation }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async sendResponse 유지
  }
});

async function handleTranslation(text, targetLanguage = 'ko') {
  const key = cacheKey(text, targetLanguage);

  // 1) 인메모리 LRU 캐시 히트
  const cached = cacheGet(key);
  if (cached) {
    console.log('[Glot SW] 메모리 캐시 히트 ✓');
    return cached;
  }

  // 2) 동일 요청이 이미 진행 중 → Promise 공유 (API 중복 호출 방지)
  if (pending.has(key)) {
    console.log('[Glot SW] 중복 요청 대기 공유...');
    return pending.get(key);
  }

  // 3) 새 API 요청
  console.log('[Glot SW] API 요청 →', targetLanguage, '/ 길이:', text.length);

  const promise = fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLanguage }),
  })
    .then(async res => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `서버 오류 (${res.status})`);
      }
      const data = await res.json();
      if (!data.translation) throw new Error('번역 결과를 받지 못했습니다.');
      console.log('[Glot SW]', data.fromCache ? 'KV 캐시 히트 ✓' : 'Gemini 호출 완료');
      cacheSet(key, data.translation);
      return data.translation;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, promise);
  return promise;
}
