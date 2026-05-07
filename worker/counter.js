// Opt out of deprecated Privacy Sandbox / storage APIs that third-party
// injected scripts (e.g. Cloudflare Analytics beacon) attempt to use.
const PERMISSIONS_POLICY = [
  'interest-cohort=()',
  'join-ad-interest-group=()',
  'run-ad-auction=()',
  'attribution-reporting=()',
  'browsing-topics=()',
  'shared-storage=()',
  'shared-storage-select-url=()',
  'private-state-token-issuance=()',
  'private-state-token-redemption=()',
].join(', ');

// ── AI rate limits ────────────────────────────────────────────────────────────
// Adjust these to control cost. Both limits apply; whichever hits first wins.
const AI_LIMIT_PER_IP  = 3;    // requests per IP address per day
const AI_LIMIT_GLOBAL  = 100;  // total requests across all users per day

// ── Counter Durable Object ────────────────────────────────────────────────────
export class Counter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    let value = (await this.state.storage.get('value')) ?? 0;

    if (action === 'up') {
      value += 1;
      await this.state.storage.put('value', value);
    } else if (action === 'try_up') {
      // Atomic check-and-increment: only increments if value < limit.
      // Returns { value, allowed } so the caller knows whether to proceed.
      const limit = parseInt(params.get('limit') || '0', 10);
      if (value < limit) {
        value += 1;
        await this.state.storage.put('value', value);
        return Response.json({ value, allowed: true });
      }
      return Response.json({ value, allowed: false });
    }

    return Response.json({ value });
  }
}

// ── Rate limit helpers ────────────────────────────────────────────────────────

async function hashIP(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip || 'unknown'));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hoursUntilReset() {
  const now   = new Date();
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((reset - now) / 3_600_000));
}

async function tryUp(env, name, limit) {
  const stub = env.COUNTERS.get(env.COUNTERS.idFromName(name));
  const r    = await stub.fetch(new Request(`https://x/?action=try_up&limit=${limit}`));
  return r.json(); // { value, allowed }
}

// Returns a 429 Response if rate-limited, or null if the request may proceed.
// Checks global cap first (cost ceiling), then per-IP cap (fairness).
async function checkRateLimit(request, env) {
  const today  = new Date().toISOString().slice(0, 10); // "2026-04-30"
  const hours  = hoursUntilReset();
  const resetMsg = `Available again in ${hours} hour${hours !== 1 ? 's' : ''} (resets at midnight UTC).`;

  // 1 — Global daily cap
  const globalKey    = `rl:g:${today}`;
  const globalResult = await tryUp(env, globalKey, AI_LIMIT_GLOBAL);
  if (!globalResult.allowed) {
    return Response.json({
      error: `The daily AI quota has been reached (${globalResult.value} of ${AI_LIMIT_GLOBAL} requests used today). ${resetMsg}`,
      rateLimited: true,
      resetIn: hours,
    }, { status: 429 });
  }

  // 2 — Per-IP daily cap
  const ip      = request.headers.get('CF-Connecting-IP') || 'unknown';
  const hash    = await hashIP(ip);
  const ipKey   = `rl:ip:${today}:${hash}`;
  const ipResult = await tryUp(env, ipKey, AI_LIMIT_PER_IP);
  if (!ipResult.allowed) {
    return Response.json({
      error: `You've used your ${AI_LIMIT_PER_IP} daily AI requests. ${resetMsg}`,
      rateLimited: true,
      resetIn: hours,
    }, { status: 429 });
  }

  return null; // OK to proceed
}

// ── Turnstile verification ────────────────────────────────────────────────────
// Returns true if verification passes. If TURNSTILE_SECRET is not set (local dev), skips check.
async function verifyTurnstile(token, secret, ip) {
  if (!secret) return true;
  if (!token)  return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  const { success } = await res.json();
  return success === true;
}

// ── Anthropic call helper ─────────────────────────────────────────────────────

async function callClaude(apiKey, body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const text = (data.content?.[0]?.text || '').trim();
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m?.[0] || '{}');
  } catch (_) {
    return null;
  }
}



// ── Counter keys for page-load count injection ────────────────────────────────

const COUNTER_KEYS = ['font', 'img', 'diff', 'color', 'brand', 'pdf', 'code', 'xd'];

