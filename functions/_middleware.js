// functions/_middleware.js
// 관리비 앱 접속 제한 (공유 Supabase 보안 정리 3단계 — 경영지원/docs/plans/01_공유Supabase_보안정리_plan.md)
//  - 모든 주소(ace7.janytree.app, maintenance-cost.pages.dev)와 /api/ask-ai 를 한꺼번에 막는다
//  - 비밀번호는 코드에 쓰지 않고 Cloudflare Pages 환경 변수 SITE_PASSWORD (비밀) 에서 읽는다
//  - 맞으면 30일짜리 쿠키를 주고, 그동안은 다시 묻지 않는다. 비밀번호를 바꾸면 모두 다시 로그인
//  - SITE_PASSWORD 가 아직 없으면 아무도 못 들어가게 막는다 (설정 실수로 열려 버리는 것 방지)

const COOKIE = "ace7_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // 30일
const enc = new TextEncoder();

/** 비밀번호로 만든 열쇠값 (쿠키에 넣음 — 비밀번호 자체는 쿠키에 안 들어감) */
async function sessionToken(password) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("ace7-session-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 두 글자열이 같은지 (글자마다 시간 차이가 나지 않게) */
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

/** 로그인 화면 (JT 디자인 토큰만 사용) */
function loginPage(message, status = 200) {
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>관리비 · 로그인</title>
<link rel="stylesheet" href="https://design.janytree.com/v5/jt-tokens.css">
<link rel="stylesheet" href="https://design.janytree.com/v5/jt-utilities.css">
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: var(--color-bg-layout); color: var(--color-text); font-family: var(--font-base); font-size: var(--fs-base); }
  .card { width: 100%; max-width: 360px; margin: var(--space-4); padding: var(--space-6);
          background: var(--color-bg-container); border: 1px solid var(--color-border); border-radius: var(--r-lg);
          display: flex; flex-direction: column; gap: var(--space-4); box-sizing: border-box; }
  h1 { margin: 0; font-size: var(--fs-lg); }
  p { margin: 0; color: var(--color-text-secondary); font-size: var(--fs-sm); }
  label { font-size: var(--fs-sm); font-weight: 600; }
  input { width: 100%; box-sizing: border-box; }
  button { width: 100%; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  .err { color: var(--color-error-text); }
</style>
</head>
<body>
  <form class="card" method="post" action="/__auth/login">
    <h1>관리비 대시보드</h1>
    <p>허락된 사람만 볼 수 있어요. 비밀번호를 넣어 주세요.</p>
    ${message ? `<p class="err" role="alert">${message}</p>` : ""}
    <label for="pw">비밀번호</label>
    <input id="pw" class="jt-input" type="password" name="password" autocomplete="current-password" required autofocus>
    <button class="jt-btn" type="submit">들어가기</button>
  </form>
</body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const password = env.SITE_PASSWORD;

  // 비밀번호가 아직 설정되지 않았으면 전부 막음
  if (!password) {
    return new Response("관리자 설정이 필요해요 (SITE_PASSWORD 환경 변수).", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const token = await sessionToken(password);

  // 로그인
  if (url.pathname === "/__auth/login" && request.method === "POST") {
    const form = await request.formData();
    const input = String(form.get("password") || "");
    if (!same(await sessionToken(input), token)) {
      await new Promise((r) => setTimeout(r, 800)); // 마구 넣어 보기 늦추기
      return loginPage("비밀번호가 맞지 않아요.", 401);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  // 로그아웃: /__auth/logout
  if (url.pathname === "/__auth/logout") {
    return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }

  // 로그인된 사람은 통과
  if (same(readCookie(request, COOKIE), token)) return next();

  // 안 된 사람: AI 질문 등 API 는 401, 화면은 로그인 페이지
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "로그인이 필요해요." }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  return loginPage("", 401);
}
