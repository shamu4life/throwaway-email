// ─────────────────────────────────────────────────────────────────────────────
// ThrowMail (ShitPost.email) — dependency-free Cloudflare Worker
//
// Disposable email: pick a username + domain to get a self-destructing INBOX
// (mail parsed and stored in KV) or a REDIRECT (mail forwarded to a real
// address). The JSON API, the persistence layer, and the entire web UI all
// live in this one file — zero runtime dependencies, no build step. It is
// meant to be paste-able straight into the Cloudflare dashboard editor.
//
// File layout (keep new code under the matching banner):
//   1. Config constants        — domains + TTL/size/count limits
//   2. Inline MIME parser       — parseEmail … decodeRfc2047 (no mail-parse dep)
//   3. Email event handling     — handleEmailEvent, streamToArrayBuffer
//   4. API handlers             — handleAPI, handleCreate, handleGet/DeleteInbox
//   5. UI                       — serveUI, buildHTML (embedded SPA)
//   6. Helpers + exports        — json(), { fetch, email }
//
// Cloudflare bindings (see wrangler.toml):
//   env.KV               — KV namespace; the only persistence layer.
//   [[send_email]]       — used by message.forward() for redirects.
//
// KV key schema:
//   addr:<email>  → { type:'inbox'|'redirect', target?, token?, created, expires }
//   msgs:<email>  → [ { id, from, fromName, subject, text, html, date }, … ]  (newest first, ≤ MAX_MESSAGES)
//   Both keys are written with an expirationTtl — KV enforces expiry, no cron.
//
// HTTP API (all JSON, CORS open):
//   POST   /api/create  { username, domain, target?, ttl? } → { email, token, type, expires }
//   GET    /api/inbox?email=&token=                          → { email, messages, expires, count }
//   DELETE /api/inbox?email=&token=                          → { deleted: true }
//
// Full architecture notes live in CLAUDE.md.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = ['shitpost.email', 'letsfuckingpiss.party', 'megapenispoopenfarten.sex'];
const INBOX_TTL       = 86400;           // 24 hours
const REDIRECT_TTL    = 2592000;         // 30 days
const MAX_MESSAGES    = 50;
const MAX_EMAIL_BYTES = 5 * 1024 * 1024; // 5 MB

// ─────────────────────────────────────────────────────────────────────────────
// Inline MIME parser
// ─────────────────────────────────────────────────────────────────────────────

function parseEmail(buffer) {
  const raw     = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const sepIdx  = raw.indexOf('\r\n\r\n');
  const headerBlock = sepIdx === -1 ? raw  : raw.slice(0, sepIdx);
  const bodyBlock   = sepIdx === -1 ? ''   : raw.slice(sepIdx + 4);
  const headers = parseHeaders(headerBlock);
  const subject = decodeRfc2047(headers['subject'] || '');
  const { address: fromAddr, name: fromName } = parseAddress(headers['from'] || '');
  const contentType = headers['content-type'] || 'text/plain';
  const boundary    = extractBoundary(contentType);
  let text = '', html = '';
  if (boundary) {
    ({ text, html } = extractParts(bodyBlock, boundary));
  } else {
    const decoded = decodePart(bodyBlock, headers['content-transfer-encoding'] || '', contentType);
    if (contentType.toLowerCase().includes('text/html')) html = decoded;
    else text = decoded;
  }
  return { subject, from: fromAddr, fromName, text, html };
}

function parseHeaders(block) {
  const headers = {};
  for (const line of block.replace(/\r\n([ \t])/g, '$1').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (!headers[key]) headers[key] = line.slice(colon + 1).trim();
  }
  return headers;
}

function extractBoundary(ct) {
  const m = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  return m ? (m[1] || m[2]) : null;
}

function extractParts(body, boundary, depth = 0) {
  if (depth > 4) return { text: '', html: '' };
  let text = '', html = '';
  for (const part of body.split(new RegExp('--' + boundary + '(?:--)?\\r?\\n?'))) {
    if (!part.trim() || part.trim() === '--') continue;
    const sep = part.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    const ph  = parseHeaders(part.slice(0, sep));
    const pb  = part.slice(sep + 4);
    const ct  = ph['content-type'] || 'text/plain';
    const ctl = ct.toLowerCase();
    if (ctl.includes('multipart/')) {
      const ib = extractBoundary(ct);
      if (ib) {
        const inner = extractParts(pb, ib, depth + 1);
        if (!text && inner.text) text = inner.text;
        if (!html && inner.html) html = inner.html;
      }
    } else if (ctl.includes('text/html') && !html) {
      html = decodePart(pb, ph['content-transfer-encoding'] || '', ct);
    } else if (ctl.includes('text/plain') && !text) {
      text = decodePart(pb, ph['content-transfer-encoding'] || '', ct);
    }
  }
  return { text, html };
}

