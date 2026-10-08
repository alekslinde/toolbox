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

// ── Counter Durable Object ────────────────────────────────────────────────────
export class Counter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    // Coerce to a number: guards against legacy/non-numeric stored values that
    // would otherwise turn `value += 1` into string concatenation.
    const stored = await this.state.storage.get('value');
    let value = Number(stored);
    if (!Number.isFinite(value)) value = 0;

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

// How long event rows are kept. Aggregates are the point; the rows behind them
// are not worth holding indefinitely, and a retention window that exists only
// as a promise is not a retention window.
const EVENT_RETENTION_DAYS = 90;

// Per-IP daily caps. Events are machine-generated and so need a looser cap than
// hand-written reports, but an uncapped endpoint is an invitation.
const EVENT_DAILY_CAP = 200;
const REPORT_DAILY_CAP = 10;

// ── Feedback Durable Object ───────────────────────────────────────────────────
// Two tables, one DO instance ("feedback"):
//
//   reports — the original per-submission bad-output reports. Shaped for one
//             tool (original/compressed/note) and kept as-is: it holds live
//             data, and its endpoint still works.
//   events  — the generic store every tool reports to. One row per error,
//             friction signal or feedback chip.
//
// The events table holds codes and shapes only. No file content, no filename,
// no user-entered text, no exception message ever reaches it — see
// src/lib/telemetry-codes.ts for why that rule is absolute.
export class FeedbackStore {
  constructor(state) {
    this.state = state;
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        INTEGER NOT NULL,
        ip_hash   TEXT    NOT NULL,
        day       TEXT    NOT NULL,
        content_hash TEXT NOT NULL,
        original  TEXT    NOT NULL,
        compressed TEXT   NOT NULL,
        note      TEXT    NOT NULL DEFAULT ''
      )
    `);

    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        ts       INTEGER NOT NULL,
        day      TEXT    NOT NULL,
        ip_hash  TEXT    NOT NULL,
        kind     TEXT    NOT NULL,
        tool     TEXT    NOT NULL,
        code     TEXT    NOT NULL,
        size     TEXT    NOT NULL DEFAULT '',
        mime     TEXT    NOT NULL DEFAULT '',
        ms       INTEGER,
        ua_class TEXT    NOT NULL,
        fp       TEXT    NOT NULL
      )
    `);

    // Grouping by fingerprint is the read path that matters, and the daily cap
    // is checked on every write.
    this.state.storage.sql.exec('CREATE INDEX IF NOT EXISTS idx_events_fp ON events(fp)');
    this.state.storage.sql.exec('CREATE INDEX IF NOT EXISTS idx_events_day ON events(day, ip_hash)');
  }

  async fetch(request) {
    const url    = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'submit') {
      const { ipHash, day, contentHash, original, compressed, note } = await request.json();

      // Dedup: same IP + same content hash on the same day → reject
      const dup = this.state.storage.sql
        .exec('SELECT 1 FROM reports WHERE ip_hash=? AND content_hash=? AND day=? LIMIT 1', ipHash, contentHash, day)
        .toArray();
      if (dup.length > 0) return Response.json({ ok: false, reason: 'duplicate' });

      // Per-IP daily cap
      const count = this.state.storage.sql
        .exec('SELECT COUNT(*) as n FROM reports WHERE ip_hash=? AND day=?', ipHash, day)
        .toArray()[0].n;
      if (count >= REPORT_DAILY_CAP) return Response.json({ ok: false, reason: 'rate_limited' });

      this.state.storage.sql.exec(
        'INSERT INTO reports (ts,ip_hash,day,content_hash,original,compressed,note) VALUES (?,?,?,?,?,?,?)',
        Date.now(), ipHash, day, contentHash, original, compressed, note
      );
      return Response.json({ ok: true });
    }

    if (action === 'list') {
      const rows = this.state.storage.sql
        .exec('SELECT id,ts,original,compressed,note FROM reports ORDER BY id DESC LIMIT 500')
        .toArray();
      return Response.json({ rows });
    }

    // ── Events ────────────────────────────────────────────────────────────────

    if (action === 'event') {
      const { ipHash, day, kind, tool, code, size, mime, ms, uaClass, fp } = await request.json();

      const count = this.state.storage.sql
        .exec('SELECT COUNT(*) as n FROM events WHERE ip_hash=? AND day=?', ipHash, day)
        .toArray()[0].n;
      if (count >= EVENT_DAILY_CAP) return Response.json({ ok: false, reason: 'rate_limited' });

      this.state.storage.sql.exec(
        'INSERT INTO events (ts,day,ip_hash,kind,tool,code,size,mime,ms,ua_class,fp) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        Date.now(), day, ipHash, kind, tool, code, size, mime, ms, uaClass, fp
      );
      return Response.json({ ok: true });
    }

    // Grouped read. 500 raw rows say nothing; a dozen ranked groups say what to
    // fix next, which is the only reason to collect any of this.
    if (action === 'groups') {
      const rows = this.state.storage.sql
        .exec(`
          SELECT kind, tool, code, ua_class, fp,
                 COUNT(*)        AS n,
                 COUNT(DISTINCT ip_hash) AS users,
                 MIN(ts)         AS first_seen,
                 MAX(ts)         AS last_seen,
                 CAST(AVG(ms) AS INTEGER) AS avg_ms
          FROM events
          GROUP BY fp
          ORDER BY n DESC
          LIMIT 200
        `)
        .toArray();
      return Response.json({ groups: rows });
    }

    // Per-tool health: the numbers behind a public success-rate page.
    if (action === 'health') {
      const rows = this.state.storage.sql
        .exec(`
          SELECT tool,
                 SUM(CASE WHEN kind='error'    THEN 1 ELSE 0 END) AS errors,
                 SUM(CASE WHEN kind='friction' THEN 1 ELSE 0 END) AS friction,
                 SUM(CASE WHEN kind='report'   THEN 1 ELSE 0 END) AS reports,
                 COUNT(*) AS total
          FROM events
          GROUP BY tool
          ORDER BY total DESC
        `)
        .toArray();
      return Response.json({ tools: rows });
    }

    // Retention. Rows older than the window go; the aggregates computed from
    // them are what persists.
    if (action === 'prune') {
      const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 86400_000)
        .toISOString().slice(0, 10);
      this.state.storage.sql.exec('DELETE FROM events WHERE day < ?', cutoff);
      const left = this.state.storage.sql
        .exec('SELECT COUNT(*) as n FROM events').toArray()[0].n;
      return Response.json({ ok: true, cutoff, remaining: left });
    }

    return new Response('Bad request', { status: 400 });
  }
}

