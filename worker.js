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
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  vi: 'Vietnamese',
  th: 'Thai',
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
    // [백엔드 점검 모드 설정]
    // 이 값을 true로 설정하면 모든 번역 요청 처리를 중지하고 점검 안내 메시지를 반환합니다.
    const IS_MAINTENANCE_MODE = true;

    // 만약 현재 시스템이 점검 중(true) 상태라면 아래의 로직을 실행합니다.
    if (IS_MAINTENANCE_MODE) {
      // 클라이언트에게 503(Service Unavailable) 상태 코드와 함께 안내 메시지를 JSON 형태로 반환합니다.
      return jsonResponse({ error: 'Glot! 현재 기능 개선 및 안정성 업데이트 중입니다. 잠시 후 다시 시도해 주세요!' }, 503);
    }

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
    // 번역 원문(text)과 도착 언어(targetLanguage), 그리고 분석을 위한 출발 언어(sourceLanguage) 변수를 선언합니다.
    let text, targetLanguage, sourceLanguage;
    try {
      // 클라이언트가 전송한 JSON 형식의 요청 본문(body)을 비동기적으로 파싱합니다.
      const requestData = await request.json();
      
      // 파싱한 데이터에서 text를 추출합니다. PII 보호를 위해 이 값은 로그에 남기지 않습니다.
      text = requestData.text;
      // 도착 언어(targetLanguage)를 추출하며, 값이 없을 경우 기본값으로 'ko'(한국어)를 지정합니다.
      targetLanguage = requestData.targetLanguage || 'ko';
      // 출발 언어(sourceLanguage)를 추출하며, 명시되지 않은 경우 'auto'(자동 감지)로 처리합니다.
      sourceLanguage = requestData.sourceLanguage || 'auto';

      // [개인정보 보호(PII) 준수 및 트래픽 통계 로깅]
      // 실제 번역 내용(text)이나 사용자 IP 등의 민감한 정보는 완전히 배제합니다.
      // 서비스 통계 및 리소스 배분 분석을 목적으로 오직 출발 언어와 도착 언어 쌍만 콘솔에 기록합니다.
      console.log(`[Translation Analytics] Source: ${sourceLanguage} -> Target: ${targetLanguage}`);
    } catch {
      // JSON 파싱에 실패한 경우, 즉 클라이언트가 잘못된 데이터를 보낸 경우 처리합니다.
      // 400 Bad Request 상태 코드와 함께 오류 메시지를 JSON 형태로 클라이언트에게 반환합니다.
      return jsonResponse({ error: '잘못된 요청 형식입니다.' }, 400);
    }

    if (!text || text.trim().length < 2) {
      return jsonResponse({ error: '번역할 텍스트가 없습니다.' }, 400);
    }

    const truncated = text.length > 8000 ? text.substring(0, 8000) : text;

    // ── KV 캐시 확인 ─────────────────────────────────────────────────────────
    const cacheKey = await sha256(`${targetLanguage}:${truncated}`);
    const cached = await env.TRANSLATION_CACHE.get(cacheKey);

    if (cached) {
      return jsonResponse({ translation: cached, fromCache: true });
    }

    // ── Gemini API 호출 ───────────────────────────────────────────────────────
    const langName = LANG_MAP[targetLanguage] || 'Korean';

    const geminiBody = JSON.stringify({
      system_instruction: {
        parts: [{
          text: `You are a professional translator. Translate the given text into ${langName}. IMPORTANT RULE: If the given text is ALREADY in ${langName} (or very similar), translate it into English instead. Output ONLY the translated text without any quotes, markdown formatting, or explanations.`,
        }],
      },
      contents: [{ role: 'user', parts: [{ text: truncated }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    });

    const geminiHeaders = { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY };

    let geminiRes = await fetch(GEMINI_ENDPOINT, { method: 'POST', headers: geminiHeaders, body: geminiBody });

    // 일시적 오류 시 1회 재시도 (429, 400 제외 — 400은 geo-restriction 등 재시도 무의미)
    if (!geminiRes.ok && geminiRes.status !== 429 && geminiRes.status !== 400) {
      console.warn('[Glot Worker] 재시도:', geminiRes.status);
      geminiRes = await fetch(GEMINI_ENDPOINT, { method: 'POST', headers: geminiHeaders, body: geminiBody });
    }

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error('[Glot Worker] Gemini 오류:', geminiRes.status, errBody);

      // Geo-restriction → 무료 폴백 없음, BYOK 안내
      if (geminiRes.status === 400 && errBody.includes('FAILED_PRECONDITION')) {
        console.warn('[Glot Worker] Geo-restriction 감지 → BYOK 안내 반환');
        return jsonResponse({
          error: '현재 지역에서 무료 번역을 사용할 수 없습니다. Glot! 아이콘 → API 키 입력 시 고품질 Gemini 번역이 가능합니다.',
        }, 503);
      }

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