function decodePart(body, enc, contentType = '') {
  enc = (enc || '').toLowerCase().trim();
  if (enc === 'base64') {
    try {
      const bin     = atob(body.replace(/\s+/g, ''));
      const charset = (contentType.match(/charset=(?:"?)([\w-]+)(?:"?)/i) || [])[1] || 'utf-8';
      const bytes   = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch { return body; }
  }
  if (enc === 'quoted-printable') {
    return body.replace(/=\r\n/g, '').replace(/=\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body.replace(/\r\n--$/, '').trimEnd();
}

function parseAddress(raw) {
  const m = raw.match(/^"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), address: m[2].trim() };
  return { name: '', address: raw.trim() };
}

function decodeRfc2047(val) {
  return val.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') {
        const bin = atob(text.replace(/\s/g, ''));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        const qp = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        bytes = new Uint8Array(qp.length);
        for (let i = 0; i < qp.length; i++) bytes[i] = qp.charCodeAt(i);
      }
      return new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch { return text; }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Email event handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleEmailEvent(message, env) {
  const to     = message.to.toLowerCase().trim();
  const record = await env.KV.get(`addr:${to}`, 'json');
  if (!record) { message.setReject('Unknown address'); return; }

  if (record.type === 'redirect') { await message.forward(record.target); return; }

  if (record.type === 'inbox') {
    let rawBuffer;
    try {
      rawBuffer = await streamToArrayBuffer(message.raw, MAX_EMAIL_BYTES);
    } catch (err) {
      if (err.message === 'TOO_LARGE') { message.setReject('Message exceeds 5 MB size limit'); return; }
      throw err;
    }
    const parsed   = parseEmail(rawBuffer);
    const msg      = {
      id: crypto.randomUUID(), from: parsed.from, fromName: parsed.fromName,
      subject: parsed.subject || '(no subject)',
      text: (parsed.text || '').slice(0, 10000),
      html: (parsed.html || '').slice(0, 50000),
      date: new Date().toISOString(),
    };
    const msgsKey  = `msgs:${to}`;
    const existing = (await env.KV.get(msgsKey, 'json')) || [];
    existing.unshift(msg);
    const ttl = record.expires - Math.floor(Date.now() / 1000);
    if (ttl > 0) await env.KV.put(msgsKey, JSON.stringify(existing.slice(0, MAX_MESSAGES)), { expirationTtl: ttl });
  }
}

async function streamToArrayBuffer(stream, maxBytes) {
  const reader = stream.getReader(), chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error('TOO_LARGE'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// API handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleAPI(request, env, url) {
  // Guard: KV binding must exist
  if (!env.KV) return json({ error: 'KV storage is not configured. Add a KV namespace binding named "KV" to this Worker in the Cloudflare dashboard (Worker → Settings → Variables → KV Namespace Bindings).' }, 500);

  const p = url.pathname;
  if (p === '/api/create'  && request.method === 'POST')   return handleCreate(request, env);
  if (p === '/api/inbox'   && request.method === 'GET')    return handleGetInbox(request, env, url);
  if (p === '/api/inbox'   && request.method === 'DELETE') return handleDeleteInbox(request, env, url);
  return json({ error: 'Not found' }, 404);
}

async function handleCreate(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { username, domain, target, ttl: reqTtl } = body;
  const type = (target && target.trim()) ? 'redirect' : 'inbox';

  if (!username || !domain)   return json({ error: 'Missing fields' }, 400);
  if (!ALLOWED_DOMAINS.includes(domain)) return json({ error: 'Invalid domain' }, 400);
  if (!/^[a-zA-Z0-9._+\-]{1,64}$/.test(username))
    return json({ error: 'Username may only contain letters, numbers, and . _ + - (max 64 chars)' }, 400);
  if (type === 'redirect' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.trim()))
    return json({ error: "That doesn't look like a valid email address" }, 400);

  const email   = `${username.toLowerCase()}@${domain}`;
  if (await env.KV.get(`addr:${email}`))
    return json({ error: 'That address is already taken — try a different username.' }, 409);

  const now = Math.floor(Date.now() / 1000);
  const t   = parseInt(reqTtl, 10);
  const ttl = type === 'inbox'
    ? (Number.isFinite(t) && t >= 3600    && t <= 172800   ? t : INBOX_TTL)
    : (Number.isFinite(t) && t >= 2592000 && t <= 15552000 ? t : REDIRECT_TTL);
  const token = type === 'inbox' ? crypto.randomUUID().replace(/-/g, '') : null;

  await env.KV.put(`addr:${email}`, JSON.stringify({
    type, target: type === 'redirect' ? target.trim() : undefined,
    token, created: now, expires: now + ttl,
  }), { expirationTtl: ttl });

  return json({ email, token, type, expires: now + ttl });
}

async function handleGetInbox(request, env, url) {
  const email = url.searchParams.get('email')?.toLowerCase();
  const token = url.searchParams.get('token');
  if (!email || !token) return json({ error: 'Missing email or token' }, 400);
  const record = await env.KV.get(`addr:${email}`, 'json');
  if (!record || record.type !== 'inbox') return json({ error: 'Inbox not found' }, 404);
  if (record.token !== token)             return json({ error: 'Unauthorized' }, 401);
  const messages = (await env.KV.get(`msgs:${email}`, 'json')) || [];
  return json({ email, messages, expires: record.expires, count: messages.length });
}

async function handleDeleteInbox(request, env, url) {
  const email = url.searchParams.get('email')?.toLowerCase();
  const token = url.searchParams.get('token');
  if (!email || !token) return json({ error: 'Missing params' }, 400);
  const record = await env.KV.get(`addr:${email}`, 'json');
  if (!record || record.token !== token) return json({ error: 'Unauthorized' }, 401);
  await env.KV.delete(`addr:${email}`);
  await env.KV.delete(`msgs:${email}`);
  return json({ deleted: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

function serveUI(request) {
  const host   = new URL(request.url).hostname;
  const domain = ALLOWED_DOMAINS.includes(host) ? host : ALLOWED_DOMAINS[0];
  return new Response(buildHTML(domain), {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

function buildHTML(currentDomain) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Disposable email, no bullshit. Temp inboxes and mail redirects — no account, no logs, no drama.">
<meta name="theme-color" content="#db2777">
<meta property="og:title" content="ShitPost.email">
<meta property="og:description" content="Disposable email, no bullshit. Temp inboxes and mail redirects — no account, no logs, no drama.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="ShitPost.email">
<meta name="twitter:description" content="Disposable email, no bullshit. Temp inboxes and mail redirects — no account, no logs, no drama.">
<title>ShitPost.email</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💩</text></svg>">
<style>
*{box-sizing:border-box;margin:0;padding:0}

/* ── Dark theme: default ─────────────────────────────────────────────────── */
:root {
  --bg:#16161d;--surface:#1e1e28;--s2:#25252f;--s3:#2c2c38;
  --border:#333345;--border2:#3d3d52;
  --accent:#db2777;--accent2:#f472b6;--accent3:#fbcfe8;
  --text:#f0f0f0;--muted:#6b6b6b;--muted2:#4d4d4d;
  --green:#22c55e;--red:#f87171;
  --shadow:0 4px 24px rgba(0,0,0,.35);
  --disc-bg:rgba(219,39,119,.07);--disc-border:rgba(219,39,119,.25);--disc-text:#f472b6;
}

/* ── Light theme: system preference ─────────────────────────────────────── */
/* Comes after :root so it wins when the media query matches (same specificity, later = wins) */
@media (prefers-color-scheme: light) {
  :root {
    --bg:#f5f5f5;--surface:#ffffff;--s2:#eeeeee;--s3:#e5e5e5;
    --border:#d8d8d8;--border2:#c2c2c2;
    --accent:#be185d;--accent2:#db2777;--accent3:#9d174d;
    --text:#111111;--muted:#666666;--muted2:#999999;
    --green:#16a34a;--red:#dc2626;
    --shadow:0 4px 24px rgba(0,0,0,.08);
    --disc-bg:rgba(190,24,93,.07);--disc-border:rgba(190,24,93,.25);--disc-text:#9d174d;
  }
}

/* ── Manual overrides: html[data-theme] has higher specificity (element + attribute) ── */
html[data-theme="dark"] {
  --bg:#16161d;--surface:#1e1e28;--s2:#25252f;--s3:#2c2c38;
  --border:#333345;--border2:#3d3d52;
  --accent:#db2777;--accent2:#f472b6;--accent3:#fbcfe8;
  --text:#f0f0f0;--muted:#6b6b6b;--muted2:#4d4d4d;
  --green:#22c55e;--red:#f87171;
  --shadow:0 4px 24px rgba(0,0,0,.35);
  --disc-bg:rgba(219,39,119,.07);--disc-border:rgba(219,39,119,.25);--disc-text:#f472b6;
}
html[data-theme="light"] {
  --bg:#f5f5f5;--surface:#ffffff;--s2:#eeeeee;--s3:#e5e5e5;
  --border:#d8d8d8;--border2:#c2c2c2;
  --accent:#be185d;--accent2:#db2777;--accent3:#9d174d;
  --text:#111111;--muted:#666666;--muted2:#999999;
  --green:#16a34a;--red:#dc2626;
  --shadow:0 4px 24px rgba(0,0,0,.08);
  --disc-bg:rgba(190,24,93,.07);--disc-border:rgba(190,24,93,.25);--disc-text:#9d174d;
}

body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;transition:background .2s,color .2s}
header{border-bottom:1px solid var(--border);padding:.85rem 1.5rem;display:flex;align-items:center;gap:.75rem;flex-shrink:0}
.logo{font-size:1.05rem;font-weight:800;color:var(--text);background:none;border:none;padding:0;cursor:pointer;transition:color .15s;font-family:inherit;letter-spacing:-.01em}
.logo:hover{color:var(--accent2)}
.logo-tld{color:var(--accent)}
.dbadge{font-size:.7rem;background:var(--s2);border:1px solid var(--border2);padding:.15rem .55rem;border-radius:999px;color:var(--muted);font-family:monospace;flex-shrink:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hspace{flex:1}
.theme-btn{background:var(--s2);border:1px solid var(--border2);color:var(--muted);padding:.35rem .65rem;border-radius:5px;font-size:.8rem;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:.35rem;flex-shrink:0;font-family:inherit}
.theme-btn:hover{border-color:var(--accent);color:var(--text)}
main{flex:1;padding:2rem 1rem;max-width:620px;margin:0 auto;width:100%}
h1{font-size:1.6rem;font-weight:800;margin-bottom:.4rem;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:.875rem;line-height:1.7;margin-bottom:1.75rem}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.5rem;margin-bottom:1rem;box-shadow:var(--shadow)}
label{display:block;font-size:.75rem;font-weight:700;color:var(--muted);margin-bottom:.35rem;text-transform:uppercase;letter-spacing:.05em}
.label-opt{font-weight:400;text-transform:none;letter-spacing:0;font-size:.7rem;color:var(--muted2);margin-left:.3rem}
input,select{width:100%;background:var(--s2);border:1px solid var(--border2);color:var(--text);padding:.6rem .85rem;border-radius:6px;font-size:.9rem;outline:2px solid transparent;transition:border-color .15s,box-shadow .15s,outline-color .15s;font-family:inherit}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(219,39,119,.18);outline-color:var(--accent)}
input::placeholder{color:var(--muted2)}
select option{background:var(--s2);color:var(--text)}
.igroup{display:flex;gap:.4rem;align-items:center;margin-bottom:1.1rem}
.igroup input{margin-bottom:0;flex:1;min-width:0}
.igroup select{margin-bottom:0;flex:0 0 auto;width:auto}
.at{color:var(--muted);font-weight:700;flex-shrink:0;font-size:.9rem}
.mb1{margin-bottom:1.1rem}
.mode-hint{font-size:.78rem;color:var(--accent2);min-height:1.2em;margin-bottom:.9rem;font-weight:500;word-break:break-all}
.disc{background:var(--disc-bg);border:1px solid var(--disc-border);border-radius:6px;padding:.85rem 1rem;margin-bottom:1.1rem}
.disc-hd{display:flex;align-items:center;gap:.4rem;font-size:.78rem;font-weight:700;color:var(--disc-text);cursor:pointer;user-select:none;background:none;border:none;width:100%;text-align:left;padding:0;font-family:inherit}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.disc-body{font-size:.75rem;color:var(--muted);line-height:1.75;display:none;margin-top:.5rem}
.disc-body.open{display:block}
.disc-body ul{padding-left:1.1rem}
.disc-body li{margin-bottom:.25rem}
.disc-chevron{margin-left:auto;transition:transform .2s;font-style:normal}
.disc-chevron.open{transform:rotate(180deg)}
.btn-primary{width:100%;padding:.72rem;background:var(--accent);color:#fff;border:none;border-radius:7px;font-size:.95rem;font-weight:800;letter-spacing:.01em;transition:opacity .15s;font-family:inherit;cursor:pointer}
.btn-primary:hover{opacity:.88}
.btn-primary:disabled{opacity:.45;cursor:not-allowed}
.btn-sm{padding:.38rem .8rem;background:var(--s2);color:var(--text);border:1px solid var(--border2);border-radius:5px;font-size:.8rem;font-weight:600;transition:border-color .15s,background .15s;font-family:inherit;cursor:pointer}
.btn-sm:hover{border-color:var(--accent);background:var(--s3)}
.btn-sm.on{border-color:var(--accent);background:rgba(219,39,119,.12);color:var(--accent2)}
.btn-danger{padding:.38rem .8rem;background:rgba(220,38,38,.07);color:var(--red);border:1px solid rgba(220,38,38,.22);border-radius:5px;font-size:.8rem;font-weight:600;font-family:inherit;transition:all .15s;cursor:pointer}
.btn-danger:hover{background:rgba(220,38,38,.14)}
.err{background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.22);color:var(--red);padding:.65rem .9rem;border-radius:6px;margin-bottom:.9rem;font-size:.835rem;display:none}
.err.show{display:block}
.sbox{background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.22);border-radius:8px;padding:1.2rem 1.4rem;margin-bottom:1rem}
.sbox-label{font-size:.7rem;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.3rem}
.email-addr{font-size:1rem;font-weight:800;color:var(--green);word-break:break-all;font-family:monospace;margin:.3rem 0 .7rem}
.sbox-meta{font-size:.78rem;color:var(--muted);line-height:1.85;margin-top:.75rem}
.sbox-meta strong{color:var(--text)}
.inbox-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap}
.inbox-title{font-size:.85rem;font-weight:800;word-break:break-all}
.inbox-sub{font-size:.72rem;color:var(--muted);margin-top:.2rem}
.inbox-actions{display:flex;gap:.4rem;align-items:center;flex-shrink:0;flex-wrap:wrap}
.refresh-row{display:flex;align-items:center;gap:.35rem;font-size:.72rem;color:var(--muted)}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.msg-list{display:flex;flex-direction:column;gap:.45rem}
.msg-item{background:var(--surface);border:1px solid var(--border);border-left:3px solid transparent;border-radius:6px;padding:.85rem 1rem;cursor:pointer;transition:border-color .15s,background .15s}
.msg-item:hover{border-color:var(--accent);background:var(--s2)}
.msg-item.new{border-left-color:var(--accent2)}
.msg-row1{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin-bottom:.2rem}
.msg-from{font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.msg-time{font-size:.7rem;color:var(--muted);flex-shrink:0}
.msg-subject{font-size:.875rem;font-weight:600;margin-bottom:.2rem}
.msg-preview{font-size:.75rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.empty{text-align:center;padding:3.5rem 1rem;color:var(--muted)}
.empty-icon{font-size:2.5rem;margin-bottom:.7rem;opacity:.45}
.mv-subject{font-size:1.2rem;font-weight:800;margin-bottom:.7rem;line-height:1.3}
.mv-meta{font-size:.78rem;color:var(--muted);line-height:2;margin-bottom:1.2rem}
.mv-meta strong{color:var(--text)}
.mv-body{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.2rem;font-size:.875rem;line-height:1.75;white-space:pre-wrap;word-break:break-word;max-height:520px;overflow-y:auto}
iframe.htmlbody{width:100%;height:480px;border:1px solid var(--border);border-radius:8px;background:#fff}
.view-toggle{display:flex;gap:.4rem;margin-bottom:.7rem}
.spin{display:inline-block;width:.85rem;height:.85rem;border:2px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin .55s linear infinite;vertical-align:middle;margin-right:.35rem}
@keyframes spin{to{transform:rotate(360deg)}}
.flex{display:flex}.gap{gap:.5rem}.wrap{flex-wrap:wrap}.mt{margin-top:.9rem}.mb{margin-bottom:.9rem}
footer{border-top:1px solid var(--border);padding:.8rem 1.5rem;text-align:center;font-size:.72rem;color:var(--muted2)}
</style>
</head>
<body>
<header>
  <button class="logo" onclick="App.home()" aria-label="ShitPost.email — go to home">💩 ShitPost<span class="logo-tld">.email</span></button>
  <span class="dbadge" id="dbadge">${currentDomain}</span>
  <div class="hspace"></div>
  <button class="theme-btn" id="theme-btn" onclick="App.toggleTheme()">
    <span id="theme-icon"></span><span id="theme-label"></span>
  </button>
</header>
<main id="app" tabindex="-1"></main>
<div id="announce" class="sr-only" aria-live="polite" aria-atomic="true"></div>
<footer>No accounts · No logs · Inboxes self-destruct after 24h · Zero fucks given</footer>
<script>
const DOMAINS      = ${JSON.stringify(ALLOWED_DOMAINS)};
const INIT_DOMAIN  = ${JSON.stringify(currentDomain)};
const REFRESH_SECS = 30;

// Apply saved theme before paint to avoid flash
(function(){
  const s = localStorage.getItem('tm-theme');
  if (s) document.documentElement.setAttribute('data-theme', s);
})();

const App = (() => {
  let _inbox=null, _messages=[], _activeMsg=null, _timer=null, _countdown=REFRESH_SECS, _htmlMode=false;

  const el  = id => document.getElementById(id);
  const ren = html => { el('app').innerHTML = html; };
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function fmtDate(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (diff < 1)  return 'just now';
    if (diff < 60) return diff + 'm ago';
    const h = Math.floor(diff / 60);
    if (h < 24) return h + 'h ago';
    return new Date(iso).toLocaleDateString();
  }

  function fmtExpiry(ts) {
    const ms = ts * 1000 - Date.now();
    const h  = Math.floor(ms / 3600000);
    const m  = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm';
    return 'expiring soon';
  }

  // Fetch wrapper — always resolves, never throws
  async function api(path, opts = {}) {
    try {
      const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
      // Handle non-JSON error pages (e.g. Cloudflare 500 HTML)
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        return { error: 'Server error (HTTP ' + r.status + '). Check that your KV binding is named exactly "KV" in Worker Settings → Variables.' };
      }
      return await r.json();
    } catch (err) {
      return { error: 'Network error: ' + err.message };
    }
  }

  function copyText(text, btnId) {
    navigator.clipboard.writeText(text).then(() => {
      const b = el(btnId); if (!b) return;
      const o = b.textContent; b.textContent = '✓ Copied';
      announce('Copied to clipboard');
      setTimeout(() => { b.textContent = o; }, 1800);
    }).catch(() => {
      announce('Copy failed — please copy the address manually');
    });
  }

  function announce(msg) {
    const a = el('announce'); if (!a) return;
    a.textContent = '';
    requestAnimationFrame(() => { a.textContent = msg; });
  }

  // ── Theme ────────────────────────────────────────────────────────────────

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function syncThemeBtn() {
    const dark = currentTheme() === 'dark';
    const i = el('theme-icon'), l = el('theme-label'), b = el('theme-btn');
    if (i) i.textContent = dark ? '🌙' : '☀️';
    if (l) l.textContent = dark ? 'Dark' : 'Light';
    if (b) b.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tm-theme', next);
    syncThemeBtn();
  }

  // ── Disclosure ────────────────────────────────────────────────────────────

  function discHTML() {
    return \`<div class="disc">
      <button class="disc-hd" type="button" onclick="App._toggleDisc()" aria-expanded="true" aria-controls="disc-body" id="disc-btn">
        ⚠️ Before you use this — read me
        <em class="disc-chevron open" id="disc-chev" aria-hidden="true">▾</em>
      </button>
      <div class="disc-body open" id="disc-body"><ul>
        <li><strong>Temporary inboxes expire after 1–48 hours</strong> (your choice). All messages are permanently deleted.</li>
        <li><strong>Mail redirects expire after 1–6 months</strong> (your choice) with no notification.</li>
        <li><strong>Nothing is encrypted.</strong> Emails are stored as plain text in Cloudflare KV. Throwaway use only.</li>
        <li><strong>5 MB per email limit.</strong> Larger emails are rejected.</li>
        <li><strong>No recovery.</strong> Losing your browser session means losing inbox access permanently.</li>
        <li><strong>Do not use for anything sensitive</strong> — passwords, financial info, private communications.</li>
        <li>No uptime guarantees. Use at your own risk.</li>
      </ul></div>
    </div>\`;
  }

  function _toggleDisc() {
    const b = el('disc-body'), c = el('disc-chev'), btn = el('disc-btn');
    if (b) b.classList.toggle('open');
    if (c) c.classList.toggle('open');
    if (btn) btn.setAttribute('aria-expanded', b && b.classList.contains('open') ? 'true' : 'false');
  }

  // ── Home ──────────────────────────────────────────────────────────────────

  function home() {
    clearInterval(_timer);
    _inbox = null; _messages = []; _activeMsg = null;
    el('dbadge').textContent = INIT_DOMAIN;
    ren(\`
      <h1>Burner Inbox</h1>
      <p class="sub">A throwaway address in seconds. Self-destructing inboxes (1–48 hours) or mail redirects (1–6 months) — no account, no logging, no drama.</p>
      <div class="card">
        <label for="u">Username</label>
        <div class="igroup">
          <input id="u" type="text" placeholder="shitlord69" oninput="App._onInput()"
            autocomplete="off" autocapitalize="off" spellcheck="false" aria-required="true"/>
          <span class="at" aria-hidden="true">@</span>
          <select id="d" onchange="App._onInput()" aria-label="Domain">
            \${DOMAINS.map(d => '<option value="' + d + '"' + (d === INIT_DOMAIN ? ' selected' : '') + '>' + d + '</option>').join('')}
          </select>
        </div>
        <label for="target">Forward to <span class="label-opt">optional — leave blank for a temp inbox</span></label>
        <input id="target" type="email" class="mb1"
          placeholder="definitely@real.email — or leave empty for a temp inbox"
          oninput="App._onInput()" autocomplete="email"/>
        <label for="dur" id="dur-label">Keep inbox for</label>
        <select id="dur" class="mb1" onchange="App._onInput()">
          <option value="3600">1 hour</option>
          <option value="7200">2 hours</option>
          <option value="14400">4 hours</option>
          <option value="28800">8 hours</option>
          <option value="43200">12 hours</option>
          <option value="86400" selected>24 hours</option>
          <option value="172800">48 hours</option>
        </select>
        <div class="mode-hint" id="mode-hint" aria-live="polite"></div>
        \${discHTML()}
        <div class="err" id="herr" role="alert"></div>
        <button class="btn-primary" id="createbtn" onclick="App._create()">Create Address</button>
      </div>
    \`);
    _onInput();
    syncThemeBtn();
    requestAnimationFrame(() => { el('u')?.focus(); });
  }

  function _rebuildDur(inboxMode) {
    const sel = el('dur'), lbl = el('dur-label');
    if (!sel) return;
    if (sel.dataset.mode === (inboxMode ? 'i' : 'r')) return;
    sel.dataset.mode = inboxMode ? 'i' : 'r';
    if (lbl) lbl.textContent = inboxMode ? 'Keep inbox for' : 'Active for';
    const def  = inboxMode ? 86400 : 2592000;
    const opts = inboxMode
      ? [[3600,'1 hour'],[7200,'2 hours'],[14400,'4 hours'],[28800,'8 hours'],[43200,'12 hours'],[86400,'24 hours'],[172800,'48 hours']]
      : [[2592000,'1 month'],[5184000,'2 months'],[7776000,'3 months'],[15552000,'6 months']];
    sel.innerHTML = opts.map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === def ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  }

  function _onInput() {
    const u    = (el('u')?.value || '').trim();
    const d    = el('d')?.value || INIT_DOMAIN;
    const tgt  = (el('target')?.value || '').trim();
    const hint = el('mode-hint');
    el('dbadge').textContent = d;
    _rebuildDur(!tgt);
    if (!u) { if (hint) hint.textContent = ''; return; }
    const addr   = u.toLowerCase() + '@' + d;
    const durSel = el('dur');
    const durTxt = durSel ? durSel.options[durSel.selectedIndex].text : '';
    if (hint) hint.textContent = tgt
      ? '↪️  ' + addr + ' → ' + tgt + ' · ' + durTxt
      : '📥  ' + addr + ' → temp inbox · ' + durTxt;
  }

  async function _create() {
    const username = (el('u').value || '').trim();
    const domain   = el('d').value;
    const target   = (el('target')?.value || '').trim();
    const errEl    = el('herr');
    const btn      = el('createbtn');

    errEl.classList.remove('show');

    if (!username) {
      errEl.textContent = 'Enter a username.';
      errEl.classList.add('show'); return;
    }
    if (!/^[a-zA-Z0-9._+\\-]{1,64}$/.test(username)) {
      errEl.textContent = 'Username can only contain letters, numbers, and . _ + -';
      errEl.classList.add('show'); return;
    }
    if (target && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      errEl.textContent = "That doesn’t look like a valid email address.";
      errEl.classList.add('show'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Creating…';
    btn.setAttribute('aria-busy', 'true');

    const durSel = el('dur');
    const ttl    = durSel ? parseInt(durSel.value, 10) : (target ? 2592000 : 86400);

    const res = await api('/api/create', {
      method: 'POST',
      body: JSON.stringify({ username, domain, target: target || undefined, ttl }),
    });

    btn.disabled = false;
    btn.textContent = 'Create Address';
    btn.removeAttribute('aria-busy');

    if (res.error) {
      errEl.textContent = res.error;
      errEl.classList.add('show'); return;
    }

    if (res.type === 'inbox') {
      _inbox = { email: res.email, token: res.token, expires: res.expires };
      showInboxReady(res);
    } else {
      const ds = el('dur');
      const durLabel = ds ? ds.options[ds.selectedIndex].text : '1 month';
      showRedirectReady(res, target, durLabel);
    }
  }

  // ── Post-create ────────────────────────────────────────────────────────────

  function showInboxReady(res) {
    ren(\`
      <div class="sbox">
        <div class="sbox-label">Temporary inbox created</div>
        <div class="email-addr">\${esc(res.email)}</div>
        <div class="flex gap wrap">
          <button class="btn-sm" id="copybtn" onclick="App._copy('\${res.email}','copybtn')">Copy Address</button>
          <button class="btn-sm" onclick="App.loadInbox()">Open Inbox →</button>
        </div>
        <div class="sbox-meta">
          Expires in <strong>\${fmtExpiry(res.expires)}</strong>
          · Up to \${${MAX_MESSAGES}} messages · 5 MB per email
          · Access is limited to this browser session
        </div>
      </div>
      <button class="btn-sm mt" onclick="App.home()">← Create another</button>
    \`);
  }

  function showRedirectReady(res, target, durLabel) {
    ren(\`
      <div class="sbox">
        <div class="sbox-label">Redirect active</div>
        <div class="email-addr">\${esc(res.email)}</div>
        <div style="font-size:.82rem;color:var(--muted);margin-bottom:.75rem">
          → All mail forwarded to <strong style="color:var(--text)">\${esc(target)}</strong>
        </div>
        <button class="btn-sm" id="copybtn" onclick="App._copy('\${res.email}','copybtn')">Copy Address</button>
        <div class="sbox-meta">Active for <strong>\${esc(durLabel || '1 month')}</strong> · Forwards instantly · 5 MB per email max</div>
      </div>
      <button class="btn-sm mt" onclick="App.home()">← Create another</button>
    \`);
  }

  // ── Inbox ─────────────────────────────────────────────────────────────────

  async function loadInbox() {
    if (!_inbox) return;
    _countdown = REFRESH_SECS;
    clearInterval(_timer);
    ren(\`
      <div class="inbox-hd">
        <div>
          <h2 class="inbox-title" id="inbox-heading" tabindex="-1">📥 \${esc(_inbox.email)}</h2>
          <div class="inbox-sub">Expires in \${fmtExpiry(_inbox.expires)}</div>
        </div>
        <div class="inbox-actions">
          <div class="refresh-row" aria-hidden="true"><span class="dot"></span><span id="cd">\${_countdown}s</span></div>
          <button class="btn-sm" onclick="App._manualRefresh()" aria-label="Refresh inbox">Refresh</button>
          <button class="btn-danger" onclick="App._deleteInbox()" aria-label="Delete inbox permanently">Delete</button>
        </div>
      </div>
      <div id="msglist">
        <div class="empty"><div class="empty-icon">📭</div><div>Waiting for mail…</div></div>
      </div>
    \`);
    await _fetchMessages();
    requestAnimationFrame(() => { el('inbox-heading')?.focus(); });
    _timer = setInterval(() => {
      _countdown--;
      const c = el('cd'); if (c) c.textContent = _countdown + 's';
      if (_countdown <= 0) { _countdown = REFRESH_SECS; _fetchMessages(); }
    }, 1000);
  }

  async function _fetchMessages() {
    if (!_inbox) return;
    const res = await api('/api/inbox?email=' + encodeURIComponent(_inbox.email) + '&token=' + _inbox.token);
    if (res.error) return;
    _messages = res.messages || [];
    const listEl = el('msglist'); if (!listEl) return;
    if (!_messages.length) {
      listEl.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div>Waiting for mail…<br><small style="font-size:.75rem;opacity:.55">Auto-refreshes every ' + REFRESH_SECS + 's</small></div></div>';
      return;
    }
    listEl.innerHTML = '<div class="msg-list">' + _messages.map((m, i) => \`
      <div class="msg-item\${i === 0 ? ' new' : ''}" onclick="App.openMsg(\${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.openMsg(\${i})}" tabindex="0" role="button" aria-label="\${esc(m.fromName || m.from)}: \${esc(m.subject)}, \${fmtDate(m.date)}">
        <div class="msg-row1" aria-hidden="true">
          <div class="msg-from">\${esc(m.fromName || m.from)}</div>
          <div class="msg-time">\${fmtDate(m.date)}</div>
        </div>
        <div class="msg-subject" aria-hidden="true">\${esc(m.subject)}</div>
        <div class="msg-preview" aria-hidden="true">\${esc((m.text || '').replace(/\\s+/g, ' ').slice(0, 120))}</div>
      </div>\`).join('') + '</div>';
  }

  async function _manualRefresh() {
    _countdown = REFRESH_SECS;
    const c = el('cd'); if (c) c.textContent = _countdown + 's';
    await _fetchMessages();
  }

  async function _deleteInbox() {
    if (!confirm('Delete this inbox and all messages? Cannot be undone.')) return;
    await api('/api/inbox?email=' + encodeURIComponent(_inbox.email) + '&token=' + _inbox.token, { method: 'DELETE' });
    home();
  }

  // ── Message view ──────────────────────────────────────────────────────────

  function openMsg(idx) {
    clearInterval(_timer);
    _activeMsg = _messages[idx];
    _htmlMode  = false;
    _renderMessage();
  }

  function _renderMessage() {
    const m = _activeMsg, hasHtml = !!m.html;
    ren(\`
      <div class="flex gap mb"><button class="btn-sm" onclick="App.loadInbox()">← Inbox</button></div>
      <h2 class="mv-subject" id="msg-subject-hd" tabindex="-1">\${esc(m.subject)}</h2>
      <div class="mv-meta">
        <strong>From:</strong> \${esc(m.fromName ? m.fromName + ' <' + m.from + '>' : m.from)}<br>
        <strong>To:</strong> \${esc(_inbox.email)}<br>
        <strong>Date:</strong> \${new Date(m.date).toLocaleString()}
      </div>
      \${hasHtml ? '<div class="view-toggle" role="group" aria-label="Email view format"><button class="btn-sm' + (!_htmlMode ? ' on' : '') + '" onclick="App._setHtml(false)" aria-pressed="' + (!_htmlMode) + '">Plain text</button><button class="btn-sm' + (_htmlMode ? ' on' : '') + '" onclick="App._setHtml(true)" aria-pressed="' + _htmlMode + '">HTML</button></div>' : ''}
      <div id="msgbody">\${_bodyHTML(m)}</div>
    \`);
    requestAnimationFrame(() => { el('msg-subject-hd')?.focus(); });
  }

  function _bodyHTML(m) {
    if (_htmlMode && m.html) {
      const prev = el('htmlbody-frame');
      if (prev?._blobUrl) URL.revokeObjectURL(prev._blobUrl);
      const u = URL.createObjectURL(new Blob([m.html], { type: 'text/html' }));
      const frame = '<iframe id="htmlbody-frame" class="htmlbody" src="' + u + '" sandbox="allow-same-origin" title="Email HTML content"></iframe>';
      requestAnimationFrame(() => { const f = el('htmlbody-frame'); if (f) f._blobUrl = u; });
      return frame;
    }
    return '<div class="mv-body">' + esc(m.text || '(empty)') + '</div>';
  }

  function _setHtml(mode) {
    _htmlMode = mode;
    const b = el('msgbody'); if (b) b.innerHTML = _bodyHTML(_activeMsg);
    document.querySelectorAll('.view-toggle .btn-sm').forEach((btn, i) => {
      const active = i === 0 ? !mode : mode;
      btn.classList.toggle('on', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function _copy(text, btnId) { copyText(text, btnId); }

  return { home, loadInbox, openMsg, toggleTheme, _onInput, _create, _toggleDisc, _manualRefresh, _deleteInbox, _setHtml, _copy };
})();

App.home();

// Keep theme button in sync when system preference changes (only if user hasn't manually set a preference)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('tm-theme')) App.home(); // re-render syncs the button
});
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers + entry point
// ─────────────────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default {
  // HTTP entry point: serves the SPA on every non-API route, dispatches /api/*
  // to the JSON API, and answers CORS preflight (OPTIONS) requests.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
      }});
    }
    if (url.pathname.startsWith('/api/')) return handleAPI(request, env, url);
    return serveUI(request);
  },

  // Inbound-mail entry point: Cloudflare Email Routing invokes this per message.
  // Errors are caught and turned into a reject so mail bounces visibly rather
  // than vanishing. NOTE: this handler does not fire under `wrangler dev` — test
  // it via a staging deploy on a configured zone.
  async email(message, env, ctx) {
    try {
      await handleEmailEvent(message, env);
    } catch (err) {
      console.error('Email handler error:', err);
      message.setReject('Internal error');
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Test exports — the pure MIME-parsing helpers, exported for unit tests
// (test/parse.test.js). Cloudflare uses only the default export's fetch/email
// handlers; these extra named exports are inert in the Worker runtime and keep
// the file paste-able into the dashboard editor.
// ─────────────────────────────────────────────────────────────────────────────
export { parseEmail, parseHeaders, extractBoundary, extractParts, decodePart, parseAddress, decodeRfc2047 };
