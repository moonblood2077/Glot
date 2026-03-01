const targetLangSelect = document.getElementById('targetLang');
const apiKeyInput      = document.getElementById('apiKey');
const saveBtn          = document.getElementById('save');
const statusEl         = document.getElementById('status');
const guideLang        = document.getElementById('guideLang');
const guideLang2       = document.getElementById('guideLang2');

const LANG_NAMES = {
  ko: 'Korean', en: 'English', ja: 'Japanese',
  zh: 'Chinese', 'zh-TW': 'Chinese (Traditional)',
  es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', it: 'Italian', ru: 'Russian',
  ar: 'Arabic', hi: 'Hindi', vi: 'Vietnamese', th: 'Thai',
};

// 기존 키가 마스킹 표시 중인지 추적 (true이면 저장 시 기존 키 유지)
let keyIsPlaceholder = false;

function updateGuide(langCode) {
  const name = LANG_NAMES[langCode] || langCode;
  guideLang.textContent  = name;
  guideLang2.textContent = name;
}

// 저장된 값 불러오기
chrome.storage.sync.get({ targetLanguage: 'ko', geminiApiKey: '' }, result => {
  targetLangSelect.value = result.targetLanguage || 'ko';
  if (result.geminiApiKey) {
    // 실제 키는 노출하지 않고 마스킹 표시
    apiKeyInput.value = '••••••••••••••••';
    keyIsPlaceholder = true;
  }
  updateGuide(result.targetLanguage || 'ko');
});

// 언어 변경 시 가이드 박스 실시간 업데이트
targetLangSelect.addEventListener('change', () => {
  updateGuide(targetLangSelect.value);
});

// API 키 필드 포커스 시 마스크 해제 → 새 키 입력 준비
apiKeyInput.addEventListener('focus', () => {
  if (keyIsPlaceholder) {
    apiKeyInput.value = '';
    keyIsPlaceholder = false;
  }
});

// 저장
saveBtn.addEventListener('click', () => {
  const updates = { targetLanguage: targetLangSelect.value };
  // keyIsPlaceholder === true 이면 유저가 건드리지 않은 것 → 기존 키 덮어쓰기 안 함
  if (!keyIsPlaceholder) {
    updates.geminiApiKey = apiKeyInput.value.trim();
  }
  chrome.storage.sync.set(updates, () => {
    statusEl.classList.add('visible');
    setTimeout(() => statusEl.classList.remove('visible'), 1800);
  });
});
