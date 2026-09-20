/* ============================================================
   GOLOCODE — app.js
   เชื่อม UI เข้ากับ router / blueprint / engine
   Wires the interface to the router, the local blueprint, and the live engine.

   All model and user text reaches the DOM through textContent, never innerHTML.
   ============================================================ */
(function (root) {
  "use strict";

  var NS = root.GOLOCODE;
  if (!NS || !NS.AGENTS) return;

  var PREFS = "golocode.prefs";

  /* ---------- tiny helpers ---------- */
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function clock() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function commas(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copy(text, button) {
    var done = function () {
      if (!button) return;
      var was = button.textContent;
      button.textContent = "copied ✓";
      setTimeout(function () { button.textContent = was; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    var ta = el("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* clipboard blocked */ }
    document.body.removeChild(ta);
  }

  var reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- state ---------- */
  var state = {
    size: 12,
    engine: "local",
    model: NS.engine.MODELS[0].id,
    depth: "standard",
    plan: null,
    running: null,
    brief: "",
    prompt: "",
    files: []
  };

  try {
    var saved = JSON.parse(localStorage.getItem(PREFS) || "{}");
    ["size", "engine", "model", "depth"].forEach(function (k) {
      if (saved[k] != null) state[k] = saved[k];
    });
  } catch (e) { /* first visit, or storage blocked */ }

  function persist() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({
        size: state.size, engine: state.engine, model: state.model, depth: state.depth
      }));
    } catch (e) { /* private mode — preferences just will not stick */ }
  }

  /* ---------- log ---------- */
  var logList = $("log");

  function log(kind, message) {
    var li = el("li", null, message);
    li.setAttribute("data-kind", kind);
    li.setAttribute("data-t", clock());
    logList.appendChild(li);
    logList.scrollTop = logList.scrollHeight;
  }

  function resetLog() { clear(logList); }

  /* ---------- squad rendering ---------- */
  var cards = {};   /* agent id -> card element */

  function renderProfile(plan) {
    var strip = $("profileStrip");
    clear(strip);

    function pill(text, cls) {
      var p = el("span", "pill" + (cls ? " " + cls : ""), text);
      strip.appendChild(p);
      return p;
    }

    pill(plan.profile.glyph + " " + plan.profile.label);
    if (plan.stacks.length) pill("stack: " + plan.stacks.join(" · "));
    pill(plan.size + " / " + NS.AGENTS.length + " agents");
    if (plan.secondary) pill("also reads as: " + plan.secondary.label);
  }

  function renderWaves(plan) {
    var host = $("waves");
    clear(host);
    cards = {};

    plan.waves.forEach(function (wave) {
      var box = el("div", "wave");

      var head = el("div", "wave__head");
      head.appendChild(el("span", "wave__glyph", wave.phase.glyph));
      head.appendChild(el("span", "wave__name", wave.phase.name));
      head.appendChild(el("span", "wave__label", wave.phase.blurb));
      head.appendChild(el("span", "wave__count",
        wave.members.length + (wave.members.length === 1 ? " agent" : " agents")));
      box.appendChild(head);

      var grid = el("div", "agents");
      wave.members.forEach(function (m) {
        var card = el("div", "agent");
        card.setAttribute("data-state", "idle");
        card.title = NS.blueprint.order(m.agent);

        var top = el("div", "agent__top");
        top.appendChild(el("span", "agent__glyph", m.agent.glyph));
        top.appendChild(el("span", "agent__name", m.agent.codename));
        top.appendChild(el("span", "agent__code", m.agent.code));
        card.appendChild(top);

        card.appendChild(el("div", "agent__role", m.agent.role));

        var focus = (m.matched || []).filter(function (t) { return t !== "mission anchor"; });
        card.appendChild(el("div", "agent__focus",
          focus.length ? "▸ " + focus.join(", ") : "▸ " + m.agent.divisionName.toLowerCase()));

        grid.appendChild(card);
        cards[m.agent.id] = card;
      });

      box.appendChild(grid);
      host.appendChild(box);
    });
  }

  function setAgentState(agentId, value) {
    var card = cards[agentId];
    if (card) card.setAttribute("data-state", value);
  }

  function setAllStates(value) {
    Object.keys(cards).forEach(function (id) { cards[id].setAttribute("data-state", value); });
  }

  /* ---------- fleet overview (shown until a task is typed) ---------- */
  function renderFleet() {
    var host = $("fleetGrid");
    clear(host);

    NS.DIVISIONS.forEach(function (div) {
      var members = NS.AGENTS.filter(function (a) { return a.division === div.id; });

      var tile = el("button", "divTile");
      tile.type = "button";
      tile.setAttribute("aria-label", "Open the roster filtered to " + div.name);

      var top = el("div", "divTile__top");
      top.appendChild(el("span", "divTile__glyph", div.glyph));
      top.appendChild(el("span", "divTile__name", div.name));
      top.appendChild(el("span", "divTile__n", members.length));
      tile.appendChild(top);

      tile.appendChild(el("p", "divTile__blurb", div.blurb));
      tile.appendChild(el("div", "divTile__names", members.map(function (a) {
        return a.codename;
      }).join(" · ")));

      tile.addEventListener("click", function () {
        rosterFilter = div.id;
        renderRosterFilters();
        renderRoster();
        openRoster();
      });

      host.appendChild(tile);
    });
  }

  /* ---------- routing preview ---------- */
  var previewTimer = null;

  function taskText() { return $("task").value.trim(); }

  function preview() {
    var task = taskText();
    var readout = $("readout");

    if (!task) {
      readout.hidden = true;
      $("fleetOverview").hidden = false;
      state.plan = null;
      $("launchNote").textContent = "Routing preview updates as you type.";
      return;
    }

    var plan = NS.router.route(task, state.size);
    state.plan = plan;
    readout.hidden = false;
    $("fleetOverview").hidden = true;
    renderProfile(plan);
    renderWaves(plan);
    updateNote(plan);
  }

  function updateNote(plan) {
    var note = $("launchNote");
    clear(note);

    if (state.engine === "local") {
      note.appendChild(el("b", null, plan.size + " agents"));
      note.appendChild(document.createTextNode(
        " · " + plan.waves.length + " phases · local blueprint, no tokens billed"));
      return;
    }

    var cells = 0;
    plan.waves.forEach(function (w) { cells += Math.ceil(w.members.length / 5); });
    note.appendChild(el("b", null, plan.size + " agents"));
    note.appendChild(document.createTextNode(
      " · " + cells + " squad calls + 1 synthesis · model: " +
      NS.engine.modelInfo(state.model).label));
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 200);
  }

  /* ---------- output panels ---------- */
  function showOutput() { $("output").hidden = false; }

  function setBrief(text) {
    state.brief = text;
    $("briefDoc").textContent = text;
  }

  function appendBrief(text) {
    state.brief += text;
    var doc = $("briefDoc");
    doc.textContent = state.brief;
    doc.scrollTop = doc.scrollHeight;
  }

  function setPrompt(text) {
    state.prompt = text;
    $("promptDoc").textContent = text;
  }

  function setFiles(files) {
    state.files = files || [];
    $("fileCount").textContent = state.files.length;

    var host = $("files");
    clear(host);

    if (!state.files.length) {
      host.appendChild(el("p", "panel__note",
        "No files in this deliverable yet. The local blueprint only scaffolds project " +
        "types it can start from scratch; live runs write every file the task needs."));
      return;
    }

    state.files.forEach(function (f) {
      var box = el("div", "file");

      var head = el("div", "file__head");
      head.appendChild(el("span", "file__path", f.path));
      head.appendChild(el("span", "file__lang", f.lang || "text"));

      var acts = el("div", "file__acts");
      var copyBtn = el("button", "btn btn--mini", "copy");
      copyBtn.type = "button";
      copyBtn.addEventListener("click", function () { copy(f.code, copyBtn); });
      var dlBtn = el("button", "btn btn--mini", "download");
      dlBtn.type = "button";
      dlBtn.addEventListener("click", function () {
        download(f.path.split("/").pop(), f.code);
      });
      acts.appendChild(copyBtn);
      acts.appendChild(dlBtn);
      head.appendChild(acts);

      box.appendChild(head);

      var pre = el("pre");
      pre.appendChild(el("code", null, f.code));
      box.appendChild(pre);

      host.appendChild(box);
    });
  }

  function bundle() {
    var out = ["# GOLOCODE deliverable", "", state.brief, ""];
    if (state.files.length) {
      out.push("---", "", "## Files", "");
      state.files.forEach(function (f) {
        out.push("### " + f.path, "", "```" + (f.lang || ""), f.code.replace(/\s+$/, ""), "```", "");
      });
    }
    return out.join("\n");
  }

  /* ---------- the local run ---------- */
  function runLocal(plan) {
    resetLog();
    showOutput();
    log("phase", "GOLOCODE online — " + plan.size + " agents assigned to this mission.");
    log("", "Profile: " + plan.profile.label +
             (plan.stacks.length ? " · stack signals: " + plan.stacks.join(", ") : ""));
    log("", "Engine: Local Blueprint — deterministic, runs in this browser, calls no model.");

    var composed = NS.blueprint.compose(plan);
    setBrief(composed.markdown);
    setPrompt(composed.prompt);
    setFiles(composed.files);
    $("meter").textContent = "local blueprint · no tokens billed";

    /* walk the dispatch through the phases so the squad reads as a sequence */
    setAllStates("queued");
    var step = reducedMotion ? 0 : 320;

    plan.waves.forEach(function (wave, i) {
      setTimeout(function () {
        wave.members.forEach(function (m) { setAgentState(m.agent.id, "running"); });
        log("phase", wave.phase.name + " — " + wave.members.length +
                     (wave.members.length === 1 ? " agent" : " agents") + " reporting.");
        setTimeout(function () {
          wave.members.forEach(function (m) { setAgentState(m.agent.id, "done"); });
          if (i === plan.waves.length - 1) {
            log("ok", "Blueprint complete: phase plan, " + composed.files.length +
                      " scaffold file" + (composed.files.length === 1 ? "" : "s") +
                      ", risk register, handoff prompt.");
            log("", "For code written for this exact task, switch the engine to Live, " +
                    "or copy the handoff prompt into any assistant.");
          }
        }, step * 0.55);
      }, step * i);
    });

    selectTab("brief");
  }

  /* ---------- the live run ---------- */
  function runLive(plan) {
    var key = NS.engine.getKey();
    if (!key) {
      openKeyModal();
      log("warn", "Live engine needs an Anthropic API key. Add one, then launch again.");
      return;
    }

    resetLog();
    showOutput();
    setBrief("");
    setFiles([]);
    setPrompt(NS.blueprint.missionPrompt(plan));
    selectTab("brief");

    log("phase", "GOLOCODE online — " + plan.size + " agents assigned to this mission.");
    log("", "Profile: " + plan.profile.label + " · model: " +
             NS.engine.modelInfo(state.model).label + " · depth: " + state.depth);
    log("", "Loading the Anthropic SDK…");

    setAllStates("queued");
    setBusy(true);

    var handle = NS.engine.run(plan, {
      key: key,
      model: state.model,
      depth: state.depth,
      cellSize: 5,
      concurrency: plan.size > 40 ? 4 : 3,
      showThinking: false
    }, {
      log: function (kind, message) { log(kind || "", message); },
      agentState: setAgentState,
      delta: function (type, text) { if (type === "text") appendBrief(text); },
      usage: function (u) {
        var usd = NS.engine.estimate(u, state.model);
        $("meter").textContent =
          "in " + commas(u.input) + " · out " + commas(u.output) +
          " · " + u.calls + " calls · ≈$" + usd.toFixed(3);
      }
    });

    state.running = handle;

    handle.promise.then(function (result) {
      var files = NS.engine.extractFiles(result.text);
      setFiles(files);
      log("ok", "Mission complete — " + files.length + " file" +
                (files.length === 1 ? "" : "s") + " delivered.");
      if (!files.length) {
        log("warn", "No path-tagged code blocks came back, so the Files tab is empty. " +
                    "The full response is in the Briefing tab.");
      }
      setBusy(false);
      state.running = null;
    }, function (err) {
      log("error", err && err.message ? err.message : String(err));
      setAllStates("idle");
      setBusy(false);
      state.running = null;
    });
  }

  function setBusy(busy) {
    $("launchBtn").disabled = busy;
    $("cancelBtn").hidden = !busy;
    $("task").readOnly = busy;
  }

  /* ---------- launch ---------- */
  function launch() {
    var task = taskText();
    if (!task) {
      $("task").focus();
      $("readout").hidden = false;
      log("warn", "Type a task first — anything from one line to a whole file.");
      return;
    }

    preview();
    var plan = state.plan;
    if (!plan) return;

    if (state.engine === "live") runLive(plan);
    else runLocal(plan);

    $("readout").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  /* ---------- tabs ---------- */
  var TABS = ["brief", "files", "prompt"];

  function selectTab(name) {
    TABS.forEach(function (t) {
      var tab = $("tab-" + t), panel = $("panel-" + t);
      var on = t === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
  }

  TABS.forEach(function (t, i) {
    var tab = $("tab-" + t);
    tab.addEventListener("click", function () { selectTab(t); });
    tab.addEventListener("keydown", function (e) {
      var dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      var next = TABS[(i + dir + TABS.length) % TABS.length];
      selectTab(next);
      $("tab-" + next).focus();
    });
  });

  /* ---------- roster drawer ---------- */
  var rosterFilter = "all";
  var lastFocus = null;

  function renderRoster() {
    var host = $("rosterList");
    var query = $("rosterSearch").value.trim().toLowerCase();
    clear(host);

    var shown = NS.AGENTS.filter(function (a) {
      if (rosterFilter !== "all" && a.division !== rosterFilter) return false;
      if (!query) return true;
      return (a.codename + " " + a.role + " " + a.brief + " " + a.tags.join(" ") +
              " " + a.divisionName).toLowerCase().indexOf(query) !== -1;
    });

    $("rosterCount").textContent = shown.length;

    if (!shown.length) {
      host.appendChild(el("p", "panel__note", "No agent matches that. Try a skill, a language, or a role."));
      return;
    }

    shown.forEach(function (a) {
      var item = el("div", "rosterItem");
      var top = el("div", "rosterItem__top");
      top.appendChild(el("span", null, a.glyph));
      top.appendChild(el("span", "rosterItem__name", a.codename));
      top.appendChild(el("span", "rosterItem__code", a.code));
      item.appendChild(top);
      item.appendChild(el("div", "rosterItem__role", a.role + " · " + a.divisionName));
      item.appendChild(el("div", "rosterItem__brief", a.brief));
      item.appendChild(el("div", "rosterItem__phase", NS.phase(a.phase).name));
      host.appendChild(item);
    });
  }

  function renderRosterFilters() {
    var host = $("rosterDivs");
    clear(host);

    function chipFor(id, label) {
      var b = el("button", null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", rosterFilter === id ? "true" : "false");
      b.addEventListener("click", function () {
        rosterFilter = id;
        renderRosterFilters();
        renderRoster();
      });
      host.appendChild(b);
    }

    chipFor("all", "all 100");
    NS.DIVISIONS.forEach(function (d) { chipFor(d.id, d.glyph + " " + d.name); });
  }

  function openRoster() {
    lastFocus = document.activeElement;
    $("roster").hidden = false;
    $("scrim").hidden = false;
    $("rosterBtn").setAttribute("aria-expanded", "true");
    $("rosterSearch").focus();
  }

  function closeRoster() {
    $("roster").hidden = true;
    $("scrim").hidden = true;
    $("rosterBtn").setAttribute("aria-expanded", "false");
    if (lastFocus) lastFocus.focus();
  }

  /* ---------- key modal ---------- */
  function openKeyModal() {
    lastFocus = document.activeElement;
    $("keyModal").hidden = false;
    $("keyInput").value = NS.engine.getKey();
    $("keyInput").focus();
  }

  function closeKeyModal() {
    $("keyModal").hidden = true;
    $("keyInput").value = "";
    if (lastFocus) lastFocus.focus();
  }

  /* ---------- engine controls ---------- */
  function syncEngineUI() {
    var live = state.engine === "live";
    Array.prototype.forEach.call(document.querySelectorAll(".control--live"), function (n) {
      n.hidden = !live;
    });
    $("enginePill").textContent = live
      ? "engine: live · " + NS.engine.modelInfo(state.model).label
      : "engine: local blueprint";
    if (state.plan) updateNote(state.plan);
  }

  function buildModelOptions() {
    var sel = $("model");
    clear(sel);
    NS.engine.MODELS.forEach(function (m) {
      var opt = el("option", null, m.label + " — " + m.hint);
      opt.value = m.id;
      sel.appendChild(opt);
    });
    sel.value = state.model;
  }

  /* ---------- wiring ---------- */
  function init() {
    $("fleetCount").textContent = NS.AGENTS.length;
    buildModelOptions();
    $("engine").value = state.engine;
    $("depth").value = state.depth;

    Array.prototype.forEach.call($("fleetSeg").querySelectorAll("button"), function (b) {
      b.setAttribute("aria-checked", Number(b.getAttribute("data-size")) === state.size ? "true" : "false");
      b.addEventListener("click", function () {
        state.size = Number(b.getAttribute("data-size"));
        Array.prototype.forEach.call($("fleetSeg").querySelectorAll("button"), function (o) {
          o.setAttribute("aria-checked", o === b ? "true" : "false");
        });
        persist();
        preview();
      });
    });

    $("engine").addEventListener("change", function () {
      state.engine = this.value;
      persist();
      syncEngineUI();
      if (state.engine === "live" && !NS.engine.hasKey()) openKeyModal();
    });

    $("model").addEventListener("change", function () {
      state.model = this.value;
      persist();
      syncEngineUI();
    });

    $("depth").addEventListener("change", function () {
      state.depth = this.value;
      persist();
    });

    $("task").addEventListener("input", schedulePreview);
    $("task").addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); launch(); }
    });

    Array.prototype.forEach.call($("presets").querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        $("task").value = chip.getAttribute("data-preset");
        preview();
        $("task").focus();
      });
    });

    $("launchBtn").addEventListener("click", launch);

    $("cancelBtn").addEventListener("click", function () {
      if (state.running) {
        state.running.cancel();
        log("warn", "Cancelling the run…");
      }
    });

    /* copy / download bar */
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;

      var c = t.getAttribute("data-copy");
      if (c === "brief") copy(state.brief, t);
      if (c === "prompt") copy(state.prompt, t);

      var d = t.getAttribute("data-download");
      if (d === "brief") download("golocode-briefing.md", state.brief, "text/markdown;charset=utf-8");
      if (d === "bundle") download("golocode-deliverable.md", bundle(), "text/markdown;charset=utf-8");
    });

    /* roster */
    $("rosterBtn").addEventListener("click", openRoster);
    $("rosterClose").addEventListener("click", closeRoster);
    $("scrim").addEventListener("click", closeRoster);
    $("rosterSearch").addEventListener("input", renderRoster);
    renderRosterFilters();
    renderRoster();
    renderFleet();

    /* key modal */
    $("keyBtn").addEventListener("click", openKeyModal);
    $("keyCancel").addEventListener("click", closeKeyModal);
    $("keySave").addEventListener("click", function () {
      var k = $("keyInput").value.trim();
      if (!k) { closeKeyModal(); return; }
      NS.engine.setKey(k);
      closeKeyModal();
      log("ok", "API key stored in this browser. Live engine ready.");
      $("engine").value = "live";
      state.engine = "live";
      persist();
      syncEngineUI();
    });
    $("keyClear").addEventListener("click", function () {
      NS.engine.setKey("");
      $("keyInput").value = "";
      log("", "Stored API key cleared from this browser.");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("keyModal").hidden) closeKeyModal();
      else if (!$("roster").hidden) closeRoster();
    });

    syncEngineUI();
    $("readout").hidden = true;
    $("meter").textContent = "standing by";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