// ── Counter key registry ──────────────────────────────────────────────────────
// Canonical list of all counter keys in use. Kept as documentation of the valid
// key space; HTML injection now fetches only the current page's h-<slug> counter
// (see below) rather than fanning out across this whole list.

// eslint-disable-next-line no-unused-vars
const COUNTER_KEYS = [
  'font', 'img', 'diff', 'color', 'brand', 'pdf', 'code', 'xd',
  // per-tool helpful counts
  'h-brand-assets', 'h-code-formatter', 'h-code-minifier', 'h-color-extractor',
  'h-color-gradient', 'h-color-namer', 'h-color-palette', 'h-file-diff',
  'h-font-converter', 'h-ico-generator', 'h-image-convert',
  'h-pdf-compress', 'h-pdf-convert', 'h-pdf-organiser', 'h-scss-compiler',
  'h-semantic-html', 'h-svg-validator', 'h-tints-shades', 'h-token-saver',
  'h-wcag-contrast', 'h-xd-to-figma',
  // per-tool page-view counts
  'pv-brand-assets', 'pv-code-formatter', 'pv-code-minifier', 'pv-color-extractor',
  'pv-color-gradient', 'pv-color-namer', 'pv-color-palette', 'pv-file-diff',
  'pv-font-converter', 'pv-ico-generator',
  'pv-image-compress', 'pv-image-convert', 'pv-image-resize', 'pv-pdf-compress',
  'pv-pdf-convert', 'pv-pdf-organiser', 'pv-scss-compiler', 'pv-semantic-html',
  'pv-svg-validator', 'pv-tints-shades', 'pv-token-saver', 'pv-wcag-contrast',
  'pv-xd-to-figma',
];