// ── Main worker ───────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Font Identify ──────────────────────────────────────────────────────────
    if (url.pathname === '/fontid' && request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== 'https://lindetoolbox.com') {
        return new Response('Forbidden', { status: 403 });
      }

      const apiKey = env.MIXFONT_KEY;
      if (!apiKey) {
        return Response.json({ error: 'Font identification is not configured on this server.' }, { status: 503 });
      }

      const limited = await checkRateLimit(request, env);
      if (limited) return limited;

      let body;
      try { body = await request.json(); } catch (_) {
        return new Response('Bad request', { status: 400 });
      }

      const { image, mimeType, turnstileToken } = body;
      const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!image || typeof image !== 'string' || image.length > 4 * 1024 * 1024
          || !ALLOWED_MIME.includes(mimeType)) {
        return new Response('Bad request', { status: 400 });
      }

      const ip = request.headers.get('CF-Connecting-IP') || '';
      if (!await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip)) {
        return Response.json({ error: 'Human verification failed. Please try again.' }, { status: 403 });
      }

      // Mixfont Lens requires a public URL — upload image to transfer.sh temporarily
      let imageUrl;
      try {
        const binary = Uint8Array.from(atob(image), c => c.charCodeAt(0));
        const up = await fetch(`https://transfer.sh/font-${Date.now()}.jpg`, {
          method: 'PUT',
          body: binary,
          headers: { 'Content-Type': 'image/jpeg', 'Max-Days': '1', 'Max-Downloads': '2' },
        });
        if (!up.ok) throw new Error('upload failed');
        imageUrl = (await up.text()).trim();
      } catch (_) {
        return Response.json({ error: 'Could not prepare image for analysis. Please try again.' }, { status: 502 });
      }

      const mixRes = await fetch('https://www.mixfont.com/api/v1/lens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ image_url: imageUrl, top_k: 5 }),
      });
      if (!mixRes.ok) {
        return Response.json({ error: 'Font identification failed. Please try again.' }, { status: 502 });
      }

      const mix = await mixRes.json();
      if (!mix.font_matches?.length) {
        return Response.json({ fonts: [], notes: 'No font could be identified in this image.' });
      }

      const fonts = mix.font_matches.map((m) => ({
        name:            m.name,
        foundry:         '',
        category:        '',
        confidence:      m.score >= 0.5 ? 'high' : m.score >= 0.2 ? 'medium' : 'low',
        characteristics: `${Math.round(m.score * 100)}% match`,
        alternatives:    [],
        googleFont:      true,
      }));

      return Response.json({ fonts, notes: mix.word ? `Detected word: "${mix.word}"` : '' });
    }

    // ── Font Pair ──────────────────────────────────────────────────────────────
    if (url.pathname === '/fontpair' && request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== 'https://lindetoolbox.com') {
        return new Response('Forbidden', { status: 403 });
      }

      const apiKey = env.ANTHROPIC_KEY;
      if (!apiKey) {
        return Response.json({ error: 'Font pairing is not configured on this server.' }, { status: 503 });
      }

      const limited = await checkRateLimit(request, env);
      if (limited) return limited;

      let body;
      try { body = await request.json(); } catch (_) {
        return new Response('Bad request', { status: 400 });
      }

      const { font, role } = body;
      if (!font || typeof font !== 'string' || font.length > 200 || !['heading', 'body'].includes(role)) {
        return new Response('Bad request', { status: 400 });
      }

      const ip = request.headers.get('CF-Connecting-IP') || '';
      if (!await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip)) {
        return Response.json({ error: 'Human verification failed. Please try again.' }, { status: 403 });
      }

      const safeName = font.replace(/[<>"]/g, '').slice(0, 100);
      const oppRole  = role === 'heading' ? 'body text' : 'heading';
      const prompt   = `I'm using "${safeName}" as my ${role} font. Suggest 5 fonts that pair well with it for the ${oppRole} role.\n\nReturn ONLY this JSON:\n{"baseFont":"<input font name>","baseFontRole":"${role}","baseFontGoogleFont":<true|false>,"baseFontGfParam":"<e.g. Playfair+Display:wght@700 — empty string if not on Google Fonts>","baseFontCategory":"serif|sans-serif|monospace|display|script","suggestions":[{"name":"<font name>","category":"serif|sans-serif|monospace|display|script","googleFont":<true|false>,"gfParam":"<e.g. Source+Sans+3:wght@400 — empty string if not on GF>","rationale":"<1-2 sentences on why this pairing works>"}]}`;

      const result = await callClaude(apiKey, {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system:     'You are a typography expert. Respond with JSON only, no markdown or prose.',
        messages:   [{ role: 'user', content: prompt }],
      });

      return result
        ? Response.json(result)
        : Response.json({ error: 'Font pairing failed. Please try again.' }, { status: 502 });
    }

    // ── Usage counter ──────────────────────────────────────────────────────────
    if (url.pathname === '/u') {
      const key = url.searchParams.get('k');
      if (!key || !/^[a-z]+$/.test(key)) {
        return new Response('Bad request', { status: 400 });
      }

      const action = request.method === 'POST' ? 'up' : 'get';
      const doUrl  = new URL(request.url);
      doUrl.searchParams.set('action', action);
      const stub = env.COUNTERS.get(env.COUNTERS.idFromName(key));
      return stub.fetch(new Request(doUrl, { method: 'GET', headers: request.headers }));
    }

    // ── Static assets + HTML count injection ───────────────────────────────────
    const response = await env.ASSETS.fetch(request);
    const ct = response.headers.get('Content-Type') || '';
    if (!ct.includes('text/html')) return response;

    const counts = {};
    await Promise.all(COUNTER_KEYS.map(async key => {
      try {
        const doUrl = new URL(url.href);
        doUrl.searchParams.set('action', 'get');
        const stub = env.COUNTERS.get(env.COUNTERS.idFromName(key));
        const r    = await stub.fetch(new Request(doUrl, { method: 'GET' }));
        const { value } = await r.json();
        counts[key] = value ?? 0;
      } catch (_) {}
    }));

    const html     = await response.text();
    const script   = `<script>window.__C__=${JSON.stringify(counts)}</script>`;
    const injected = html.replace('</head>', script + '</head>');

    const headers = new Headers(response.headers);
    headers.set('Permissions-Policy', PERMISSIONS_POLICY);
    return new Response(injected, { status: response.status, headers });
  },
};
