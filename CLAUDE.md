# CLAUDE.md - Project Context & Rules

## 🎯 핵심 아키텍처 (Core Architecture)
- **Extension Name**: Glot! (글로벌 번역 도구)
- **Environment**: Chrome Extension (MV3)
- **Key Files**:
  - `worker.js`: Background Service Worker (API 통신 및 로직 담당)
  - `content.js`: Reddit 등 웹페이지 DOM 조작 및 UI 주입
  - `MEMORY.md`: 장기 프로젝트 히스토리 및 컨텍스트 관리

## ⚠️ 핵심 함정 및 주의사항 (Critical Pitfalls)
1. **Service Worker Context**: `console.log`는 일반 DevTools가 아닌 `chrome://extensions` 내 전용 인스펙터에서만 확인 가능.
2. **Reddit DOM Fluctuations**: `shreddit-comment`, `div.md` 등 Reddit의 독자적인 태그 구조가 수시로 변경됨. 셀렉터 작성 시 유연성 확보 필수.
3. **Deployment**: `worker.js` 수정 후 반드시 `wrangler deploy`를 통해 Cloudflare에 실제 배포되어야 반영됨.

## 🛠️ 개발 커맨드 (Commands)
- Build/Deploy: `wrangler deploy`
- Test: 브라우저 확장 프로그램 페이지에서 '새로고침' 필수