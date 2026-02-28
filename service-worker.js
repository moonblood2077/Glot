const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const LANG_MAP = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어(간체)' };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATE') {
    handleTranslation(message.text, message.targetLanguage)
      .then(translation => sendResponse({ success: true, translation }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleTranslation(text, targetLanguage = 'ko') {
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');

  console.log('[Glot SW] API Key 존재 여부:', !!geminiApiKey);

  if (!geminiApiKey) throw new Error('API Key가 설정되지 않았습니다. 팝업에서 설정해주세요.');

  const truncated = text.length > 3000 ? text.substring(0, 3000) : text;
  const langName = LANG_MAP[targetLanguage] || '한국어';

  console.log('[Glot SW] 번역 요청 시작 →', targetLanguage, '/ 텍스트 길이:', truncated.length);

  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: `당신은 전문 번역가입니다. 주어진 텍스트를 ${langName}로 번역하세요.\n규칙:\n- 마크다운 보존\n- u/유저명, r/서브레딧, URL은 번역하지 마세요\n- 번역문만 출력하세요` }]
      },
      contents: [{ role: 'user', parts: [{ text: truncated }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    })
  });

  console.log('[Glot SW] HTTP 상태:', res.status);

  if (!res.ok) {
    const body = await res.text();
    console.error('[Glot SW] 에러 응답 전문:', body);
    const s = res.status;
    if (s === 400) throw new Error(`요청 오류 (400): ${body.substring(0, 200)}`);
    if (s === 401 || s === 403) throw new Error(`API Key 오류 (${s}): ${body.substring(0, 200)}`);
    if (s === 429) throw new Error('요청 한도 초과. 잠시 후 다시 시도해주세요.');
    throw new Error(`Gemini 오류 (${s}): ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  console.log('[Glot SW] 응답 수신 완료');

  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error('[Glot SW] 예상치 못한 응답 구조:', JSON.stringify(data));
    throw new Error('번역 결과를 받지 못했습니다.');
  }

  return data.candidates[0].content.parts[0].text.trim();
}
