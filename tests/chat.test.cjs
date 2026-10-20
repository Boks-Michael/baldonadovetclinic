const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/chat.js');

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
  const oldKey = process.env.GEMINI_API_KEY;
  const oldOrigin = process.env.CHAT_ALLOWED_ORIGIN;
  const oldFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.CHAT_ALLOWED_ORIGIN = 'https://boks-michael.github.io';
  global.fetch = async (url, options) => {
    assert.match(url, /models\/gemini-3\.8-flash:generateContent\?key=test-key$/);
    const payload = JSON.parse(options.body);
    assert.equal(payload.contents[0].parts[0].text, 'Emergency after 6 PM');
    assert.match(payload.systemInstruction.parts[0].text, /immediately tell them to call or proceed to the Kauswagan 24-hour branch/);
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

