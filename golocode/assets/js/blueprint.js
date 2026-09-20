/* ============================================================
   GOLOCODE — blueprint.js
   เอนจิน "Local Blueprint" — วางแผนภารกิจและสร้างโครงไฟล์เริ่มต้นในเครื่อง
   โดยไม่เรียกโมเดลใดๆ (ไม่ต้องใช้ API key)

   The Local Blueprint engine. Fully deterministic, runs in the browser, and
   calls no model. It turns a routed mission into: a phase plan with a real
   order for every agent, a starter scaffold that actually runs, a risk
   register, and a handoff prompt you can paste into any coding assistant.
   ============================================================ */
(function (root) {
  "use strict";

  var NS = root.GOLOCODE = root.GOLOCODE || {};

  /* ---------- text helpers ---------- */

  /* the directive reads "You are X, a role. <the actual order>" —
     the order is the part worth showing on a mission card. */
  function order(agent) {
    var d = agent.directive;
    var cut = d.indexOf(". ");
    return cut === -1 ? d : d.slice(cut + 2);
  }

  function focusOf(entry) {
    var tags = (entry.matched || []).filter(function (t) {
      return t !== "mission anchor" && t.charAt(0) !== "@";
    });
    return tags.length ? tags.join(", ") : null;
  }

  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------- scaffolds ---------- */
  /* Small, dependency-free starters that run as-is. Chosen by mission
     profile, with a language override when the task named one. */

  function slug(task) {
    var s = String(task || "project").toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "").trim().split(/\s+/).slice(0, 4).join("-");
    return s || "golocode-project";
  }

  function webScaffold(run) {
    var name = slug(run.task);
    var creative = run.profile.id === "creative";
    return [
      { path: "index.html", lang: "html", code:
'<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>' + name + '</title>\n' +
'<link rel="stylesheet" href="styles.css">\n' +
'</head>\n' +
'<body>\n' +
'  <a class="skip-link" href="#main">Skip to content</a>\n' +
'  <header class="top">\n' +
'    <h1>' + name + '</h1>\n' +
'  </header>\n' +
'  <main id="main">\n' +
(creative
? '    <canvas id="stage" aria-label="Interactive canvas" role="img"></canvas>\n'
: '    <section class="panel">\n      <p>Replace this with the first real screen.</p>\n    </section>\n') +
'  </main>\n' +
'  <script src="app.js"></script>\n' +
'</body>\n' +
'</html>\n' },

      { path: "styles.css", lang: "css", code:
':root {\n' +
'  --bg: #0b0d12;\n' +
'  --surface: rgba(255, 255, 255, .05);\n' +
'  --text: #e8ecf5;\n' +
'  --muted: #99a2b8;\n' +
'  --accent: #39e08a;\n' +
'  --radius: 14px;\n' +
'}\n\n' +
'* { box-sizing: border-box; }\n\n' +
'body {\n' +
'  margin: 0;\n' +
'  background: var(--bg);\n' +
'  color: var(--text);\n' +
'  font: 16px/1.7 system-ui, -apple-system, sans-serif;\n' +
'}\n\n' +
'.skip-link { position: absolute; left: -9999px; }\n' +
'.skip-link:focus { left: 8px; top: 8px; background: var(--accent); color: #05070a; padding: .5rem .8rem; }\n\n' +
':focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }\n\n' +
'.top { padding: 1.5rem clamp(1rem, 4vw, 3rem); }\n\n' +
'main { padding: 0 clamp(1rem, 4vw, 3rem) 4rem; }\n\n' +
'.panel {\n' +
'  background: var(--surface);\n' +
'  border: 1px solid rgba(255, 255, 255, .1);\n' +
'  border-radius: var(--radius);\n' +
'  padding: 1.5rem;\n' +
'}\n\n' +
'#stage { width: 100%; height: min(70vh, 620px); display: block; border-radius: var(--radius); }\n\n' +
'@media (prefers-reduced-motion: reduce) {\n' +
'  * { animation: none !important; transition: none !important; }\n' +
'}\n' },

      { path: "app.js", lang: "javascript", code: creative
? '/* Animation loop with a fixed timestep, so behaviour is frame-rate\n' +
  '   independent. Pauses when the tab is hidden and respects reduced motion. */\n' +
  '(function () {\n' +
  '  "use strict";\n\n' +
  '  var canvas = document.getElementById("stage");\n' +
  '  var ctx = canvas.getContext("2d");\n' +
  '  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;\n' +
  '  var STEP = 1 / 120;\n' +
  '  var acc = 0, last = 0, raf = 0, t = 0;\n\n' +
  '  function resize() {\n' +
  '    var dpr = Math.min(devicePixelRatio || 1, 2);\n' +
  '    canvas.width = canvas.clientWidth * dpr;\n' +
  '    canvas.height = canvas.clientHeight * dpr;\n' +
  '    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);\n' +
  '  }\n\n' +
  '  function update(dt) {\n' +
  '    t += dt;              // TODO: advance the simulation here\n' +
  '  }\n\n' +
  '  function draw() {\n' +
  '    var w = canvas.clientWidth, h = canvas.clientHeight;\n' +
  '    ctx.clearRect(0, 0, w, h);\n' +
  '    ctx.fillStyle = "#39e08a";\n' +
  '    ctx.beginPath();\n' +
  '    ctx.arc(w / 2 + Math.cos(t) * w * 0.2, h / 2 + Math.sin(t * 1.3) * h * 0.2, 28, 0, Math.PI * 2);\n' +
  '    ctx.fill();\n' +
  '  }\n\n' +
  '  function frame(now) {\n' +
  '    raf = requestAnimationFrame(frame);\n' +
  '    var dt = Math.min((now - last) / 1000, 0.25);\n' +
  '    last = now;\n' +
  '    acc += dt;\n' +
  '    while (acc >= STEP) { update(STEP); acc -= STEP; }\n' +
  '    draw();\n' +
  '  }\n\n' +
  '  function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }\n' +
  '  function stop() { cancelAnimationFrame(raf); raf = 0; }\n\n' +
  '  addEventListener("resize", resize);\n' +
  '  document.addEventListener("visibilitychange", function () {\n' +
  '    document.hidden ? stop() : start();\n' +
  '  });\n\n' +
  '  resize();\n' +
  '  if (reduced) { draw(); } else { start(); }\n' +
  '})();\n'
: '(function () {\n' +
  '  "use strict";\n\n' +
  '  // TODO: first real behaviour goes here.\n' +
  '  console.log("' + name + ' ready");\n' +
  '})();\n' }
    ];
  }

  function nodeServiceScaffold(run) {
    return [
      { path: "server.js", lang: "javascript", code:
'/* Zero-dependency HTTP service. Swap in a framework once routes justify it. */\n' +
'const http = require("node:http");\n\n' +
'const PORT = process.env.PORT || 3000;\n\n' +
'const routes = {\n' +
'  "GET /health": (req, res) => send(res, 200, { ok: true }),\n' +
'  "GET /api/items": (req, res) => send(res, 200, { items: [] }),\n' +
'};\n\n' +
'function send(res, status, body) {\n' +
'  const payload = JSON.stringify(body);\n' +
'  res.writeHead(status, {\n' +
'    "content-type": "application/json; charset=utf-8",\n' +
'    "content-length": Buffer.byteLength(payload),\n' +
'    "x-content-type-options": "nosniff",\n' +
'  });\n' +
'  res.end(payload);\n' +
'}\n\n' +
'const server = http.createServer((req, res) => {\n' +
'  const url = new URL(req.url, `http://${req.headers.host}`);\n' +
'  const handler = routes[`${req.method} ${url.pathname}`];\n' +
'  if (!handler) return send(res, 404, { error: "not_found" });\n' +
'  try {\n' +
'    handler(req, res);\n' +
'  } catch (err) {\n' +
'    console.error(err);                       // never leak internals to the client\n' +
'    send(res, 500, { error: "internal_error" });\n' +
'  }\n' +
'});\n\n' +
'server.listen(PORT, () => console.log(`listening on :${PORT}`));\n' },

      { path: "test/server.test.js", lang: "javascript", code:
'/* Run with: node --test */\n' +
'const { test } = require("node:test");\n' +
'const assert = require("node:assert");\n\n' +
'test("health responds ok", async () => {\n' +
'  const res = await fetch("http://localhost:3000/health");\n' +
'  assert.equal(res.status, 200);\n' +
'  assert.deepEqual(await res.json(), { ok: true });\n' +
'});\n\n' +
'test("unknown route is 404", async () => {\n' +
'  const res = await fetch("http://localhost:3000/nope");\n' +
'  assert.equal(res.status, 404);\n' +
'});\n' }
    ];
  }

  function pythonServiceScaffold() {
    return [
      { path: "main.py", lang: "python", code:
'"""Minimal FastAPI service.  Run: uvicorn main:app --reload"""\n' +
'from fastapi import FastAPI, HTTPException\n' +
'from pydantic import BaseModel\n\n' +
'app = FastAPI(title="service")\n\n\n' +
'class Item(BaseModel):\n' +
'    id: int\n' +
'    name: str\n\n\n' +
'ITEMS: dict[int, Item] = {}\n\n\n' +
'@app.get("/health")\n' +
'def health() -> dict[str, bool]:\n' +
'    return {"ok": True}\n\n\n' +
'@app.get("/items/{item_id}", response_model=Item)\n' +
'def get_item(item_id: int) -> Item:\n' +
'    item = ITEMS.get(item_id)\n' +
'    if item is None:\n' +
'        raise HTTPException(status_code=404, detail="item not found")\n' +
'    return item\n\n\n' +
'@app.post("/items", response_model=Item, status_code=201)\n' +
'def create_item(item: Item) -> Item:\n' +
'    if item.id in ITEMS:\n' +
'        raise HTTPException(status_code=409, detail="id already exists")\n' +
'    ITEMS[item.id] = item\n' +
'    return item\n' },

      { path: "test_main.py", lang: "python", code:
'from fastapi.testclient import TestClient\n' +
'from main import app\n\n' +
'client = TestClient(app)\n\n\n' +
'def test_health():\n' +
'    assert client.get("/health").json() == {"ok": True}\n\n\n' +
'def test_missing_item_is_404():\n' +
'    assert client.get("/items/999").status_code == 404\n\n\n' +
'def test_create_then_read():\n' +
'    client.post("/items", json={"id": 1, "name": "first"})\n' +
'    assert client.get("/items/1").json()["name"] == "first"\n' }
    ];
  }

  function cliScaffold(run) {
    var python = run.stacks.indexOf("Python") !== -1 || run.stacks.length === 0;
    if (python) {
      return [{ path: "cli.py", lang: "python", code:
'#!/usr/bin/env python3\n' +
'"""Command line entry point.  Scriptable first, pretty second."""\n' +
'import argparse\n' +
'import sys\n\n\n' +
'def build_parser() -> argparse.ArgumentParser:\n' +
'    p = argparse.ArgumentParser(description="TODO: one-line description")\n' +
'    p.add_argument("input", nargs="?", default="-", help="input file, or - for stdin")\n' +
'    p.add_argument("-o", "--output", default="-", help="output file, or - for stdout")\n' +
'    p.add_argument("-v", "--verbose", action="store_true", help="log progress to stderr")\n' +
'    return p\n\n\n' +
'def run(args: argparse.Namespace) -> int:\n' +
'    source = sys.stdin if args.input == "-" else open(args.input, encoding="utf-8")\n' +
'    sink = sys.stdout if args.output == "-" else open(args.output, "w", encoding="utf-8")\n' +
'    try:\n' +
'        for line in source:\n' +
'            sink.write(line)          # TODO: the actual transformation\n' +
'    finally:\n' +
'        if source is not sys.stdin:\n' +
'            source.close()\n' +
'        if sink is not sys.stdout:\n' +
'            sink.close()\n' +
'    return 0\n\n\n' +
'def main() -> int:\n' +
'    args = build_parser().parse_args()\n' +
'    try:\n' +
'        return run(args)\n' +
'    except BrokenPipeError:\n' +
'        return 0                      # downstream closed the pipe: not an error\n' +
'    except KeyboardInterrupt:\n' +
'        return 130\n' +
'    except OSError as err:\n' +
'        print(f"error: {err}", file=sys.stderr)\n' +
'        return 1\n\n\n' +
'if __name__ == "__main__":\n' +
'    raise SystemExit(main())\n' }];
    }
    return [{ path: "cli.js", lang: "javascript", code:
'#!/usr/bin/env node\n' +
'"use strict";\n\n' +
'const args = process.argv.slice(2);\n\n' +
'if (args.includes("--help") || args.includes("-h")) {\n' +
'  console.log("usage: cli [options] <input>\\n\\n  -o, --output  output file (default: stdout)\\n  -h, --help    show this help");\n' +
'  process.exit(0);\n' +
'}\n\n' +
'async function main() {\n' +
'  // TODO: the actual work\n' +
'  process.stdout.write("ok\\n");\n' +
'}\n\n' +
'main().catch((err) => {\n' +
'  console.error(`error: ${err.message}`);\n' +
'  process.exit(1);\n' +
'});\n' }];
  }

  function aiScaffold(run) {
    var python = run.stacks.indexOf("Python") !== -1;
    if (python) {
      return [{ path: "agent.py", lang: "python", code:
'"""Claude-powered task runner.\n\n' +
'Install:  pip install anthropic\n' +
'Auth:     export ANTHROPIC_API_KEY=...   (or run: ant auth login)\n' +
'"""\n' +
'from anthropic import Anthropic\n\n' +
'client = Anthropic()\n\n' +
'SYSTEM = "You are a precise assistant. Answer with the result only."\n\n\n' +
'def ask(question: str) -> str:\n' +
'    with client.messages.stream(\n' +
'        model="claude-opus-5",\n' +
'        max_tokens=64000,\n' +
'        system=SYSTEM,\n' +
'        thinking={"type": "adaptive"},\n' +
'        output_config={"effort": "high"},\n' +
'        messages=[{"role": "user", "content": question}],\n' +
'    ) as stream:\n' +
'        message = stream.get_final_message()\n\n' +
'    if message.stop_reason == "refusal":\n' +
'        raise RuntimeError(f"declined: {message.stop_details}")\n\n' +
'    return "".join(b.text for b in message.content if b.type == "text")\n\n\n' +
'if __name__ == "__main__":\n' +
'    print(ask("Summarise what this project does in two sentences."))\n' }];
    }
    return [{ path: "agent.mjs", lang: "javascript", code:
'/* Claude-powered task runner.\n' +
' * Install: npm i @anthropic-ai/sdk\n' +
' * Auth:    export ANTHROPIC_API_KEY=...   (or run: ant auth login)\n' +
' */\n' +
'import Anthropic from "@anthropic-ai/sdk";\n\n' +
'const client = new Anthropic();\n\n' +
'const SYSTEM = "You are a precise assistant. Answer with the result only.";\n\n' +
'export async function ask(question) {\n' +
'  const stream = client.messages.stream({\n' +
'    model: "claude-opus-5",\n' +
'    max_tokens: 64000,\n' +
'    system: SYSTEM,\n' +
'    thinking: { type: "adaptive" },\n' +
'    output_config: { effort: "high" },\n' +
'    messages: [{ role: "user", content: question }],\n' +
'  });\n\n' +
'  const message = await stream.finalMessage();\n' +
'  if (message.stop_reason === "refusal") {\n' +
'    throw new Error(`declined: ${JSON.stringify(message.stop_details)}`);\n' +
'  }\n\n' +
'  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("");\n' +
'}\n\n' +
'console.log(await ask("Summarise what this project does in two sentences."));\n' }];
  }

  function scaffoldFor(run) {
    switch (run.profile.id) {
      case "creative":
      case "web":      return webScaffold(run);
      case "service":  return run.stacks.indexOf("Python") !== -1
                            ? pythonServiceScaffold() : nodeServiceScaffold(run);
      case "cli":      return cliScaffold(run);
      case "ai":       return aiScaffold(run);
      case "mobile":
      case "systems":
      case "infra":
      case "debug":
      case "perf":
      case "security":
      case "refactor":
      case "explain":  return [];      /* these start from existing code */
      default:         return webScaffold(run);
    }
  }

  /* ---------- the handoff prompt ---------- */
  /* Everything the squad knows, packed into one prompt for any assistant. */
  function missionPrompt(run) {
    var lines = [];
    lines.push("You are GOLOCODE, a coding system that runs a squad of " +
               run.size + " specialist engineers on one task.");
    lines.push("");
    lines.push("TASK");
    lines.push(run.task);
    lines.push("");
    lines.push("MISSION PROFILE: " + run.profile.label +
               (run.stacks.length ? "  |  STACK SIGNALS: " + run.stacks.join(", ") : ""));
    lines.push("");
    lines.push("SQUAD — work through the phases in order. In each phase, apply every");
    lines.push("listed specialist's order to this task, then carry the result forward.");
    run.waves.forEach(function (wave) {
      lines.push("");
      lines.push("[" + wave.phase.name + " — " + wave.phase.label + "] " + wave.phase.blurb);
      wave.members.forEach(function (m) {
        lines.push("  - " + m.agent.codename + " (" + m.agent.role + "): " + order(m.agent));
      });
    });
    lines.push("");
    lines.push("DELIVERABLE");
    lines.push("Return complete, runnable code — every file in full, each in its own");
    lines.push("fenced block with the file path on the fence line. No placeholders, no");
    lines.push("\"rest of the code here\". Follow with a short build note: the decisions");
    lines.push("taken, the risks left open, and how to run and verify it.");
    return lines.join("\n");
  }

  /* ---------- the dossier ---------- */
  function compose(run) {
    var md = [];
    var files = scaffoldFor(run);

    md.push("# GOLOCODE mission dossier");
    md.push("");
    md.push("**Task** — " + run.task);
    md.push("");
    md.push("| | |");
    md.push("|---|---|");
    md.push("| Profile | " + run.profile.glyph + " " + run.profile.label + " |");
    if (run.secondary) md.push("| Secondary read | " + run.secondary.label + " |");
    md.push("| Stack signals | " + (run.stacks.length ? run.stacks.join(", ") : "none named — assuming a fresh start") + " |");
    md.push("| Agents deployed | " + run.size + " of " + NS.AGENTS.length + " |");
    md.push("| Engine | Local Blueprint (deterministic, no model calls) |");
    md.push("| Generated | " + stamp() + " |");
    md.push("");

    md.push("## Phase plan");
    run.waves.forEach(function (wave, i) {
      md.push("");
      md.push("### " + (i + 1) + ". " + wave.phase.name + " — " + wave.phase.label);
      md.push("");
      md.push("_" + wave.phase.blurb + "_");
      md.push("");
      wave.members.forEach(function (m) {
        var f = focusOf(m);
        md.push("- **" + m.agent.codename + "** · " + m.agent.role +
                (f ? " · _focus: " + f + "_" : ""));
        md.push("  " + order(m.agent));
      });
    });

    if (files.length) {
      md.push("");
      md.push("## Starter scaffold");
      md.push("");
      md.push("Files generated below — they run as-is, and each one is a place to");
      md.push("start, not a finished answer.");
      md.push("");
      files.forEach(function (f) { md.push("- `" + f.path + "`"); });
    }

    var verify = [];
    run.waves.forEach(function (w) {
      if (w.phase.id === "verify") verify = w.members;
    });
    if (verify.length) {
      md.push("");
      md.push("## Risk register");
      md.push("");
      verify.forEach(function (m) {
        md.push("- [ ] **" + m.agent.codename + "** — " + m.agent.brief);
      });
    }

    md.push("");
    md.push("## Definition of done");
    md.push("");
    md.push("- [ ] It runs from a clean checkout with one documented command.");
    md.push("- [ ] The unhappy paths are handled, not just the demo path.");
    md.push("- [ ] There is a test — or a written reason there is not one.");
    md.push("- [ ] No secret, key, or token is committed or shipped to the client.");
    md.push("- [ ] A stranger can read the README and run it without asking you.");
    md.push("");
    md.push("---");
    md.push("");
    md.push("Generated by GOLOCODE · Local Blueprint engine · no model was called.");
    md.push("Add an API key to run this squad live against Claude.");

    return {
      markdown: md.join("\n"),
      files: files,
      prompt: missionPrompt(run)
    };
  }

  NS.blueprint = {
    compose: compose,
    missionPrompt: missionPrompt,
    order: order,
    scaffoldFor: scaffoldFor
  };
})(window);
