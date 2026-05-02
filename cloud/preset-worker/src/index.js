// B-Spline preset Worker — public KV-backed preset store.
//
// API:
//   GET    /presets              -> { names: ["a", "b", ...] }
//   GET    /presets/:name        -> snapshot JSON | 404
//   PUT    /presets/:name        -> body: snapshot JSON | 200 { ok: true }
//   DELETE /presets/:name        -> 200 { ok: true }
//
// No authentication. Single-user public deploy. CORS open so the palette
// can call from a Fusion file:// origin or any web origin.
//
// Body size cap: 10 MB (KV's per-value limit is 25 MB, but our presets
// should never come close to 10 MB even with masks; rejecting larger
// requests catches client-side bugs before they fill the namespace).

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET /presets — list
    if (path === "/presets" && method === "GET") {
      try {
        const list = await env.PRESETS.list();
        return json({ names: list.keys.map((k) => k.name) });
      } catch (e) {
        return json({ error: "list failed", detail: String(e) }, 500);
      }
    }

    // /presets/:name — get / put / delete
    const m = path.match(/^\/presets\/([^/]+)$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (!name) return json({ error: "name required" }, 400);
      if (name.length > 200) return json({ error: "name too long" }, 400);

      if (method === "GET") {
        const value = await env.PRESETS.get(name);
        if (value === null) return json({ error: "not found" }, 404);
        return new Response(value, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        });
      }

      if (method === "PUT") {
        const body = await request.text();
        if (body.length === 0) return json({ error: "empty body" }, 400);
        if (body.length > MAX_BODY_BYTES) {
          return json({ error: "body too large", maxBytes: MAX_BODY_BYTES }, 413);
        }
        try {
          JSON.parse(body); // validate
        } catch {
          return json({ error: "invalid JSON" }, 400);
        }
        await env.PRESETS.put(name, body);
        return json({ ok: true, name });
      }

      if (method === "DELETE") {
        await env.PRESETS.delete(name);
        return json({ ok: true, name });
      }

      return json({ error: "method not allowed" }, 405);
    }

    // Health check / index
    if (path === "/" && method === "GET") {
      return json({
        service: "bspline-presets",
        endpoints: {
          list: "GET /presets",
          load: "GET /presets/:name",
          save: "PUT /presets/:name",
          remove: "DELETE /presets/:name",
        },
      });
    }

    return json({ error: "not found", path }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
