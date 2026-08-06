// Regression test for a structural bug that blocked EVERY self-hosted Ollama
// summarization call, silently and permanently — not a transient config
// issue, a gateway-level gap with zero Ollama awareness.
//
// server/worldmonitor/news/v1/summarize-article.ts's own handler correctly
// exempts provider==='ollama' from requiring Pro (`requiresPremium = mode
// !== 'translate' && provider !== 'ollama'`), because Ollama spends the
// operator's own local hardware, never WorldMonitor's paid Groq/OpenRouter
// credits. But server/gateway.ts's shouldReserveGatewayDirectLlmQuota() runs
// BEFORE that handler and had no such exemption — it required a Clerk
// sessionUserId for ANY non-translate summarize-article call regardless of
// provider. A self-hosted install's local-auth session (this fork's
// Clerk-free sign-in path) can never produce a Clerk sessionUserId, so every
// Ollama call 401'd "Pro authentication required" even with a fully working,
// correctly configured Ollama server — with nothing in the error mentioning
// Ollama at all.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldReserveGatewayDirectLlmQuota } from '../server/gateway.ts';

const SUMMARIZE_URL = 'https://worldmonitor.app/api/news/v1/summarize-article';

function summarizeRequest(body: Record<string, unknown>): Request {
  const json = JSON.stringify(body);
  return new Request(SUMMARIZE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(json.length) },
    body: json,
  });
}

describe('shouldReserveGatewayDirectLlmQuota — Ollama exemption', () => {
  it('does NOT reserve quota for provider: ollama', async () => {
    const req = summarizeRequest({ mode: 'brief', provider: 'ollama', headlines: ['a'] });
    assert.equal(
      await shouldReserveGatewayDirectLlmQuota(req, '/api/news/v1/summarize-article'),
      false,
    );
  });

  it('still reserves quota for provider: groq (spend-bearing, must stay gated)', async () => {
    const req = summarizeRequest({ mode: 'brief', provider: 'groq', headlines: ['a'] });
    assert.equal(
      await shouldReserveGatewayDirectLlmQuota(req, '/api/news/v1/summarize-article'),
      true,
    );
  });

  it('still reserves quota for provider: openrouter (spend-bearing, must stay gated)', async () => {
    const req = summarizeRequest({ mode: 'brief', provider: 'openrouter', headlines: ['a'] });
    assert.equal(
      await shouldReserveGatewayDirectLlmQuota(req, '/api/news/v1/summarize-article'),
      true,
    );
  });

  it('stays free for mode: translate regardless of provider (pre-existing behavior, must not regress)', async () => {
    const req = summarizeRequest({ mode: 'translate', provider: 'groq', headlines: ['a'] });
    assert.equal(
      await shouldReserveGatewayDirectLlmQuota(req, '/api/news/v1/summarize-article'),
      false,
    );
  });

  it('is false for a non-summarize path', async () => {
    const req = summarizeRequest({ mode: 'brief', provider: 'ollama', headlines: ['a'] });
    assert.equal(
      await shouldReserveGatewayDirectLlmQuota(req, '/api/news/v1/some-other-rpc'),
      false,
    );
  });

  it('is false for a GET request to the summarize path (wrong method)', async () => {
    const req = new Request(SUMMARIZE_URL, { method: 'GET' });
    assert.equal(
      await shouldReserveGatewayDirectLlmQuota(req, '/api/news/v1/summarize-article'),
      false,
    );
  });

  it('treats malformed JSON as quota-exempt rather than throwing', async () => {
    const req = new Request(SUMMARIZE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assert.equal(
      await shouldReserveGatewayDirectLlmQuota(req, '/api/news/v1/summarize-article'),
      false,
    );
  });
});
