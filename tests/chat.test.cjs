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
    end() { this.ended = true; return this; }
  };
}

test('chat forwards a bounded message with clinic emergency instructions and returns Gemini text', async () => {
  const { default: handler } = await chatModule;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldOrigin = process.env.CHAT_ALLOWED_ORIGIN;
  const oldFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.CHAT_ALLOWED_ORIGIN = 'https://boks-michael.github.io';
  global.fetch = async (url, options) => {
    assert.match(url, /models\/gemini-3\.8-flash:generateContent\?key=test-key$/);
    const payload = JSON.parse(options.body);
    assert.equal(payload.contents[0].parts[0].text, 'Emergency after 6 PM');
    assert.match(payload.systemInstruction.parts[0].text, /You are Jacko/);
    assert.match(payload.systemInstruction.parts[0].text, /Never provide, generate, or suggest prescription drug names/);
    assert.match(payload.systemInstruction.parts[0].text, /difficulty breathing, seizures, collapse, or suspected parvo/);
    assert.match(payload.systemInstruction.parts[0].text, /Cash, GCash, Maya, and major bank transfers/);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Please call Kauswagan.' }] } }] }) };
  };

  try {
    const res = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'https://boks-michael.github.io' }, body: { message: ' Emergency after 6 PM ' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { reply: 'Please call Kauswagan.' });
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://boks-michael.github.io');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    if (oldOrigin === undefined) delete process.env.CHAT_ALLOWED_ORIGIN; else process.env.CHAT_ALLOWED_ORIGIN = oldOrigin;
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
    await handler({ method: 'POST', headers: {}, body: { message: '   ' } }, res);
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
  const oldOrigin = process.env.CHAT_ALLOWED_ORIGIN;
  const oldFetch = global.fetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.CHAT_ALLOWED_ORIGIN;
  global.fetch = async () => { throw new Error('must not call Gemini'); };
  try {
    const allowed = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'https://baldonadovetclinic.vercel.app' }, body: {} }, allowed);
    assert.equal(allowed.statusCode, 503);
    assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://baldonadovetclinic.vercel.app');

    const blocked = mockResponse();
    await handler({ method: 'POST', headers: { origin: 'https://example.com' }, body: {} }, blocked);
    assert.equal(blocked.statusCode, 403);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    if (oldOrigin === undefined) delete process.env.CHAT_ALLOWED_ORIGIN; else process.env.CHAT_ALLOWED_ORIGIN = oldOrigin;
  }
});

test('Vercel function config uses the Node.js runtime in Singapore', async () => {
  const { config } = await chatModule;
  assert.deepEqual(config, { runtime: 'nodejs', regions: ['sin1'] });
});

