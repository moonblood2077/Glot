const apiKeyInput = document.getElementById('apiKey');
const targetLangSelect = document.getElementById('targetLang');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

chrome.storage.sync.get({ geminiApiKey: '', targetLanguage: 'ko' }, result => {
  if (result.geminiApiKey) apiKeyInput.placeholder = '저장됨: ****' + result.geminiApiKey.slice(-4);
  targetLangSelect.value = result.targetLanguage || 'ko';
});

saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  const lang = targetLangSelect.value;
  if (!key && !apiKeyInput.placeholder.startsWith('저장됨')) {
    statusEl.style.color = '#ff585b';
    statusEl.textContent = 'API Key를 입력해주세요.';
    return;
  }
  const toSave = { targetLanguage: lang };
  if (key) toSave.geminiApiKey = key;
  chrome.storage.sync.set(toSave, () => {
    statusEl.style.color = '#46d160';
    statusEl.textContent = '저장됐습니다!';
    if (key) { apiKeyInput.value = ''; apiKeyInput.placeholder = '저장됨: ****' + key.slice(-4); }
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});
