/* ============================================================
   GOLOCODE — engine.js
   เอนจิน "Live" — สั่งงานทีมเอเจนต์จริงผ่าน Claude API (ต้องมี API key)
   ใช้ official Anthropic SDK โหลดจาก CDN แบบ ES module

   The Live engine. Runs the squad against Claude through the official
   Anthropic TypeScript SDK, loaded from a CDN as an ES module.

   Shape of a run:
     phase waves  -> agents are grouped into cells of a few specialists,
                     one request per cell, cells run concurrently
     synthesis    -> NORTHSTAR merges every phase note into the deliverable,
                     streamed so files appear while they are written

   The key lives in this browser only (localStorage) and is sent to
   api.anthropic.com and nowhere else.
   ============================================================ */
(function (root) {
  "use strict";

  var NS = root.GOLOCODE = root.GOLOCODE || {};

  var SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.127.0/+esm";
  var KEY_STORE = "golocode.apiKey";

  /* Prices are USD per million tokens, used only for the on-screen estimate. */
  var MODELS = [
    { id: "claude-opus-5",   label: "Claude Opus 5",  hint: "deepest reasoning — the default",
      inPrice: 5,  outPrice: 25, adaptive: true,  effort: true,  fallbacks: true },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "faster and cheaper per token",
      inPrice: 2,  outPrice: 10, adaptive: true,  effort: true,  fallbacks: false },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "cheapest — big fleets, simple tasks",
      inPrice: 1,  outPrice: 5,  adaptive: false, effort: false, fallbacks: false }
  ];

  /* depth -> effort for the squad cells and for the final synthesis */
  var DEPTHS = {
    fast:     { cell: "low",    final: "medium", label: "Fast" },
    standard: { cell: "medium", final: "high",   label: "Standard" },
    deep:     { cell: "high",   final: "xhigh",  label: "Deep" },
    max:      { cell: "high",   final: "max",    label: "Maximum" }
  };

  function modelInfo(id) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i];
    return MODELS[0];
  }

  /* ---------- key handling (this browser only) ---------- */
  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function setKey(k) {
    try {
      if (k) localStorage.setItem(KEY_STORE, k);
      else localStorage.removeItem(KEY_STORE);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- SDK loading ---------- */
  var sdkPromise = null;

  function loadSDK() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).catch(function (err) {
        sdkPromise = null;
        throw new Error(
          "Could not load the Anthropic SDK from the CDN (" + err.message + "). " +
          "Serve this page over http(s) and allow cdn.jsdelivr.net, or switch to the Local Blueprint engine."
        );
      });
    }
    return sdkPromise;
  }

  /* ---------- request plumbing ---------- */

  /* Adds the params the chosen model actually accepts. Haiku 4.5 rejects
     output_config.effort and does not take adaptive thinking, so it gets
     neither; Opus 5 carries server-side refusal fallbacks. */
  function tune(params, model, effort, opts) {
    var info = modelInfo(model);
    if (info.adaptive) {
      params.thinking = opts && opts.showThinking
        ? { type: "adaptive", display: "summarized" }
        : { type: "adaptive" };
    }
    if (info.effort) params.output_config = { effort: effort };
    if (info.fallbacks) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    return params;
  }

  function stripBeta(params) {
    var copy = {};
    for (var k in params) {
      if (k !== "betas" && k !== "fallbacks" && Object.prototype.hasOwnProperty.call(params, k)) {
        copy[k] = params[k];
      }
    }
    return copy;
  }

  function looksLikeBetaRejection(err) {
    var msg = String((err && err.message) || "");
    return (err && err.status === 400) &&
           /fallback|beta|unexpected|unrecognized|not supported/i.test(msg);
  }

  function textOf(message) {
    return (message.content || [])
      .filter(function (b) { return b.type === "text"; })
      .map(function (b) { return b.text; })
      .join("");
  }

  function checkRefusal(message, who) {
    if (message && message.stop_reason === "refusal") {
      var detail = message.stop_details && message.stop_details.category
        ? " (" + message.stop_details.category + ")" : "";
      throw new Error(who + ": the model declined this request" + detail +
        ". Rephrase the task, or split out the part that triggered it.");
    }
    return message;
  }

  /* a cell request — non-streaming, one call per cell of specialists */
  function askCell(ctx, params) {
    var ns = params.betas ? ctx.client.beta.messages : ctx.client.messages;
    return ns.create(params, { signal: ctx.signal }).catch(function (err) {
      if (looksLikeBetaRejection(err)) {
        ctx.log("warn", "Server-side fallbacks rejected by the API — retrying without them.");
        return ctx.client.messages.create(stripBeta(params), { signal: ctx.signal });
      }
      throw err;
    });
  }

  /* ---------- concurrency pool ---------- */
  function pool(items, limit, worker) {
    var index = 0, active = 0, results = new Array(items.length);
    return new Promise(function (resolve, reject) {
      var failed = false;
      function next() {
        if (failed) return;
        if (index >= items.length && active === 0) return resolve(results);
        while (active < limit && index < items.length) {
          (function (i) {
            active++;
            index++;
            worker(items[i], i).then(function (r) {
              results[i] = r;
              active--;
              next();
            }, function (err) {
              failed = true;
              reject(err);
            });
          })(index);
        }
      }
      next();
    });
  }

  /* ---------- prompts ---------- */

  function cellSystem(wave, members, buildPhase) {
    var lines = [];
    lines.push("You are a cell of " + members.length + " specialist engineers inside GOLOCODE, " +
               "a squad that solves one engineering task together.");
    lines.push("");
    lines.push("Current phase: " + wave.phase.name + " — " + wave.phase.label + ". " + wave.phase.blurb);
    lines.push("");
    lines.push("Specialists in this cell:");
    members.forEach(function (m) {
      lines.push("- " + m.agent.codename + " (" + m.agent.role + "): " + m.agent.directive);
    });
    lines.push("");
    lines.push("Rules:");
    lines.push("- Answer as each specialist in turn, under a heading '### CODENAME'.");
    lines.push("- Every line must be specific to this task: a decision, a file, a command, " +
               "a number, or a risk with the condition that triggers it. No generic advice.");
    lines.push("- At most 5 bullets each. Nothing useful to add for this task? " +
               "Write one line: 'no input — <reason>'.");
    if (buildPhase) {
      lines.push("- You may include one short code block each, holding only the load-bearing logic. " +
                 "The full files are assembled later — do not write them here.");
    } else {
      lines.push("- Do not write implementation files in this phase.");
    }
    lines.push("- Disagreeing with another specialist is useful. Say so plainly and give your reason.");
    return lines.join("\n");
  }

  function cellUser(task, notes) {
    var lines = ["TASK", task, ""];
    if (notes) {
      lines.push("WHAT EARLIER PHASES ESTABLISHED");
      lines.push(notes);
      lines.push("");
    }
    lines.push("Deliver your cell's output now.");
    return lines.join("\n");
  }

  function finalSystem(run, notes) {
    var lines = [];
    lines.push(NS.LEAD.directive);
    lines.push("");
    lines.push("You are closing a GOLOCODE mission run by " + run.size + " specialists " +
               "across " + run.waves.length + " phases. Their notes are in the user message.");
    lines.push("");
    lines.push("Output contract, in this order:");
    lines.push("1. '## Build note' — one short paragraph: what you are building, the two " +
               "decisions that shaped it, and anything the squad disagreed on plus your call.");
    lines.push("2. '## Files' — every file, complete. Each file is a fenced code block whose " +
               "info string is the language then the path, exactly like:");
    lines.push("   ```javascript path=src/app.js");
    lines.push("   No placeholders, no '...rest unchanged', no truncation. If a file is long, " +
               "write it in full anyway.");
    lines.push("3. '## Run' — the exact commands to install, run, and verify.");
    lines.push("4. '## Risks' — what is still weak, each with the condition that would expose it.");
    lines.push("");
    lines.push("Write the code a working engineer would ship: the unhappy paths handled, " +
               "no secrets in client code, and the comments only where the reason is not obvious.");
    if (notes) {
      lines.push("Honour the squad's findings, but you have the final call where they conflict.");
    }
    return lines.join("\n");
  }

  /* Phase notes are carried forward; long ones get trimmed in the middle so
     both the early decisions and the latest ones survive. */
  function trim(text, limit) {
    if (text.length <= limit) return text;
    var half = Math.floor(limit / 2);
    return text.slice(0, half) +
           "\n\n[... " + (text.length - limit) + " characters of notes trimmed ...]\n\n" +
           text.slice(text.length - half);
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  /* ---------- the run ---------- */

  /**
   * run(plan, opts, hooks) -> Promise<result>
   *   plan  — the object returned by GOLOCODE.router.route()
   *   opts  — { key, model, depth, cellSize, concurrency, showThinking }
   *   hooks — { log, phaseStart, agentState, delta, usage }
   */
  function run(plan, opts, hooks) {
    opts  = opts  || {};
    hooks = hooks || {};

    var log    = hooks.log       || function () {};
    var state  = hooks.agentState || function () {};
    var delta  = hooks.delta     || function () {};
    var onUse  = hooks.usage     || function () {};

    var model  = opts.model || MODELS[0].id;
    var depth  = DEPTHS[opts.depth] || DEPTHS.standard;
    var cellSize    = Math.max(1, opts.cellSize || 5);
    var concurrency = Math.max(1, opts.concurrency || 3);

    var controller = new AbortController();
    var usage = { input: 0, output: 0, cacheRead: 0, calls: 0 };

    var result = {
      plan: plan,
      model: model,
      depth: depth.label,
      phaseNotes: [],
      text: "",
      usage: usage,
      cancel: function () { controller.abort(); }
    };

    result.promise = (function () {
      return loadSDK().then(function (mod) {
        var Anthropic = mod.default;
        var client = new Anthropic({
          apiKey: opts.key,
          dangerouslyAllowBrowser: true,   /* key is the user's own, entered in this browser */
          maxRetries: 2
        });

        var ctx = {
          client: client,
          signal: controller.signal,
          log: log
        };

        function account(message) {
          var u = message && message.usage;
          if (!u) return;
          usage.calls++;
          usage.input  += u.input_tokens || 0;
          usage.output += u.output_tokens || 0;
          usage.cacheRead += u.cache_read_input_tokens || 0;
          onUse(usage);
        }

        var carried = "";

        /* --- phase waves --- */
        var chain = Promise.resolve();

        plan.waves.forEach(function (wave) {
          chain = chain.then(function () {
            if (controller.signal.aborted) throw new Error("Run cancelled.");

            var cells = chunk(wave.members, cellSize);
            log("phase", wave.phase.name + " — " + wave.members.length + " agents in " +
                cells.length + " cell" + (cells.length === 1 ? "" : "s"));
            if (hooks.phaseStart) hooks.phaseStart(wave, cells.length);
            wave.members.forEach(function (m) { state(m.agent.id, "running"); });

            return pool(cells, concurrency, function (cell) {
              var params = tune({
                model: model,
                max_tokens: 16000,
                system: [
                  { type: "text", text: "GOLOCODE squad run. The task is fixed for the whole run:\n\n" +
                    plan.task, cache_control: { type: "ephemeral" } },
                  { type: "text", text: cellSystem(wave, cell, wave.phase.id === "build") }
                ],
                messages: [{ role: "user", content: cellUser(plan.task, carried) }]
              }, model, depth.cell, opts);

              return askCell(ctx, params).then(function (message) {
                checkRefusal(message, cell.map(function (m) { return m.agent.codename; }).join("/"));
                account(message);
                cell.forEach(function (m) { state(m.agent.id, "done"); });
                return textOf(message);
              }).catch(function (err) {
                cell.forEach(function (m) { state(m.agent.id, "failed"); });
                throw err;
              });
            }).then(function (texts) {
              var note = texts.join("\n\n");
              result.phaseNotes.push({ phase: wave.phase, text: note });
              carried = trim(
                carried + (carried ? "\n\n" : "") +
                "[" + wave.phase.name + "]\n" + note, 16000);
              log("ok", wave.phase.name + " complete.");
            });
          });
        });

        /* --- synthesis --- */
        return chain.then(function () {
          log("phase", "SYNTHESIS — NORTHSTAR is assembling the deliverable.");
          state(NS.LEAD.id, "running");

          var params = tune({
            model: model,
            max_tokens: 64000,
            system: finalSystem(plan, carried),
            messages: [{
              role: "user",
              content: "TASK\n" + plan.task + "\n\nSQUAD NOTES\n" +
                       (carried || "(no phase notes — deliver the task directly)") +
                       "\n\nDeliver the mission output now, following the output contract."
            }]
          }, model, depth.final, { showThinking: opts.showThinking });

          var ns = params.betas ? client.beta.messages : client.messages;
          var stream;
          try {
            stream = ns.stream(params, { signal: controller.signal });
          } catch (err) {
            if (!looksLikeBetaRejection(err)) throw err;
            stream = client.messages.stream(stripBeta(params), { signal: controller.signal });
          }

          return (async function () {
            try {
              for await (var event of stream) {
                if (event.type === "content_block_delta") {
                  if (event.delta.type === "text_delta") {
                    result.text += event.delta.text;
                    delta("text", event.delta.text);
                  } else if (event.delta.type === "thinking_delta") {
                    delta("thinking", event.delta.thinking);
                  }
                }
              }
            } catch (err) {
              if (looksLikeBetaRejection(err)) {
                ctx.log("warn", "Server-side fallbacks rejected — retrying the synthesis without them.");
                var retry = client.messages.stream(stripBeta(params), { signal: controller.signal });
                for await (var ev2 of retry) {
                  if (ev2.type === "content_block_delta" && ev2.delta.type === "text_delta") {
                    result.text += ev2.delta.text;
                    delta("text", ev2.delta.text);
                  }
                }
                var m2 = await retry.finalMessage();
                checkRefusal(m2, "NORTHSTAR");
                account(m2);
                state(NS.LEAD.id, "done");
                return result;
              }
              throw err;
            }

            var message = await stream.finalMessage();
            checkRefusal(message, "NORTHSTAR");
            account(message);
            if (message.stop_reason === "max_tokens") {
              log("warn", "Output hit the token ceiling — the last file may be cut short. " +
                          "Re-run with a smaller fleet or a narrower task.");
            }
            state(NS.LEAD.id, "done");
            return result;
          })();
        });
      }).catch(function (err) {
        state(NS.LEAD.id, "idle");
        throw describe(err);
      });
    })();

    return result;
  }

  /* Turn an SDK error into something a person can act on. Most specific first. */
  function describe(err) {
    if (!err) return new Error("Unknown error.");
    var status = err.status;
    if (err.name === "APIUserAbortError" || /abort/i.test(err.message || "")) {
      return new Error("Run cancelled.");
    }
    if (status === 401) {
      return new Error("The API key was rejected (401). Check the key, or create a new one at console.anthropic.com.");
    }
    if (status === 403) {
      return new Error("This key is not allowed to call the Messages API (403).");
    }
    if (status === 404) {
      return new Error("Model not found (404) — this account may not have access to the selected model.");
    }
    if (status === 429) {
      return new Error("Rate limited (429). Lower the fleet size or the concurrency, then try again.");
    }
    if (status === 400) {
      return new Error("The API rejected the request (400): " + (err.message || "") );
    }
    if (status >= 500) {
      return new Error("The API had a server error (" + status + "). Retrying usually clears it.");
    }
    if (/Failed to fetch|NetworkError|ENOTFOUND/i.test(err.message || "")) {
      return new Error("Network error reaching api.anthropic.com. Check the connection, " +
                       "and note that opening this page from file:// blocks the request.");
    }
    return err;
  }

  /* ---------- cost estimate ---------- */
  function estimate(usage, model) {
    var m = modelInfo(model);
    var billedIn = Math.max(0, usage.input - usage.cacheRead);
    var usd = (billedIn / 1e6) * m.inPrice +
              (usage.cacheRead / 1e6) * m.inPrice * 0.1 +
              (usage.output / 1e6) * m.outPrice;
    return usd;
  }

  /* ---------- parse the deliverable into files ---------- */
  /* Fenced blocks written as: ```lang path=src/app.js */
  function extractFiles(text) {
    var files = [], re = /```([^\n]*)\n([\s\S]*?)```/g, m;
    while ((m = re.exec(text)) !== null) {
      var info = (m[1] || "").trim();
      var pathMatch = info.match(/path=([^\s]+)/);
      if (!pathMatch) continue;
      files.push({
        path: pathMatch[1].replace(/^["']|["']$/g, ""),
        lang: info.split(/\s+/)[0] || "text",
        code: m[2].replace(/\s+$/, "") + "\n"
      });
    }
    return files;
  }

  NS.engine = {
    MODELS: MODELS,
    DEPTHS: DEPTHS,
    SDK_URL: SDK_URL,
    getKey: getKey,
    setKey: setKey,
    hasKey: function () { return !!getKey(); },
    run: run,
    estimate: estimate,
    extractFiles: extractFiles,
    modelInfo: modelInfo
  };
})(window);
