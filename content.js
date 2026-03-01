(function () {
  'use strict';
  if (window.__glotLoaded) return;
  window.__glotLoaded = true;

  let settings = { targetLanguage: 'ko' };
  let tooltipEl = null;
  let spinnerEl = null;

  // ── DOM 헬스체크 ──────────────────────────────────────────────────────────
  function showDomWarningToast(msg) {
    const prev = document.getElementById('glot-dom-warning');
    if (prev) prev.remove();
    const toast = document.createElement('div');
    toast.id = 'glot-dom-warning';
    toast.textContent = msg;
    toast.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:2147483647',
      'background:#1a1a1b', 'border:1px solid #FF4500', 'color:#d7dadc',
      'padding:10px 14px', 'border-radius:8px', 'font-size:13px',
      'font-family:sans-serif', 'line-height:1.5', 'max-width:320px',
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)', 'cursor:pointer',
    ].join(';');
    toast.onclick = () => toast.remove();
    document.body.appendChild(toast);
    setTimeout(() => toast?.remove(), 10000);
  }

  function domHealthCheck() {
    // 포스트/댓글 페이지에서만 체크 (홈·서브레딧 목록 등 제외)
    if (!/\/r\/[^/]+\/comments\//.test(location.pathname)) return;

    const checks = {
      commentTree: !!document.querySelector('shreddit-comment-tree'),
      comment:     !!document.querySelector('shreddit-comment[thingid]'),
      postTitle:   !!document.querySelector('h1[slot="title"]'),
      postBody:    !!document.querySelector('div[slot="text-body"]'),
    };
    const ok = Object.values(checks).some(Boolean);
    if (!ok) {
      console.warn('[Glot] ⚠️ 번역 셀렉터 전체 실패 — Reddit DOM 구조 변경 의심', checks);
      showDomWarningToast('⚠️ Glot! 경고: Reddit 구조가 변경되어 번역이 동작하지 않을 수 있습니다. (클릭해서 닫기)');
    }
  }

  // ── 5초 주기 DOM 모니터 (F12 콘솔 실시간 확인용) ──────────────────────────
  function setupDomMonitor() {
    let prevKey = null;

    function check() {
      const isPostPage = /\/r\/[^/]+\/comments\//.test(location.pathname);
      const found = {
        page:        isPostPage ? 'post' : 'other',
        commentTree: !!document.querySelector('shreddit-comment-tree'),
        comment:     !!document.querySelector('shreddit-comment[thingid]'),
        postTitle:   !!document.querySelector('h1[slot="title"]'),
        postBody:    !!document.querySelector('div[slot="text-body"]'),
      };

      const key = JSON.stringify(found);
      if (key === prevKey) return; // 변화 없으면 스킵 (콘솔 노이즈 방지)
      prevKey = key;

      const ok = found.commentTree || found.comment || found.postTitle || found.postBody;
      if (isPostPage && !ok) {
        console.warn('[Glot Monitor] ⚠️ 포스트 페이지 — 번역 대상 셀렉터 없음 (DOM 변경 의심)', found);
      } else {
        console.log('[Glot Monitor]', ok ? '✓ 정상' : '— 비-포스트 페이지', found);
      }
    }

    check();                   // 즉시 1회 (F12 열자마자 현재 상태 확인)
    setInterval(check, 5000);  // 이후 5초마다 (변화 있을 때만 로그)
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    settings = await chrome.storage.sync.get({ targetLanguage: 'ko' });
    injectStyles();
    setupClickToTranslate();
    setupWriteTranslate();
    setupScrollToClose();
    setupSPANavigation();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.targetLanguage) settings.targetLanguage = changes.targetLanguage.newValue;
    });
    // 5초 모니터 (콘솔용) + 30분 토스트 경고 (유저 알림용)
    setupDomMonitor();
    setTimeout(domHealthCheck, 5000);
    setInterval(domHealthCheck, 30 * 60 * 1000);
  }

  // ── Cursor spinner (로딩 상태용) ──────────────────────────────────────────
  function getOrCreateSpinner() {
    if (spinnerEl) return spinnerEl;
    spinnerEl = document.createElement('div');
    spinnerEl.id = 'glot-cursor-spinner';
    spinnerEl.style.cssText = [
      'position:fixed', 'width:20px', 'height:20px',
      'pointer-events:none', 'z-index:2147483647',
      'display:none', 'transform-origin:center',
    ].join(';');
    spinnerEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="#343536" stroke-width="2.5"/>
      <path d="M10 2a8 8 0 0 1 8 8" stroke="#FF4500" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
    document.documentElement.appendChild(spinnerEl);
    document.addEventListener('mousemove', e => {
      if (spinnerEl && spinnerEl.style.display !== 'none') {
        spinnerEl.style.left = (e.clientX + 10) + 'px';
        spinnerEl.style.top  = (e.clientY + 10) + 'px';
      }
    }, { passive: true });
    return spinnerEl;
  }

  function setLoadingCursor(x, y) {
    const sp = getOrCreateSpinner();
    sp.style.left = (x + 10) + 'px';
    sp.style.top  = (y + 10) + 'px';
    sp.style.display = 'block';
    sp.style.animation = 'glot-spin 0.8s linear infinite';
  }

  function resetCursor() {
    if (spinnerEl) {
      spinnerEl.style.display = 'none';
      spinnerEl.style.animation = 'none';
    }
  }

  // ── Styles (SVG 커스텀 커서 및 !important 적용) ───────────────────────────
  function injectStyles() {
    if (document.getElementById('glot-styles')) return;
    const s = document.createElement('style');
    s.id = 'glot-styles';
    s.textContent = `
      @keyframes glot-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }

      /* 번역 가능 영역 hover UX (압도적 우선순위 + 오렌지 커스텀 화살표 SVG) */
      h1[slot="title"],
      div[slot="text-body"] div.md p,
      div[slot="text-body"] div.md li,
      div[slot="text-body"] div.md blockquote,
      shreddit-comment div.md p,
      shreddit-comment div.md li,
      shreddit-comment div.md blockquote,
      shreddit-comment div.md td {
        cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="%23FF4500" stroke="%23ffffff" stroke-width="1.5"><path d="M7 2l12 11.2-5.8.5 3.3 7.3-2.2.9-3.2-7.4-4.4 5z" filter="drop-shadow(0px 0px 2px rgba(255,69,0,0.8))"/></svg>'), pointer !important;
        transition: background-color 0.15s !important;
      }

      /* 마우스 오버 시 부드러운 오렌지 배경 */
      h1[slot="title"]:hover,
      div[slot="text-body"] div.md p:hover,
      div[slot="text-body"] div.md li:hover,
      div[slot="text-body"] div.md blockquote:hover,
      shreddit-comment div.md p:hover,
      shreddit-comment div.md li:hover,
      shreddit-comment div.md blockquote:hover,
      shreddit-comment div.md td:hover {
        background-color: rgba(255, 69, 0, 0.08) !important;
      }

      /* ── 툴팁 뼈대 (Glassmorphism) ── */
      #glot-tooltip {
        position: fixed;
        z-index: 2147483647;
        width: 480px;
        max-width: 90vw;
        background: rgba(26, 26, 27, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 69, 0, 0.3);
        border-radius: 12px;
        padding: 14px 18px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        line-height: 1.6;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 18px rgba(255, 69, 0, 0.12);
        box-sizing: border-box;
        pointer-events: all;
      }
      #glot-tooltip[hidden] { display: none !important; }

      /* ── 헤더 ── */
      .glot-tip-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .glot-tip-logo {
        color: #FF4500;
        font-size: 16px;
        font-weight: 900;
        font-style: italic;
        letter-spacing: 1px;
        text-shadow: 0 0 5px rgba(255, 69, 0, 0.5), 0 0 10px rgba(255, 69, 0, 0.3);
      }
      .glot-tip-close {
        background: none;
        border: none;
        color: #4a4a4b;
        cursor: pointer;
        font-size: 16px;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s;
      }
      .glot-tip-close:hover { color: #d7dadc; }

      /* ── 로딩 애니메이션 ── */
      @keyframes glot-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
      .glot-loading {
        color: #818384;
        font-style: italic;
        font-size: 13px;
        animation: glot-pulse 1.2s ease-in-out infinite;
      }

      /* ── 번역 결과 ── */
      .glot-result {
        color: #e5e7eb;
        font-size: 14px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 400px;
        overflow-y: auto;
      }
      .glot-result::-webkit-scrollbar { width: 6px; }
      .glot-result::-webkit-scrollbar-track { background: transparent; }
      .glot-result::-webkit-scrollbar-thumb {
        background: rgba(255, 69, 0, 0.5);
        border-radius: 3px;
      }
      .glot-result::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 69, 0, 0.8);
      }

      /* ── 에러 ── */
      .glot-error { color: #ff585b; font-size: 13px; }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Translation ───────────────────────────────────────────────────────────
  async function translate(text) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'TRANSLATE',
        text,
        targetLanguage: settings.targetLanguage || 'ko'
      });
    } catch {
      throw new Error('페이지를 새로고침해주세요. (익스텐션 재시작됨)');
    }
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
        <span class="glot-tip-logo">Glot!</span>
        <button class="glot-tip-close" aria-label="닫기">&#x2715;</button>
      </div>
      <div class="glot-loading">Glotting...</div>
      <div class="glot-result" hidden></div>
      <div class="glot-error" hidden></div>
    `;
    tooltipEl.addEventListener('click', e => e.stopPropagation());
    tooltipEl.querySelector('.glot-tip-close').onclick = hideTooltip;
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(text, clientX, clientY) {
    const tip = getOrCreateTooltip();
    const W = 480;
    const left = Math.max(8, Math.min(clientX - W / 2, window.innerWidth - W - 8));
    const top = clientY - 8;
    tip.style.cssText = `left:${left}px;top:${top}px;transform:translateY(-100%);`;
    tip.querySelector('.glot-loading').hidden = false;
    tip.querySelector('.glot-result').hidden = true;
    tip.querySelector('.glot-error').hidden = true;
    tip.hidden = false;
    setLoadingCursor(clientX, clientY);

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
      })
      .finally(() => {
        resetCursor();
      });
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
    resetCursor();
  }

  // ── Click to Translate ────────────────────────────────────────────────────
  function getTranslateTarget(target) {
    if (target.closest('a')) return null;

    const title = target.closest('h1[slot="title"]');
    if (title) return title.innerText.trim();

    const postBody = target.closest('div[slot="text-body"]');
    if (postBody) {
      const md = postBody.querySelector('div.md') || postBody;
      return md.innerText.trim();
    }

    const commentMd = target.closest('shreddit-comment div.md');
    if (commentMd) return commentMd.innerText.trim();

    return null;
  }

  function setupClickToTranslate() {
    let debounceTimer = null;

    document.addEventListener('click', e => {
      const text = getTranslateTarget(e.target);
      if (!text || text.length < 3) {
        clearTimeout(debounceTimer);
        hideTooltip();
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        showTooltip(text, e.clientX, e.clientY);
      }, 300);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideTooltip();
    });
  }

  // ── Write Translate (역방향 번역: Alt + T / Mac: Option + T) ─────────────────
  function setupWriteTranslate() {
    document.addEventListener('keydown', async (e) => {
      // Alt + T 단축키만 반응
      if (!(e.altKey && (e.key === 't' || e.key === 'T'))) return;

      const editor = e.target.closest('[contenteditable="true"], textarea');
      if (!editor) return;

      // 브라우저 기본 동작 및 다른 핸들러 간섭 완벽 차단
      e.preventDefault();
      e.stopPropagation();

      const selectedText = window.getSelection().toString().trim();
      const textToTranslate = selectedText || editor.innerText?.trim() || editor.value?.trim() || '';
      if (!textToTranslate) return;

      // 스피너 (에디터 포커스 유지한 채 위치만 계산)
      const rect = editor.getBoundingClientRect();
      setLoadingCursor(rect.left + rect.width / 2, rect.top + rect.height / 2);

      try {
        const res = await chrome.runtime.sendMessage({
          type: 'TRANSLATE',
          text: textToTranslate,
          targetLanguage: settings.targetLanguage || 'ko',
        });

        if (res && res.success) {
          // 안전한 삽입 시퀀스: focus → selectAll → insertText
          editor.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, res.translation);
        }
      } catch (err) {
        console.error('[Glot] 역방향 번역 에러:', err);
      } finally {
        resetCursor();
      }
    }, { capture: true });
  }

  // ── Auto-close on scroll ──────────────────────────────────────────────────
  function setupScrollToClose() {
    window.addEventListener('scroll', e => {
      if (!tooltipEl || tooltipEl.hidden) return;
      if (tooltipEl.contains(e.target)) return;
      hideTooltip();
    }, { passive: true, capture: true });
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