// ── Telemetry vocabulary ──────────────────────────────────────────────────────
// The Worker is plain JS and cannot import the TypeScript enum, so these lists
// are duplicated from src/lib/telemetry-codes.ts. A test asserts the two stay
// identical, because a silent drift here would reject real events or admit
// unvalidated ones.
//
// Validation is allowlist-only: an event whose kind, code or ua class is not
// named here is dropped. That is what keeps the table groupable — a free-text
// code column cannot be ranked.
const EVENT_CODES = {
  error: new Set([
    'UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'FILE_EMPTY', 'TOO_MANY_FILES',
    'DECODE_FAILED', 'CORRUPT_INPUT', 'ENCRYPTED_INPUT', 'HEIC_DECODE_FAIL',
    'PDF_PARSE_FAIL', 'FONT_PARSE_FAIL', 'SVG_PARSE_FAIL', 'IMAGE_DECODE_FAIL',
    'ENCODE_FAILED', 'OUT_OF_MEMORY', 'CANVAS_UNAVAILABLE', 'WORKER_FAILED',
    'TIMEOUT', 'FETCH_FAILED', 'PROXY_FAILED', 'INVALID_URL',
    'UNCAUGHT', 'UNKNOWN',
  ]),
  friction: new Set([
    'ABANDONED', 'RETRIED', 'NO_SAVING', 'REJECTED_TYPE', 'SLOW_RUN', 'BATCH_PARTIAL',
  ]),
  report: new Set([
    'WRONG_OUTPUT', 'TOO_SLOW', 'CONFUSING', 'FAILED',
  ]),
};

const UA_CLASSES = new Set([
  'ios-safari', 'android-chrome', 'desktop-safari',
  'desktop-chrome', 'desktop-firefox', 'other',
]);

const SIZE_BUCKETS = new Set(['unknown', '0', '<100KB', '<1MB', '<10MB', '<50MB', '>=50MB']);

// A MIME type is a category; a filename is an identifier. Only the former is
// accepted, and only in its canonical shape.
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]{1,60}$/;

// ── Main worker ───────────────────────────────────────────────────────────────

// Hosts that must hand traffic to the canonical domain. Kept as an explicit
// list so a request arriving on an unexpected host is served normally rather
// than bounced somewhere it did not ask for.
const CANONICAL_HOST = 'toolkist.app';
const LEGACY_HOSTS = new Set(['lindetoolbox.com', 'www.lindetoolbox.com']);

