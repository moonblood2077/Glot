/**
 * Glot! — Extension Service Worker
 * BYOK 라우터: geminiApiKey 있으면 직접 Gemini API, 없으면 Cloudflare Worker
 * Auto-Toggle: 이미 목표 언어인 경우 자동으로 영어로 번역
 */

const WORKER_URL   = 'https://glot-api.moonblood2077.workers.dev/translate';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const FREE_DAILY_LIMIT = 10;

// ── L1: 인메모리 LRU 캐시 (빠름, SW 슬립 시 소멸) ────────────────────────────
const MAX_CACHE = 60;
const cache  = new Map();  // key → 번역 결과 문자열
const pending = new Map(); // key → Promise<string>

function cacheKey(text, lang) { return `${lang}:${text}`; }

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const val = cache.get(key);
  cache.delete(key);
  cache.set(key, val); // LRU: 맨 뒤로
  return val;
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

// ── L2: chrome.storage.session 캐시 (SW 슬립 후에도 브라우저 세션 내 유지) ──
const S_ = 'g:'; // namespace prefix

async function sessionGet(key) {
  try {
    const r = await chrome.storage.session.get(S_ + key);
    return r[S_ + key] ?? null;
  } catch { return null; }
}

function sessionSet(key, value) {
  chrome.storage.session.set({ [S_ + key]: value }).catch(() => {});
}

// ── 무료 일일 사용량 관리 ──────────────────────────────────────────────────────
async function checkAndIncrementDaily() {
  const today = new Date().toISOString().slice(0, 10);
  const { glotDate, glotCount = 0 } = await chrome.storage.local.get(['glotDate', 'glotCount']);
  const count = glotDate === today ? glotCount : 0;
  if (count >= FREE_DAILY_LIMIT) throw new Error('DAILY_LIMIT_REACHED');
  await chrome.storage.local.set({ glotDate: today, glotCount: count + 1 });
}

// ── Auto-Toggle 프롬프트 생성 ──────────────────────────────────────────────────
function buildSystemPrompt(targetLanguage) {
  return `You are a professional translator. Translate the given text into ${targetLanguage}. IMPORTANT RULE: If the given text is ALREADY in ${targetLanguage} (or very similar), translate it into English instead. Output ONLY the translated text without any quotes, markdown formatting, or explanations.`;
}

// ── Message Handler ───────────────────────────────────────────────────────────
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

  // 1) L1 인메모리 LRU 캐시
  const cached = cacheGet(key);
  if (cached) {
    console.log('[Glot SW] L1 캐시 히트 ✓');
    return cached;
  }

  // 2) 동일 요청이 이미 진행 중 → Promise 공유
  if (pending.has(key)) {
    console.log('[Glot SW] 중복 요청 대기 공유...');
    return pending.get(key);
  }

  // 3) L2 세션 캐시 (SW 슬립 후 재시작해도 유지)
  const sessCached = await sessionGet(key);
  if (sessCached) {
    console.log('[Glot SW] L2 세션 캐시 히트 ✓');
    cacheSet(key, sessCached); // L1 웜업
    return sessCached;
  }

  // 4) storage에서 설정 읽기 (stateless: 매번 최신 값 사용)
  const { geminiApiKey, licenseKey, licenseValid } = await chrome.storage.sync.get({
    geminiApiKey: '', licenseKey: '', licenseValid: false,
  });

  const isPro = licenseValid && licenseKey;

  let promise;
  if (geminiApiKey) {
    console.log('[Glot SW] BYOK 직접 Gemini 호출 →', targetLanguage);
    promise = callGeminiDirect(text, targetLanguage, geminiApiKey);
  } else if (isPro) {
    console.log('[Glot SW] Pro 라이선스 → Cloudflare Worker (무제한) →', targetLanguage);
    promise = callCloudflareWorker(text, targetLanguage);
  } else {
    console.log('[Glot SW] Cloudflare Worker 경유 →', targetLanguage);
    await checkAndIncrementDaily();
    promise = callCloudflareWorker(text, targetLanguage);
  }

  promise = promise
    .then(translation => {
      cacheSet(key, translation);    // L1
      sessionSet(key, translation);  // L2
      return translation;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, promise);
  return promise;
}

// ── BYOK: 직접 Gemini API 호출 ────────────────────────────────────────────────
async function callGeminiDirect(text, targetLanguage, apiKey) {
  const truncated = text.length > 8000 ? text.substring(0, 8000) : text;

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: buildSystemPrompt(targetLanguage) }],
      },
      contents: [{ role: 'user', parts: [{ text: truncated }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[Glot SW] Gemini 직접 호출 오류:', res.status, errText);
    if (res.status === 429) throw new Error('API 요청 한도 초과. 잠시 후 다시 시도하세요.');
    if (res.status === 400) throw new Error('API 키가 올바르지 않습니다. 팝업에서 확인해 주세요.');
    throw new Error(`Gemini 오류 (${res.status})`);
  }

  const data = await res.json();
  const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!translation) throw new Error('번역 결과를 받지 못했습니다.');
  console.log('[Glot SW] BYOK Gemini 호출 완료 ✓');
  return translation;
}

// ── Cloudflare Worker 경유 호출 ───────────────────────────────────────────────
async function callCloudflareWorker(text, targetLanguage) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLanguage }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `서버 오류 (${res.status})`);
  }

  const data = await res.json();
  if (!data.translation) throw new Error('번역 결과를 받지 못했습니다.');
  console.log('[Glot SW]', data.fromCache ? 'KV 캐시 히트 ✓' : 'Gemini 호출 완료');
  return data.translation;
}
