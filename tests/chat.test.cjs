const test = require('node:test');
const assert = require('node:assert/strict');
const chatModule = import('../api/chat.js');

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    write(chunk) { (this.chunks ||= []).push(Buffer.from(chunk)); return true; },
    end() { this.ended = true; return this; }
  };
}

test('chat forwards a bounded message with clinic emergency instructions and returns Gemini text', async () => {
  const { default: handler } = await chatModule;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    assert.match(url, /models\/gemini-3\.8-flash:streamGenerateContent\?key=test-key&alt=sse$/);
    const payload = JSON.parse(options.body);
    assert.equal(payload.contents[0].parts[0].text, 'Emergency after 6 PM');
    assert.match(payload.systemInstruction.parts[0].text, /You are Jacko/);
    assert.match(payload.systemInstruction.parts[0].text, /Never provide, generate, or suggest prescription drug names/);
    assert.match(payload.systemInstruction.parts[0].text, /difficulty breathing, seizures, collapse, or suspected parvo/);
    assert.match(payload.systemInstruction.parts[0].text, /Cash, GCash, Maya, and major bank transfers/);
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Please call Kauswagan."}]}}]}\n\n');
  };

  try {
    const res = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'https://baldonadovetclinic.vercel.app', 'x-forwarded-for': 'test-client-1' }, body: { message: ' Emergency after 6 PM ' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(Buffer.concat(res.chunks).toString(), 'data: {"candidates":[{"content":{"parts":[{"text":"Please call Kauswagan."}]}}]}\n\n');
    assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://baldonadovetclinic.vercel.app');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('chat rejects empty messages without calling Gemini', async () => {
  const { default: handler } = await chatModule;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => { throw new Error('must not call Gemini'); };
  try {
    const res = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'http://localhost:3000', 'x-forwarded-for': 'test-client-2' }, body: { message: '   ' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.reply, /Please enter a message/);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('chat allows the Vercel production origin by default and rejects unknown origins', async () => {
  const { default: handler } = await chatModule;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = global.fetch;
  delete process.env.GEMINI_API_KEY;
  global.fetch = async () => { throw new Error('must not call Gemini'); };
  try {
    const allowed = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'https://baldonadovetclinic.vercel.app', 'x-forwarded-for': 'test-client-3' }, body: {} }, allowed);
    assert.equal(allowed.statusCode, 503);
    assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://baldonadovetclinic.vercel.app');

    const blocked = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'https://example.com' }, body: {} }, blocked);
    assert.equal(blocked.statusCode, 403);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('chat enforces allowed-origin preflight, POST-only requests, and ten requests per minute', async () => {
  const { default: handler } = await chatModule;
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const preflight = mockResponse();
    await handler({ method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } }, preflight);
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.ended, true);

    const noOrigin = mockResponse();
    await handler({ method: 'POST', headers: {}, body: { message: 'hello' } }, noOrigin);
    assert.equal(noOrigin.statusCode, 403);

    const wrongMethod = mockResponse();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' } }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);

    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      const res = mockResponse();
      await handler({ method: 'POST', headers: { origin: 'http://localhost:3000', 'x-forwarded-for': 'rate-test-client' }, body: {} }, res);
      statuses.push(res.statusCode);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(503));
    assert.equal(statuses[10], 429);
  } finally {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('chat truncates forwarded messages to 300 characters', async () => {
  const { default: handler } = await chatModule;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.contents[0].parts[0].text.length, 300);
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n');
  };
  try {
    const res = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'http://localhost:3000', 'x-forwarded-for': 'length-test-client' }, body: { message: 'x'.repeat(301) } }, res);
    assert.equal(res.statusCode, 200);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('Vercel function config uses the Node.js runtime in Singapore', async () => {
  const { config } = await chatModule;
  assert.deepEqual(config, { runtime: 'nodejs', regions: ['sin1'] });
});

