(function () {
  'use strict';
  if (window.__glotLoaded) return;
  window.__glotLoaded = true;

  let settings = { geminiApiKey: '', targetLanguage: 'ko' };
  let tooltipEl = null;

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    settings = await chrome.storage.sync.get({ geminiApiKey: '', targetLanguage: 'ko' });
    injectStyles();
    setupClickToTranslate();
    setupSPANavigation();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.geminiApiKey) settings.geminiApiKey = changes.geminiApiKey.newValue;
      if (changes.targetLanguage) settings.targetLanguage = changes.targetLanguage.newValue;
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('glot-styles')) return;
    const s = document.createElement('style');
    s.id = 'glot-styles';
    s.textContent = `
      /* 번역 가능 영역 커서 표시 */
      shreddit-comment div.md p,
      shreddit-comment div.md li,
      shreddit-comment div.md blockquote,
      shreddit-comment div.md td {
        cursor: crosshair;
      }

      #glot-tooltip {
        position: fixed;
        z-index: 2147483647;
        width: 300px;
        max-width: calc(100vw - 32px);
        background: #1a1a1b;
        color: #d7dadc;
        border: 1px solid #343536;
        border-radius: 8px;
        padding: 10px 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        line-height: 1.5;
        box-shadow: 0 4px 24px rgba(0,0,0,.5);
        box-sizing: border-box;
        pointer-events: all;
      }
      #glot-tooltip[hidden] { display: none !important; }
      .glot-tip-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
      .glot-tip-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#818384; }
      .glot-tip-close { background:none; border:none; color:#818384; cursor:pointer; font-size:16px; padding:0 2px; line-height:1; }
      .glot-tip-close:hover { color:#d7dadc; }
      .glot-loading { color:#818384; font-style:italic; font-size:13px; }
      .glot-result { white-space:pre-wrap; word-break:break-word; }
      .glot-error { color:#ff585b; font-size:13px; }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Translation ───────────────────────────────────────────────────────────
  async function translate(text) {
    const res = await chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      text,
      targetLanguage: settings.targetLanguage || 'ko'
    });
    if (!res) throw new Error('응답 없음. 페이지를 새로고침해주세요.');
    if (!res.success) throw new Error(res.error || '번역 실패');
    return res.translation;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  function getOrCreateTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'glot-tooltip';
    tooltipEl.hidden = true;
    tooltipEl.innerHTML = `
      <div class="glot-tip-header">
        <span class="glot-tip-label">Glot 번역</span>
        <button class="glot-tip-close" aria-label="닫기">&#x2715;</button>
      </div>
      <div class="glot-loading">번역 중...</div>
      <div class="glot-result" hidden></div>
      <div class="glot-error" hidden></div>
    `;
    // 툴팁 내부 클릭이 document 핸들러로 버블링되지 않도록 차단
    tooltipEl.addEventListener('click', e => e.stopPropagation());
    tooltipEl.querySelector('.glot-tip-close').onclick = hideTooltip;
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(text, clientX, clientY) {
    if (!settings.geminiApiKey) {
      alert('Glot: 팝업에서 Gemini API Key를 먼저 설정해주세요.');
      return;
    }
    const tip = getOrCreateTooltip();
    const W = 300;
    const left = Math.max(8, Math.min(clientX - W / 2, window.innerWidth - W - 8));
    const top = clientY - 8;
    tip.style.cssText = `left:${left}px;top:${top}px;transform:translateY(-100%);`;
    tip.querySelector('.glot-loading').hidden = false;
    tip.querySelector('.glot-result').hidden = true;
    tip.querySelector('.glot-error').hidden = true;
    tip.hidden = false;

    translate(text)
      .then(result => {
        if (tip.hidden) return;
        tip.querySelector('.glot-loading').hidden = true;
        const el = tip.querySelector('.glot-result');
        el.textContent = result;
        el.hidden = false;
      })
      .catch(err => {
        if (tip.hidden) return;
        tip.querySelector('.glot-loading').hidden = true;
        const el = tip.querySelector('.glot-error');
        el.textContent = err.message;
        el.hidden = false;
      });
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  // ── Click to Translate ────────────────────────────────────────────────────
  function setupClickToTranslate() {
    document.addEventListener('click', e => {
      // 링크 클릭은 번역 안 함
      if (e.target.closest('a')) return;

      // 댓글 텍스트 영역(div.md) 클릭인지 확인
      const mdDiv = e.target.closest('shreddit-comment div.md');
      if (!mdDiv) {
        // 댓글 영역 밖 클릭 → 툴팁 닫기
        hideTooltip();
        return;
      }

      const text = mdDiv.innerText.trim();
      if (!text || text.length < 3) return;

      showTooltip(text, e.clientX, e.clientY);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideTooltip();
    });
  }

  // ── SPA Navigation ────────────────────────────────────────────────────────
  function setupSPANavigation() {
    let lastUrl = location.href;
    function onNav() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      setTimeout(() => { injectStyles(); }, 600);
    }
    const orig = history.pushState.bind(history);
    history.pushState = function (...args) { orig(...args); onNav(); };
    window.addEventListener('popstate', onNav);
  }

  init().catch(console.error);
})();
