const targetLangSelect = document.getElementById('targetLang');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

chrome.storage.sync.get({ targetLanguage: 'ko' }, result => {
  targetLangSelect.value = result.targetLanguage || 'ko';
});

saveBtn.addEventListener('click', () => {
  chrome.storage.sync.set({ targetLanguage: targetLangSelect.value }, () => {
    statusEl.style.color = '#46d160';
    statusEl.textContent = '저장됐습니다!';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});
