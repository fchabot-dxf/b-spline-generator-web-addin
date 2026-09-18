// One body-size policy for every write route in this worker (CW1 / audit A7-1).
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Read a request body under the cap. Returns { body } or { error: Response }. */
export async function readBoundedBody(request, max = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) return { error: tooLarge(max) };
  const body = await request.text();
  if (body.length === 0)  return { error: json({ error: 'empty body' }, 400) };
  if (body.length > max)  return { error: tooLarge(max) };
  return { body };
}
function tooLarge(max) { return json({ error: 'body too large', maxBytes: max }, 413); }
function json(obj, status) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
