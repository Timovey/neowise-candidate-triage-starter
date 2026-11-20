import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

const MANUAL = { status: "manual_review", topic: null, draft: null };
let server, base;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function post(body, { raw = false } = {}) {
  const reply = await fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: reply.status, body: await reply.json() };
}

test("успех: ready с темой и черновиком", async () => {
  const r = await post({ text: "Какая стоимость доставки?" });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ready");
  assert.equal(r.body.topic, "pricing");
  assert.ok(r.body.draft.length > 0);
});

test("некорректный ввод -> 400 invalid_input", async () => {
  const cases = [
    [{}],
    [{ text: "" }],
    [{ text: "   " }],
    [{ text: 42 }],
    [{ text: null }],
    ["[1]", { raw: true }],
    ["{broken", { raw: true }],
    ["", { raw: true }],
    ["null", { raw: true }],
  ];
  for (const [body, options] of cases) {
    const r = await post(body, options);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.body, { status: "invalid_input" });
  }
});

test("сбои имитатора -> manual_review", async () => {
  for (const tag of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    const r = await post({ text: `Вопрос про доставку ${tag}` });
    assert.equal(r.status, 200, tag);
    assert.deepEqual(r.body, MANUAL, tag);
  }
});

test("таймаут модели 300 мс -> manual_review быстро", async () => {
  const started = Date.now();
  const r = await post({ text: "Вопрос [timeout]" });
  const elapsed = Date.now() - started;
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, MANUAL);
  assert.ok(elapsed < 1000, `ответ занял ${elapsed} мс`);
});

test("модель, игнорирующая abort, всё равно ограничена таймаутом", async () => {
  const slow = createApp({ classify: () => new Promise(() => {}), timeoutMs: 50 });
  await new Promise((resolve) => slow.listen(0, "127.0.0.1", resolve));
  try {
    const reply = await fetch(`http://127.0.0.1:${slow.address().port}/api/triage`, {
      method: "POST",
      body: JSON.stringify({ text: "привет" }),
    });
    assert.deepEqual(await reply.json(), MANUAL);
  } finally {
    slow.close();
  }
});