export default {
  // Retention sweep. The prune action existed from the start but nothing
  // invoked it, so the 90-day window was a promise rather than a mechanism —
  // rows would have accumulated indefinitely. The cron trigger lives in
  // wrangler.toml; this handler is what it calls.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
      const res = await stub.fetch(new Request('https://x/?action=prune'));
      const { cutoff, remaining } = await res.json();
      console.log(`events pruned before ${cutoff}; ${remaining} rows remain`);
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Legacy-domain redirect ────────────────────────────────────────────────
    // Runs before every other handler so a request on the old domain never
    // reaches counter or feedback state. Path, query and hash are preserved so
    // deep links survive the move; 301 lets search engines transfer ranking.
    if (LEGACY_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_HOST;
      url.protocol = 'https:';
      url.port = '';
      return Response.redirect(url.toString(), 301);
    }

    // run_worker_first is "/*" (see wrangler.toml), so every request lands here,
    // including static assets. Anything that is not an API route and not a tool
    // page needs no Worker logic, so hand it to the asset layer immediately
    // rather than falling through the handlers below.
    const API_PATHS = new Set(['/pv', '/feedback', '/u', '/ev', '/health.json']);
    if (!API_PATHS.has(url.pathname) && !/^\/tools\/[a-z][a-z0-9-]*\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // ── Events ────────────────────────────────────────────────────────────────
    // Accepts only a code and a shape. Every field is validated against an
    // allowlist and anything unrecognised is dropped rather than stored, so the
    // table cannot accumulate free text even if a client sends some.
    if (url.pathname === '/ev') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== `https://${CANONICAL_HOST}`) {
        return new Response('Forbidden', { status: 403 });
      }

      // Admin read — same Bearer token as /feedback.
      if (request.method === 'GET') {
        const auth = request.headers.get('Authorization') || '';
        if (!env.FEEDBACK_SECRET || auth !== `Bearer ${env.FEEDBACK_SECRET}`) {
          return new Response('Unauthorized', { status: 401 });
        }
        const view = url.searchParams.get('view') === 'health' ? 'health' : 'groups';
        const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
        return stub.fetch(new Request(`https://x/?action=${view}`));
      }

      // Retention sweep — also Bearer-guarded, and idempotent.
      if (request.method === 'DELETE') {
        const auth = request.headers.get('Authorization') || '';
        if (!env.FEEDBACK_SECRET || auth !== `Bearer ${env.FEEDBACK_SECRET}`) {
          return new Response('Unauthorized', { status: 401 });
        }
        const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
        return stub.fetch(new Request('https://x/?action=prune'));
      }

      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      let body;
      try { body = await request.json(); } catch (_) {
        return new Response('Bad request', { status: 400 });
      }

      const { kind, tool, code, size, mime, ms, ua } = body || {};

      // Kind and code must both be named in the vocabulary above.
      if (typeof kind !== 'string' || !EVENT_CODES[kind]) {
        return new Response('Bad request', { status: 400 });
      }
      if (typeof code !== 'string' || !EVENT_CODES[kind].has(code)) {
        return new Response('Bad request', { status: 400 });
      }
      // The tool must look like a slug. A slug is a public route name, not an
      // identifier for anyone.
      if (typeof tool !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(tool)) {
        return new Response('Bad request', { status: 400 });
      }
      if (typeof ua !== 'string' || !UA_CLASSES.has(ua)) {
        return new Response('Bad request', { status: 400 });
      }

      // Optional fields: accepted only in their canonical shape, else dropped.
      const sizeVal = typeof size === 'string' && SIZE_BUCKETS.has(size) ? size : '';
      const mimeVal = typeof mime === 'string' && MIME_RE.test(mime) ? mime : '';
      const msVal = Number.isFinite(ms) && ms >= 0 && ms < 3_600_000 ? Math.round(ms) : null;

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipHash = await hashIP(ip);
      const day = new Date().toISOString().slice(0, 10);
      const fp = `${kind}:${tool}:${code}:${ua}`;

      const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
      await stub.fetch(new Request('https://x/?action=event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ipHash, day, kind, tool, code,
          size: sizeVal, mime: mimeVal, ms: msVal, uaClass: ua, fp,
        }),
      }));

      // 204 regardless of whether the row was capped: a client learns nothing
      // from the difference, and telemetry must never alter what a tool does.
      return new Response(null, { status: 204 });
    }

    // ── Public health ─────────────────────────────────────────────────────────
    // Aggregates only, no auth. Publishing this keeps the project honest: a
    // tool sitting at a poor success rate is visible every day rather than
    // discoverable on request, and a contributor can see where the pain is
    // without being handed a triage queue.
    //
    // It exposes counts per tool and per error code — never a row, never an IP
    // hash, never a timestamp that could single anyone out.
    // Served at /health.json, not /health: the Worker runs before the asset
    // layer, so an API route named /health would shadow the page of the same
    // name and the page would never be reachable in production.
    if (url.pathname === '/health.json') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }

      const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
      const [healthRes, groupRes] = await Promise.all([
        stub.fetch(new Request('https://x/?action=health')),
        stub.fetch(new Request('https://x/?action=groups')),
      ]);
      const { tools } = await healthRes.json();
      const { groups } = await groupRes.json();

      // Strip everything per-user from the group rows before they go public.
      const publicGroups = groups
        .filter(g => g.kind === 'error')
        .slice(0, 20)
        .map(g => ({ tool: g.tool, code: g.code, browser: g.ua_class, count: g.n }));

      return Response.json(
        { tools, topErrors: publicGroups, retentionDays: EVENT_RETENTION_DAYS },
        { headers: { 'Cache-Control': 'public, max-age=300' } },
      );
    }

    // ── Page-view counter ─────────────────────────────────────────────────────
    if (url.pathname === '/pv' && request.method === 'POST') {
      const slug = url.searchParams.get('s');
      if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
        return new Response('Bad request', { status: 400 });
      }
      const key  = `pv-${slug}`;
      const stub = env.COUNTERS.get(env.COUNTERS.idFromName(key));
      await stub.fetch(new Request(`https://x/?action=up`, { method: 'GET' }));
      return new Response(null, { status: 204 });
    }

    // ── Feedback ───────────────────────────────────────────────────────────────
    if (url.pathname === '/feedback') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== 'https://toolkist.app') {
        return new Response('Forbidden', { status: 403 });
      }

      // Admin read — Bearer token required
      if (request.method === 'GET') {
        const auth   = request.headers.get('Authorization') || '';
        const secret = env.FEEDBACK_SECRET;
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response('Unauthorized', { status: 401 });
        }
        const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
        return stub.fetch(new Request('https://x/?action=list'));
      }

      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (_) {
          return new Response('Bad request', { status: 400 });
        }

        const { original, compressed, note = '' } = body;

        // Payload validation
        if (
          typeof original   !== 'string' || original.length   < 10 || original.length   > 2000 ||
          typeof compressed !== 'string' || compressed.length  < 1  || compressed.length > 2000 ||
          typeof note       !== 'string' || note.length > 280
        ) {
          return new Response('Bad request', { status: 400 });
        }

        const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
        const day = new Date().toISOString().slice(0, 10);

        // Hash IP for storage (no PII retained)
        const ipHash = await hashIP(ip);

        // Hash content so we can dedup without storing the IP alongside raw text
        const contentRaw  = original + '\x00' + compressed;
        const contentBuf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contentRaw));
        const contentHash = Array.from(new Uint8Array(contentBuf)).slice(0, 8)
          .map(b => b.toString(16).padStart(2, '0')).join('');

        const stub   = env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback'));
        const result = await (await stub.fetch(new Request('https://x/?action=submit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ipHash, day, contentHash, original, compressed, note }),
        }))).json();

        if (result.reason === 'duplicate') {
          return Response.json({ ok: false, error: 'Already reported.' }, { status: 409 });
        }
        if (result.reason === 'rate_limited') {
          return Response.json({ ok: false, error: 'Too many reports today.' }, { status: 429 });
        }

        return Response.json({ ok: true });
      }

      return new Response('Method not allowed', { status: 405 });
    }

    // ── Usage counter ──────────────────────────────────────────────────────────
    if (url.pathname === '/u') {
      const key = url.searchParams.get('k');
      if (!key || !/^[a-z][a-z0-9-]*$/.test(key)) {
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

    // Only the HelpfulButton reads window.__C__, and only its own h-<slug>
    // counter. So fetch just that one Durable Object for a tool page instead of
    // fanning out to every counter in the catalog on every HTML request.
    const counts = {};
    const toolMatch = url.pathname.match(/^\/tools\/([a-z][a-z0-9-]*)\/?$/);
    if (toolMatch) {
      const key = `h-${toolMatch[1]}`;
      try {
        const doUrl = new URL(url.href);
        doUrl.searchParams.set('action', 'get');
        const stub = env.COUNTERS.get(env.COUNTERS.idFromName(key));
        const r    = await stub.fetch(new Request(doUrl, { method: 'GET' }));
        const { value } = await r.json();
        counts[key] = value ?? 0;
      } catch (_) {}
    }

    const html     = await response.text();
    const script   = `<script>window.__C__=${JSON.stringify(counts)}</script>`;
    const injected = html.replace('</head>', script + '</head>');

    const headers = new Headers(response.headers);
    headers.set('Permissions-Policy', PERMISSIONS_POLICY);
    return new Response(injected, { status: response.status, headers });
  },
};
