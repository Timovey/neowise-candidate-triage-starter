import { MANUAL_REVIEW, MAX_BODY_BYTES, TOPICS } from "./constants.mjs";
import { InvalidInput } from "./errors.mjs";

export function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function readText(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new InvalidInput("body too large");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidInput("bad json");
  }
  const text = body && typeof body === "object" ? body.text : undefined;
  if (typeof text !== "string" || text.trim() === "") throw new InvalidInput("bad text");
  return text;
}

// Возвращает { topic, draft } или null, если ответ модели не подходит.
export function parseModelOutput(raw) {
  if (typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { topic, draft } = data;
  if (typeof topic !== "string" || !TOPICS.has(topic)) return null;
  if (typeof draft !== "string" || draft.trim() === "") return null;
  return { topic, draft: draft.trim() };
}

// Любой сбой модели (таймаут, исключение, мусор в ответе) -> null.
export async function askModel(classify, text, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const call = Promise.resolve(classify(text, { signal: controller.signal })).then(
      parseModelOutput,
      () => null,
    );
    return await Promise.race([call, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleTriage(request, response, { classify, timeoutMs }) {
  let text;
  try {
    text = await readText(request);
  } catch (error) {
    if (error instanceof InvalidInput) return json(response, 400, { status: "invalid_input" });
    throw error;
  }
  const result = await askModel(classify, text, timeoutMs);
  if (!result) return json(response, 200, MANUAL_REVIEW);
  return json(response, 200, { status: "ready", ...result });
}
