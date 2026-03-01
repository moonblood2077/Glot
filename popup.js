const targetLangSelect = document.getElementById('targetLang');
const apiKeyInput      = document.getElementById('apiKey');
const shortcutInput    = document.getElementById('shortcutInput');
const saveBtn          = document.getElementById('save');
const statusEl         = document.getElementById('status');
const guideLang        = document.getElementById('guideLang');
const guideLang2       = document.getElementById('guideLang2');
const guideShortcut    = document.getElementById('guideShortcut');

const LANG_NAMES = {
  ko: 'Korean', en: 'English', ja: 'Japanese',
  zh: 'Chinese', 'zh-TW': 'Chinese (Traditional)',
  es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', it: 'Italian', ru: 'Russian',
  ar: 'Arabic', hi: 'Hindi', vi: 'Vietnamese', th: 'Thai',
};

const DEFAULT_SHORTCUT = { altKey: true, ctrlKey: false, shiftKey: false, key: 'T' };
let currentShortcut = { ...DEFAULT_SHORTCUT };
let shortcutChanged  = false;
let keyIsPlaceholder = false; // API key 마스킹 상태 추적

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────
function formatShortcut(s) {
  const parts = [];
  if (s.ctrlKey)  parts.push('Ctrl');
  if (s.altKey)   parts.push('Alt');
  if (s.shiftKey) parts.push('Shift');
  parts.push((s.key || 'T').toUpperCase());
  return parts.join(' + ');
}

function updateGuide(langCode) {
  const name = LANG_NAMES[langCode] || langCode;
  guideLang.textContent  = name;
  guideLang2.textContent = name;
}

function updateShortcutDisplay(s) {
  const text = formatShortcut(s);
  shortcutInput.value       = text;
  guideShortcut.textContent = text;
}

// ── 저장된 값 불러오기 ────────────────────────────────────────────────────────
chrome.storage.sync.get(
  { targetLanguage: 'ko', geminiApiKey: '', writeShortcut: null },
  result => {
    targetLangSelect.value = result.targetLanguage || 'ko';
    if (result.geminiApiKey) {
      apiKeyInput.value = '••••••••••••••••';
      keyIsPlaceholder = true;
    }
    currentShortcut = result.writeShortcut || DEFAULT_SHORTCUT;
    updateGuide(result.targetLanguage || 'ko');
    updateShortcutDisplay(currentShortcut);
  }
);

// ── 언어 변경 → 가이드 업데이트 ──────────────────────────────────────────────
targetLangSelect.addEventListener('change', () => {
  updateGuide(targetLangSelect.value);
});

// ── API 키 마스크 해제 ────────────────────────────────────────────────────────
apiKeyInput.addEventListener('focus', () => {
  if (keyIsPlaceholder) {
    apiKeyInput.value = '';
    keyIsPlaceholder = false;
  }
});

// ── 단축키 캡처 ───────────────────────────────────────────────────────────────
shortcutInput.addEventListener('click', () => {
  shortcutInput.classList.add('recording');
  shortcutInput.value = 'Press keys...';
});

shortcutInput.addEventListener('keydown', e => {
  e.preventDefault();
  // modifier 단독 입력은 무시
  if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;
  // Escape → 취소, 이전 값 복원
  if (e.key === 'Escape') {
    shortcutInput.classList.remove('recording');
    updateShortcutDisplay(currentShortcut);
    return;
  }
  const captured = { altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, key: e.key.toUpperCase() };
  currentShortcut  = captured;
  shortcutChanged  = true;
  shortcutInput.classList.remove('recording');
  updateShortcutDisplay(captured);
});

shortcutInput.addEventListener('blur', () => {
  shortcutInput.classList.remove('recording');
  updateShortcutDisplay(currentShortcut);
});

// ── 저장 ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const updates = { targetLanguage: targetLangSelect.value };
  if (!keyIsPlaceholder)  updates.geminiApiKey   = apiKeyInput.value.trim();
  if (shortcutChanged)    updates.writeShortcut  = currentShortcut;

  chrome.storage.sync.set(updates, () => {
    statusEl.classList.add('visible');
    setTimeout(() => statusEl.classList.remove('visible'), 1800);
  });
});
