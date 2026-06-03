// Unit tests for the inline MIME parser in worker.js.
//
// These cover the pure, deterministic parsing helpers — the riskiest code in
// the Worker and the only part that can be exercised without Cloudflare. They
// use Node's built-in test runner and assert module (zero dependencies):
//
//   npm test        # node --test
//
// The fetch/email handlers and KV/Email-Routing behaviour are NOT covered here
// — those require a deployed Worker (see CONTRIBUTING.md → "What you can and
// can't test locally").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEmail,
  parseHeaders,
  extractBoundary,
  decodePart,
  parseAddress,
  decodeRfc2047,
} from '../worker.js';

const enc = (s) => new TextEncoder().encode(s).buffer;

test('parseHeaders lowercases keys, keeps first value, and unfolds wrapped lines', () => {
  const h = parseHeaders('Subject: Hello\r\nX-Long: part one\r\n  part two\r\nSubject: ignored');
  assert.equal(h['subject'], 'Hello');        // first wins
  assert.equal(h['x-long'], 'part one  part two'); // folded continuation joined (leading WS preserved)
});

test('parseAddress splits a display-name + angle-addr', () => {
  assert.deepEqual(parseAddress('"Jane Doe" <jane@example.com>'), {
    name: 'Jane Doe',
    address: 'jane@example.com',
  });
  assert.deepEqual(parseAddress('bare@example.com'), { name: '', address: 'bare@example.com' });
});

test('extractBoundary reads quoted and unquoted boundary params', () => {
  assert.equal(extractBoundary('multipart/alternative; boundary="abc123"'), 'abc123');
  assert.equal(extractBoundary('multipart/mixed; boundary=xyz; charset=utf-8'), 'xyz');
  assert.equal(extractBoundary('text/plain'), null);
});

test('decodePart decodes base64 with the declared charset', () => {
  const body = Buffer.from('héllo wörld', 'utf8').toString('base64');
  assert.equal(decodePart(body, 'base64', 'text/plain; charset=utf-8'), 'héllo wörld');
});

test('decodePart decodes quoted-printable hex escapes and drops soft line breaks', () => {
  // NOTE: the QP path is byte-wise, not charset-aware (unlike the base64 path),
  // so multi-byte UTF-8 escapes are NOT reassembled into characters. This test
  // pins that documented limitation using ASCII-safe input.
  assert.equal(decodePart('Hello=20world =\r\nagain', 'quoted-printable'), 'Hello world again');
});

test('decodeRfc2047 decodes B- and Q-encoded words', () => {
  const b = '=?utf-8?B?' + Buffer.from('Schön', 'utf8').toString('base64') + '?=';
  assert.equal(decodeRfc2047(b), 'Schön');
  assert.equal(decodeRfc2047('=?utf-8?Q?a_b=3Dc?='), 'a b=c'); // _ → space, =3D → '='
});

test('parseEmail reads a simple plain-text message', () => {
  const raw =
    'From: "Bob" <bob@example.com>\r\n' +
    'Subject: Test subject\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    '\r\n' +
    'This is the body.';
  const m = parseEmail(enc(raw));
  assert.equal(m.subject, 'Test subject');
  assert.equal(m.from, 'bob@example.com');
  assert.equal(m.fromName, 'Bob');
  assert.equal(m.text.trim(), 'This is the body.');
  assert.equal(m.html, '');
});

test('parseEmail extracts both parts from a multipart/alternative message', () => {
  const raw =
    'From: a@b.com\r\n' +
    'Subject: =?utf-8?Q?Hi_=F0=9F=91=8B?=\r\n' +
    'Content-Type: multipart/alternative; boundary="B"\r\n' +
    '\r\n' +
    '--B\r\n' +
    'Content-Type: text/plain\r\n' +
    '\r\n' +
    'plain version\r\n' +
    '--B\r\n' +
    'Content-Type: text/html\r\n' +
    '\r\n' +
    '<p>html version</p>\r\n' +
    '--B--\r\n';
  const m = parseEmail(enc(raw));
  assert.equal(m.subject, 'Hi 👋');             // RFC 2047 subject decoded
  assert.match(m.text, /plain version/);
  assert.match(m.html, /<p>html version<\/p>/);
});

test('parseEmail never throws on garbage input', () => {
  assert.doesNotThrow(() => parseEmail(enc('not really an email at all')));
});
