/* ============================================================
   GOLOCODE — router.js
   ตัววิเคราะห์ภารกิจ: อ่านคำสั่ง → เดาประเภทงาน → เลือกทีมเอเจนต์
   Mission router: reads the task, classifies it, and picks the squad.

   Selection is deterministic — the same task text always produces the same
   squad, so a run can be explained and repeated.
   ============================================================ */
(function (root) {
  "use strict";

  var NS = root.GOLOCODE = root.GOLOCODE || {};

  /* ---------- mission profiles ---------- */
  /* weight: phase emphasis. boost: divisions that get a head start. */
  var PROFILES = [
    { id: "creative", label: "Creative / Interactive Build", glyph: "✺",
      keys: "game|shader|animation|generative|art|creative|visual|interactive|canvas|particle|3d|webgl|physics|music|audio|demo|fun|beautiful|playful|experience",
      boost: ["creative", "product", "speed"],
      anchors: "AURORA|KINETIC|PIXELWRIGHT|DREAMSTATE",
      weight: { recon: 1, design: 1.4, build: 2.6, verify: 1, ship: 0.8 } },

    { id: "web", label: "Web Application", glyph: "◈",
      keys: "website|web app|landing page|html|css|frontend|react|vue|svelte|next|page|dashboard|form|responsive|ui|site",
      boost: ["product", "core", "creative"],
      anchors: "PRISM|PALETTE|ATLAS-UX|COMPASS",
      weight: { recon: 1, design: 1.4, build: 2.4, verify: 1.2, ship: 1 } },

    { id: "service", label: "Backend Service / API", glyph: "⬢",
      keys: "api|backend|server|endpoint|microservice|rest|graphql|database|crud|auth|queue|service|webhook",
      boost: ["core", "guard", "infra"],
      anchors: "LATTICE|FORGE|VAULTKEEP|BEDROCK",
      weight: { recon: 1, design: 1.8, build: 2.2, verify: 1.4, ship: 1 } },

    { id: "ai", label: "AI / Data System", glyph: "⟁",
      keys: "ai|llm|model|machine learning|agent|chatbot|rag|embedding|dataset|prompt|training|inference|neural|data pipeline|analytics",
      boost: ["intel", "core", "quality"],
      anchors: "WEAVER|SIGIL|PLUMBLINE|SIFT",
      weight: { recon: 1.2, design: 1.8, build: 2, verify: 1.6, ship: 0.9 } },

    { id: "mobile", label: "Mobile / Native App", glyph: "⬡",
      keys: "ios|android|mobile app|swift|kotlin|react native|flutter|phone|tablet|app store|play store",
      boost: ["frontier", "product", "speed"],
      anchors: "SWIFTHAND|DROIDWRIGHT|BRIDGEWORK|LEANCORE",
      weight: { recon: 1, design: 1.4, build: 2.4, verify: 1.4, ship: 1 } },

    { id: "systems", label: "Systems / Low-Level", glyph: "⬗",
      keys: "rust|c\\+\\+|embedded|firmware|compiler|kernel|driver|memory safety|pointer|microcontroller|protocol|parser|interpreter",
      boost: ["frontier", "speed", "quality"],
      anchors: "IRONCORE|BYTESMITH|PARALLEL|ARCHAEOLOGIST",
      weight: { recon: 1, design: 1.6, build: 2.4, verify: 1.6, ship: 0.7 } },

    { id: "cli", label: "Tool / Automation", glyph: "▸",
      keys: "cli|command line|terminal|script|automate|automation|bot|cron|tool|scraper|converter|generator",
      boost: ["frontier", "ops", "core"],
      anchors: "TERMINAL|TRAILHEAD|SCROLLKEEP|TEMPO",
      weight: { recon: 1, design: 1.2, build: 2.4, verify: 1.2, ship: 1.1 } },

    { id: "debug", label: "Debug / Repair", glyph: "⚠",
      keys: "bug|fix|error|broken|crash|debug|not working|fails|exception|stack trace|regression|issue|wrong output",
      boost: ["quality", "core", "speed"],
      anchors: "REGRESS|STOPWATCH|ARCHAEOLOGIST|UNIT-ZERO",
      weight: { recon: 1.6, design: 0.8, build: 2, verify: 2.4, ship: 0.6 } },

    { id: "perf", label: "Performance Work", glyph: "⚡",
      keys: "slow|performance|optimize|optimise|speed up|faster|memory|lag|latency|bottleneck|bundle size|fps|scale",
      boost: ["speed", "quality", "infra"],
      anchors: "STOPWATCH|MEMWARD|BIGO|ARCHAEOLOGIST",
      weight: { recon: 1.4, design: 1, build: 2, verify: 2.2, ship: 0.6 } },

    { id: "security", label: "Security Review", glyph: "⛨",
      keys: "security|vulnerability|audit|penetration|secure|exploit|owasp|xss|injection|hardening|threat|encrypt",
      boost: ["guard", "quality", "infra"],
      anchors: "BULWARK|THREATCAST|HARDLINE|ARCHAEOLOGIST",
      weight: { recon: 1.4, design: 1.4, build: 1.2, verify: 2.6, ship: 0.6 } },

    { id: "refactor", label: "Refactor / Migration", glyph: "✧",
      keys: "refactor|migrate|migration|upgrade|port|legacy|clean up|rewrite|restructure|technical debt|modernize|convert",
      boost: ["ops", "quality", "core"],
      anchors: "CHISEL|PORTWRIGHT|ARCHAEOLOGIST|PROOFWRIGHT",
      weight: { recon: 1.6, design: 1.6, build: 2, verify: 1.6, ship: 0.8 } },

    { id: "infra", label: "Infrastructure / Delivery", glyph: "⬗",
      keys: "deploy|docker|kubernetes|ci|cd|pipeline|hosting|terraform|serverless|devops|release|monitoring|cloud",
      boost: ["infra", "guard", "ops"],
      anchors: "PIPEWORK|CRATE|BEACON|TEMPO",
      weight: { recon: 1, design: 1.4, build: 1.8, verify: 1.4, ship: 2.2 } },

    { id: "explain", label: "Explain / Learn", glyph: "◉",
      keys: "explain|teach|how does|what is|understand|learn|walk me through|documentation|document|readme|tutorial|why does",
      boost: ["ops", "core", "quality"],
      anchors: "MENTOR|SCROLLKEEP|ARCHAEOLOGIST|LENS",
      weight: { recon: 2, design: 1.4, build: 1, verify: 0.8, ship: 2 } }
  ];

  var DEFAULT_PROFILE = {
    id: "general", label: "General Engineering", glyph: "◆",
    boost: ["core", "product", "quality"],
    anchors: "KEYSTONE|TEMPO|REDPEN|SCROLLKEEP",
    weight: { recon: 1.2, design: 1.4, build: 2.2, verify: 1.4, ship: 1 }
  };

  /* ---------- stack detection (for the briefing header) ---------- */
  var STACKS = [
    ["JavaScript", "javascript|js|node|nodejs|npm"],
    ["TypeScript", "typescript|ts|tsx"],
    ["Python", "python|py|django|flask|fastapi|pandas"],
    ["React", "react|jsx|next.js|nextjs"],
    ["Vue", "vue|nuxt"],
    ["Svelte", "svelte|sveltekit"],
    ["HTML/CSS", "html|css|tailwind|scss|sass"],
    ["Go", "golang"],
    ["Rust", "rust|cargo"],
    ["Java", "java|spring|kotlin"],
    ["C/C++", "c\\+\\+|cpp|clang"],
    ["C#/.NET", "c#|csharp|dotnet|.net|unity"],
    ["PHP", "php|laravel"],
    ["Ruby", "ruby|rails"],
    ["Swift", "swift|swiftui"],
    ["SQL", "sql|postgres|postgresql|mysql|sqlite"],
    ["MongoDB", "mongo|mongodb"],
    ["Docker", "docker|container"],
    ["Three.js", "three.js|threejs|webgl"],
    ["Godot/Unreal", "godot|unreal"]
  ];

  /* ---------- text helpers ---------- */
  function normalize(text) {
    return (" " + String(text || "").toLowerCase() + " ")
      .replace(/[^a-z0-9+#./฀-๿\s-]/g, " ")
      .replace(/\s+/g, " ");
  }

  function tokenize(norm) {
    return norm.split(" ").filter(function (t) { return t.length > 1; });
  }

  function hasPhrase(norm, phrase) {
    return norm.indexOf(" " + phrase + " ") !== -1 ||
           norm.indexOf(" " + phrase + "s ") !== -1 ||
           norm.indexOf(" " + phrase + ",") !== -1;
  }

  function keyHit(norm, keys) {
    var parts = keys.split("|"), hits = 0;
    for (var i = 0; i < parts.length; i++) {
      var k = parts[i].replace(/\\/g, "");
      if (norm.indexOf(" " + k) !== -1) hits++;
    }
    return hits;
  }

  /* ---------- profile detection ---------- */
  function detectProfile(norm) {
    var best = null, bestScore = 0, scores = [];
    PROFILES.forEach(function (p) {
      var s = keyHit(norm, p.keys);
      scores.push({ id: p.id, label: p.label, score: s });
      if (s > bestScore) { bestScore = s; best = p; }
    });
    var chosen = bestScore > 0 ? best : DEFAULT_PROFILE;
    /* a second profile with real signal is worth naming in the briefing */
    scores.sort(function (a, b) { return b.score - a.score; });
    var second = scores[1] && scores[1].score > 0 && scores[1].id !== chosen.id
      ? scores[1] : null;
    return { profile: chosen, secondary: second, confidence: bestScore };
  }

  function detectStacks(norm) {
    var found = [];
    STACKS.forEach(function (s) {
      if (keyHit(norm, s[1]) > 0 && found.indexOf(s[0]) === -1) found.push(s[0]);
    });
    return found;
  }

  /* ---------- agent scoring ---------- */
  function scoreAgent(agent, ctx) {
    var score = 0, matched = [];

    agent.tags.forEach(function (tag) {
      var multi = tag.indexOf(" ") !== -1;
      if (multi) {
        if (ctx.norm.indexOf(" " + tag) !== -1) {
          score += 3 + tag.split(" ").length;
          matched.push(tag);
        }
        return;
      }
      if (hasPhrase(ctx.norm, tag)) {
        score += 3;
        matched.push(tag);
      } else if (tag.length >= 6) {
        /* prefix match catches plurals and -ing forms: "test" -> "testing" */
        for (var i = 0; i < ctx.tokens.length; i++) {
          if (ctx.tokens[i].indexOf(tag) === 0) { score += 1.5; matched.push(tag); break; }
        }
      }
    });

    /* explicit call-out by codename, e.g. "get NORTHSTAR on this" */
    if (ctx.norm.indexOf(" " + agent.codename.toLowerCase()) !== -1) {
      score += 10;
      matched.unshift("@" + agent.codename);
    }

    /* role words in the request, e.g. "designer", "reviewer" */
    agent.role.toLowerCase().split(/[\s/]+/).forEach(function (w) {
      if (w.length >= 5 && hasPhrase(ctx.norm, w)) score += 1.5;
    });

    /* the profile's anchor specialists — the ones this kind of job always needs */
    if (ctx.anchors.indexOf(agent.codename) !== -1) {
      score += 4;
      matched.push("mission anchor");
    }

    /* division affinity from the detected mission profile — damped for agents
       the task never mentioned, so a boosted division cannot flood the squad */
    var divIdx = ctx.boost.indexOf(agent.division);
    if (divIdx !== -1) {
      score += (2.5 - divIdx * 0.5) * (matched.length ? 1 : 0.35);
    }

    /* a small standing value so an unmatched specialist still ranks sanely */
    score += 0.4;

    return { score: score, matched: matched.slice(0, 3) };
  }

  /* ---------- phase quotas ---------- */
  function quotas(weights, size) {
    var ids = NS.PHASES.map(function (p) { return p.id; });
    var total = ids.reduce(function (s, id) { return s + (weights[id] || 1); }, 0);
    var out = {}, assigned = 0;

    ids.forEach(function (id) {
      var n = Math.max(1, Math.round((weights[id] || 1) / total * size));
      out[id] = n;
      assigned += n;
    });

    /* correct the rounding drift, largest-weight phase absorbs it */
    var order = ids.slice().sort(function (a, b) {
      return (weights[b] || 1) - (weights[a] || 1);
    });
    var guard = 0;
    while (assigned !== size && guard++ < 500) {
      for (var i = 0; i < order.length && assigned !== size; i++) {
        var id = order[assigned < size ? i : order.length - 1 - i];
        if (assigned < size) { out[id]++; assigned++; }
        else if (out[id] > 1) { out[id]--; assigned--; }
      }
    }
    return out;
  }

  /* ---------- the public call ---------- */
  function route(task, size) {
    var norm = normalize(task);
    var ctx = {
      norm: norm,
      tokens: tokenize(norm),
      boost: [],
      anchors: []
    };

    var detected = detectProfile(norm);
    var profile = detected.profile;
    ctx.boost = profile.boost || [];
    ctx.anchors = (profile.anchors || "").split("|");

    var ranked = NS.AGENTS.map(function (a) {
      var r = scoreAgent(a, ctx);
      return { agent: a, score: r.score, matched: r.matched };
    }).sort(function (x, y) {
      if (y.score !== x.score) return y.score - x.score;
      return x.agent.num - y.agent.num;   /* stable, deterministic */
    });

    size = Math.max(3, Math.min(NS.AGENTS.length, size | 0));

    var byPhase = {};
    NS.PHASES.forEach(function (p) { byPhase[p.id] = []; });
    ranked.forEach(function (r) { byPhase[r.agent.phase].push(r); });

    var want = quotas(profile.weight, size);
    var picked = [], seen = {};

    NS.PHASES.forEach(function (p) {
      var pool = byPhase[p.id];
      var take = Math.min(want[p.id], pool.length);
      for (var i = 0; i < take; i++) {
        picked.push(pool[i]);
        seen[pool[i].agent.id] = true;
      }
    });

    /* a phase may be short of agents — top up from the global ranking */
    for (var i = 0; i < ranked.length && picked.length < size; i++) {
      if (!seen[ranked[i].agent.id]) {
        picked.push(ranked[i]);
        seen[ranked[i].agent.id] = true;
      }
    }

    /* the commander always signs off on the mission */
    if (!seen[NS.LEAD.id]) {
      picked.pop();
      picked.push(ranked.filter(function (r) { return r.agent.id === NS.LEAD.id; })[0]);
    }

    picked.sort(function (x, y) {
      var pa = phaseIndex(x.agent.phase), pb = phaseIndex(y.agent.phase);
      if (pa !== pb) return pa - pb;
      if (y.score !== x.score) return y.score - x.score;
      return x.agent.num - y.agent.num;
    });

    var waves = NS.PHASES.map(function (p) {
      return {
        phase: p,
        members: picked.filter(function (r) { return r.agent.phase === p.id; })
      };
    }).filter(function (w) { return w.members.length > 0; });

    return {
      task: String(task || "").trim(),
      profile: profile,
      secondary: detected.secondary,
      confidence: detected.confidence,
      stacks: detectStacks(norm),
      size: picked.length,
      squad: picked,
      waves: waves,
      ranked: ranked
    };
  }

  function phaseIndex(id) {
    for (var i = 0; i < NS.PHASES.length; i++) {
      if (NS.PHASES[i].id === id) return i;
    }
    return 99;
  }

  NS.router = {
    route: route,
    normalize: normalize,
    detectProfile: detectProfile,
    detectStacks: detectStacks,
    PROFILES: PROFILES
  };
})(window);
