/**
 * Glot! — Cloudflare Worker
 * POST /translate  { text, targetLanguage }
 *
 * 환경변수 (Cloudflare Dashboard > Workers > Settings > Variables):
 *   GEMINI_API_KEY  — Gemini API 키 (Secret)
 * KV 네임스페이스 (wrangler.toml에서 바인딩):
 *   TRANSLATION_CACHE
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const LANG_MAP = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
  zh: '중국어(간체)',
};

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7일

// ── CORS 헤더 ─────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsPreflightResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ── SHA-256 해시 (캐시 키 생성용) ────────────────────────────────────────────
async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') return corsPreflightResponse();

    const url = new URL(request.url);

    if (url.pathname !== '/translate') {
      return jsonResponse({ error: 'Not found' }, 404);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // ── 요청 파싱 ────────────────────────────────────────────────────────────
    let text, targetLanguage;
    try {
      ({ text, targetLanguage = 'ko' } = await request.json());
    } catch {
      return jsonResponse({ error: '잘못된 요청 형식입니다.' }, 400);
    }

    if (!text || text.trim().length < 2) {
      return jsonResponse({ error: '번역할 텍스트가 없습니다.' }, 400);
    }

    const truncated = text.length > 3000 ? text.substring(0, 3000) : text;

    // ── KV 캐시 확인 ─────────────────────────────────────────────────────────
    const cacheKey = await sha256(`${targetLanguage}:${truncated}`);
    const cached = await env.TRANSLATION_CACHE.get(cacheKey);

    if (cached) {
      return jsonResponse({ translation: cached, fromCache: true });
    }

    // ── Gemini API 호출 ───────────────────────────────────────────────────────
    const langName = LANG_MAP[targetLanguage] || '한국어';

    const geminiRes = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: `당신은 전문 번역가입니다. 주어진 텍스트를 ${langName}로 번역하세요.
규칙:
- 마크다운 보존
- u/유저명, r/서브레딧, URL은 번역하지 마세요
- 번역문만 출력하세요`,
          }],
        },
        contents: [{ role: 'user', parts: [{ text: truncated }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    });

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error('[Glot Worker] Gemini 오류:', geminiRes.status, errBody);
      const errMsg = geminiRes.status === 429
        ? 'API 요청 한도 초과. 잠시 후 다시 시도하세요. (1분 대기 후 재클릭)'
        : `번역 서버 오류 (${geminiRes.status})`;
      return jsonResponse({ error: errMsg }, geminiRes.status);
    }

    const data = await geminiRes.json();
    const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!translation) {
      console.error('[Glot Worker] 예상치 못한 응답:', JSON.stringify(data));
      return jsonResponse({ error: '번역 결과를 받지 못했습니다.' }, 500);
    }

    // ── KV에 저장 (7일 TTL) ───────────────────────────────────────────────────
    await env.TRANSLATION_CACHE.put(cacheKey, translation, {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    return jsonResponse({ translation, fromCache: false });
  },
};
