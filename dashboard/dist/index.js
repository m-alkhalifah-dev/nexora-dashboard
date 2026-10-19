/* NEXORA — mission control for the Hermes agent crew.
 * Single IIFE, no build step. All UI via window.__HERMES_PLUGIN_SDK__.
 * Reads from /api/plugins/nexora/* (read-only). Writes go through Hermes'
 * own authenticated REST API (kanban create, cron trigger).
 * Design + code original — no assets or code copied from any third party.
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;
  var React = SDK.React;
  var h = React.createElement;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var useRef = SDK.hooks.useRef;
  var fx = SDK.fetchJSON;
  var timeAgo = (SDK.utils && SDK.utils.timeAgo) || function (t) { return ""; };

  var API = "/api/plugins/nexora/";
  var POLL_MS = 12000;

  // ---- tiny helpers --------------------------------------------------------
  function cx() { return [].slice.call(arguments).filter(Boolean).join(" "); }
  function el(tag, cls, kids) { return h(tag, cls ? { className: cls } : null, kids); }
  function num(n) { return (n === null || n === undefined || n !== n) ? "—" : n; }
  function ago(sec) {
    if (!sec) return "";
    try { return timeAgo(sec) || relAgo(sec); } catch (e) { return relAgo(sec); }
  }
  function relAgo(sec) {
    if (!sec) return "";
    var d = Date.now() / 1000 - sec; if (d < 0) d = 0;
    if (d < 60) return Math.round(d) + "s ago";
    if (d < 3600) return Math.round(d / 60) + "m ago";
    if (d < 86400) return Math.round(d / 3600) + "h ago";
    return Math.round(d / 86400) + "d ago";
  }
  function get(u) { return fx(API + u); }
  function schedStr(s) {
    if (!s) return "—";
    if (typeof s === "object") return s.display || s.expr || "—";
    return s;
  }

  // shared poller hook
  function usePoll(path, deps) {
    var st = useState({ data: null, err: null, loading: true });
    var data = st[0], set = st[1];
    var ref = useRef(0);
    useEffect(function () {
      var alive = true; var id;
      function tick() {
        get(path).then(function (d) {
          if (alive) set({ data: d, err: null, loading: false });
        }).catch(function (e) {
          if (alive) set(function (p) { return { data: p.data, err: String(e), loading: false }; });
        });
      }
      tick();
      id = setInterval(tick, POLL_MS);
      return function () { alive = false; clearInterval(id); };
    }, deps || []);
    return data;
  }

  // ---- shared bits ---------------------------------------------------------
  function Stat(props) {
    return el("div", "nx-stat",
      [
        el("div", "nx-stat-v", num(props.value)),
        el("div", "nx-stat-k", props.label),
        props.sub ? el("div", "nx-stat-sub", props.sub) : null,
      ]);
  }
  function ModelChip(mm, model) {
    mm = mm || {};
    return h("span", { className: "nx-chip", style: { borderColor: mm.color, color: mm.color } },
      [h("span", { className: "nx-dot", style: { background: mm.color } }), " ", model || "—"]);
  }
  function dot(color) { return h("span", { className: "nx-dot", style: { background: color } }); }
  function Section(title, right, body) {
    return el("div", "nx-panel", [
      el("div", "nx-panel-head", [el("div", "nx-panel-title", title), right ? el("div", "nx-panel-right", right) : null]),
      body,
    ]);
  }

  // =========================================================================
  // COCKPIT
  // =========================================================================
  function Cockpit(props) {
    var ov = usePoll("overview");
    var ag = usePoll("agents");
    var se = usePoll("sessions?limit=8");
    var he = usePoll("health");
    var o = (ov && ov.data) || {};
    var agents = (ag && ag.data && ag.data.agents) || [];
    var sess = (se && se.data && se.data.sessions) || [];
    var health = (he && he.data) || {};
    var tiers = o.tiers || {};

    var tierBar = h("div", { className: "nx-tierbar" },
      ["heavy", "mid", "vision", "cheap", "warm", "cloud"].filter(function (t) { return tiers[t]; }).map(function (t) {
        var colors = { heavy: "#f0883e", mid: "#e3b341", vision: "#a371f7", cheap: "#3fb950", warm: "#58a6ff", cloud: "#8b949e" };
        return h("div", { key: t, className: "nx-tierseg", title: t + ": " + tiers[t],
          style: { flex: tiers[t], background: colors[t] } }, tiers[t]);
      }));

    var router = health.llm_router || {};
    var proutrouter = health.pentest_router || {};

    return el("div", "nx-cockpit", [
      // hero
      el("div", "nx-hero", [
        el("div", "nx-hero-left", [
          el("div", "nx-kicker", "IGNITION · MISSION CONTROL ONLINE"),
          el("div", "nx-hero-title", [
            "You are behind the wheel of ",
            h("b", null, "an " + (o.agents_total || "—") + "-agent engine."),
          ]),
          el("div", "nx-hero-sub", "One screen for the whole crew — roster, missions, schedule, memory and the machine under it."),
        ]),
        el("div", "nx-hero-right", [
          el("div", "nx-gauge", [
            el("div", "nx-gauge-v", num(o.agents_total)),
            el("div", "nx-gauge-k", "AGENTS"),
          ]),
          el("div", "nx-gauge", [
            el("div", "nx-gauge-v", (o.lesson_coverage_pct != null ? o.lesson_coverage_pct + "%" : "—")),
            el("div", "nx-gauge-k", "MEMORY COVERAGE"),
          ]),
          el("div", "nx-gauge", [
            el("div", { className: "nx-gauge-v", style: { color: router.up ? "#3fb950" : "#f85149" } }, router.up ? "ONLINE" : "DOWN"),
            el("div", "nx-gauge-k", "LLM ROUTER"),
          ]),
        ]),
      ]),
      // stat tiles
      el("div", "nx-stats", [
        h(Stat, { key: "a", value: o.agents_total, label: "agents" }),
        h(Stat, { key: "h", value: o.heavy_agents, label: "27B · one at a time", sub: "heavy models evict each other" }),
        h(Stat, { key: "m", value: o.agents_with_mcp, label: "with MCP servers" }),
        h(Stat, { key: "l", value: (o.lesson_coverage_pct != null ? o.lesson_coverage_pct + "%" : "—"), label: "wiki-lesson coverage", sub: (o.agents_with_lessons || 0) + " of " + (o.agents_total || 0) }),
        h(Stat, { key: "k", value: o.kanban_active, label: "missions active", sub: (o.kanban_total || 0) + " on the board" }),
        h(Stat, { key: "c", value: o.cron_jobs, label: "scheduled jobs", sub: (o.cron_quiet || 0) + " stay-quiet" }),
        h(Stat, { key: "s", value: o.total_sessions, label: "sessions stored" }),
        h(Stat, { key: "w", value: o.wiki_topics, label: "wiki topics", sub: (o.wiki_profiles || 0) + " agent lessons" }),
      ]),
      // tier bar + router
      el("div", "nx-row2", [
        Section("Model mix across the crew", null, el("div", "nx-tierwrap", [
          tierBar,
          el("div", "nx-legend", [
            legendItem("#f0883e", "heavy 27B"), legendItem("#e3b341", "14B"),
            legendItem("#a371f7", "vision"), legendItem("#3fb950", "cheap"),
            legendItem("#58a6ff", "warm"), legendItem("#8b949e", "cloud"),
          ]),
        ])),
        Section("Local model routers", null, el("div", "nx-routers", [
          routerRow("main · 127.0.0.1:8080", router),
          routerRow("pentest · 127.0.0.1:8086", proutrouter),
        ])),
      ]),
      // crew preview + activity
      el("div", "nx-row2", [
        Section("The crew", (ag && ag.data ? (agents.length + " profiles") : ""), crewPreview(agents, props.go)),
        Section("Recent activity", null, activityList(sess)),
      ]),
    ]);
  }
  function legendItem(c, t) { return el("span", "nx-leg", [dot(c), t]); }
  function routerRow(name, r) {
    r = r || {};
    return el("div", "nx-router", [
      el("div", "nx-router-h", [
        h("span", { className: "nx-pill", style: { color: r.up ? "#3fb950" : "#f85149", borderColor: r.up ? "#3fb95055" : "#f8514955" } }, r.up ? "● up" : "○ down"),
        name,
      ]),
      el("div", "nx-router-models", (r.models && r.models.length) ? r.models.map(function (m, i) {
        return h("span", { key: i, className: "nx-tag" }, m);
      }) : [el("span", "nx-muted", "no models resident")]),
    ]);
  }
  function crewPreview(agents, go) {
    var byCat = {};
    agents.forEach(function (a) { (byCat[a.category] = byCat[a.category] || []).push(a); });
    var cats = Object.keys(byCat);
    return el("div", "nx-crew",
      cats.map(function (c) {
        return el("div", "nx-crewcat", [
          el("div", "nx-crewcat-h", c),
          el("div", "nx-crewchips", byCat[c].map(function (a) {
            return h("span", { key: a.name, className: "nx-crewchip", title: a.role,
              style: { borderColor: a.model_meta.color + "66" },
              onClick: function () { go && go("roster"); } },
              [dot(a.model_meta.color), a.name]);
          })),
        ]);
      }).concat([el("div", "nx-seeall", h("button", { className: "nx-linkbtn", onClick: function () { go && go("roster"); } }, "View full roster →"))]));
  }
  function activityList(sess) {
    if (!sess.length) return el("div", "nx-empty", "No recent sessions.");
    return el("div", "nx-activity", sess.map(function (s, i) {
      return el("div", "nx-actrow", [
        el("div", "nx-actmain", [
          el("div", "nx-acttitle", s.title || "(untitled)"),
          el("div", "nx-actmeta", [
            h("span", { className: "nx-tag" }, s.profile),
            s.model ? h("span", { className: "nx-muted" }, s.model) : null,
          ]),
        ]),
        el("div", "nx-actright", [
          el("div", null, (s.message_count || 0) + " msg"),
          el("div", "nx-muted", ago(s.last_activity_at || s.started_at)),
        ]),
      ]);
    }));
  }

  // =========================================================================
  // ROSTER
  // =========================================================================
  function Roster() {
    var ag = usePoll("agents");
    var agents = (ag && ag.data && ag.data.agents) || [];
    var order = (ag && ag.data && ag.data.category_order) || [];
    var qst = useState(""); var q = qst[0], setQ = qst[1];
    var taskFor = useState(null); // profile name for task modal
    var pageFor = useState(null); // wiki page content

    var byCat = {};
    agents.filter(function (a) {
      if (!q) return true;
      var hay = (a.name + " " + a.role + " " + a.model + " " + (a.mcp || []).join(" ")).toLowerCase();
      return hay.indexOf(q.toLowerCase()) >= 0;
    }).forEach(function (a) { (byCat[a.category] = byCat[a.category] || []).push(a); });
    var cats = order.filter(function (c) { return byCat[c]; });

    return el("div", "nx-roster", [
      el("div", "nx-roster-top", [
        el("div", "nx-panel-title", "The crew · " + agents.length + " agents"),
        h("input", { className: "nx-search", placeholder: "filter by name, role, model, MCP…",
          value: q, onChange: function (e) { setQ(e.target.value); } }),
      ]),
      el("div", "nx-rostercats", cats.map(function (c) {
        return el("div", "nx-rcat", [
          el("div", "nx-rcat-h", [c, h("span", { className: "nx-muted" }, byCat[c].length)]),
          el("div", "nx-grid", byCat[c].map(function (a) {
            return agentCard(a, function () { taskFor[1](a.name); }, function () {
              get("wiki_page?kind=profiles&name=" + encodeURIComponent(a.name)).then(function (r) {
                pageFor[1](r && r.ok ? r : { ok: false, name: a.name });
              });
            });
          })),
        ]);
      })),
      taskFor[0] ? h(TaskModal, { profile: taskFor[0], onClose: function () { taskFor[1](null); } }) : null,
      pageFor[0] ? h(PageModal, { page: pageFor[0], onClose: function () { pageFor[1](null); } }) : null,
    ]);
  }
  function agentCard(a, onTask, onLesson) {
    return el("div", "nx-card", [
      el("div", "nx-card-h", [
        el("div", "nx-card-name", [a.is_default ? h("span", { className: "nx-star", title: "default profile" }, "◆") : null, a.name]),
        ModelChip(a.model_meta, a.model),
      ]),
      el("div", "nx-card-role", a.role || h("span", { className: "nx-muted" }, "(no description)")),
      el("div", "nx-card-meta", [
        a.effort ? kv("effort", a.effort) : null,
        a.max_turns ? kv("max turns", a.max_turns) : null,
        kv("tools", a.toolset_count),
        (a.sessions != null) ? kv("sessions", a.sessions) : null,
      ]),
      (a.mcp && a.mcp.length) ? el("div", "nx-card-line", [tagLabel("MCP"), a.mcp.map(function (m, i) { return h("span", { key: i, className: "nx-tag" }, m); })]) : null,
      (a.hooks && a.hooks.length) ? el("div", "nx-card-line", [tagLabel("hooks"), a.hooks.map(function (m, i) { return h("span", { key: i, className: "nx-tag" }, m); })]) : null,
      (a.fallbacks && a.fallbacks.length) ? el("div", "nx-card-line", [tagLabel("fallback"), a.fallbacks.map(function (m, i) { return h("span", { key: i, className: "nx-tag nx-tag-dim" }, m); })]) : null,
      el("div", "nx-card-foot", [
        h("span", { className: a.has_wiki_lesson ? "nx-badge nx-badge-ok" : "nx-badge nx-badge-off" }, a.has_wiki_lesson ? "✓ wiki lesson" : "no lesson yet"),
        el("div", "nx-card-actions", [
          h("button", { className: "nx-btn nx-btn-sm", onClick: onTask }, "+ Task"),
          a.has_wiki_lesson ? h("button", { className: "nx-btn nx-btn-sm nx-btn-ghost", onClick: onLesson }, "Lesson") : null,
        ]),
      ]),
    ]);
  }
  function kv(k, v) { return el("span", "nx-kv", [h("b", null, v), " ", k]); }
  function tagLabel(t) { return h("span", { className: "nx-taglabel" }, t); }

  // =========================================================================
  // MISSIONS (kanban)
  // =========================================================================
  var KCOLS = ["triage", "todo", "ready", "running", "review", "blocked", "done"];
  function Missions() {
    var kb = usePoll("kanban");
    var k = (kb && kb.data) || {};
    var tasks = (k.tasks || []).filter(function (t) { return t.status !== "archived"; });
    var showNew = useState(false);
    var byStatus = {};
    tasks.forEach(function (t) { (byStatus[t.status] = byStatus[t.status] || []).push(t); });
    var cols = KCOLS.filter(function (c) { return byStatus[c]; });
    // include any unexpected statuses
    Object.keys(byStatus).forEach(function (s) { if (cols.indexOf(s) < 0) cols.push(s); });

    return el("div", "nx-missions", [
      el("div", "nx-roster-top", [
        el("div", "nx-panel-title", "Missions · " + tasks.length + " on the board"),
        h("button", { className: "nx-btn", onClick: function () { showNew[1](true); } }, "+ New mission"),
      ]),
      tasks.length === 0 ? el("div", "nx-emptybig", "The board is clear. Hand the crew a goal with “+ New mission”.") :
        el("div", "nx-kanban", cols.map(function (c) {
          var list = byStatus[c] || [];
          return el("div", "nx-kcol", [
            el("div", "nx-kcol-h", [c, h("span", { className: "nx-muted" }, list.length)]),
            el("div", "nx-kcol-body", list.map(function (t) {
              return el("div", "nx-ktask", [
                el("div", "nx-ktask-t", t.title || t.id),
                el("div", "nx-ktask-m", [
                  t.assignee ? h("span", { className: "nx-tag" }, t.assignee) : null,
                  (t.priority ? h("span", { className: "nx-muted" }, "P" + t.priority) : null),
                  h("span", { className: "nx-muted" }, ago(t.started_at || t.created_at)),
                ]),
                (t.consecutive_failures ? el("div", "nx-fail", t.consecutive_failures + " fail(s)") : null),
              ]);
            })),
          ]);
        })),
      showNew[0] ? h(TaskModal, { profile: null, onClose: function () { showNew[1](false); } }) : null,
    ]);
  }

  // =========================================================================
  // SCHEDULE (cron)
  // =========================================================================
  function Schedule() {
    var cr = usePoll("cron");
    var c = (cr && cr.data) || {};
    var jobs = c.jobs || [];
    var busy = useState(null);
    function runNow(j) {
      if (!window.confirm("Run “" + (j.name || j.id) + "” now (profile " + j.profile + ")?")) return;
      busy[1](j.id);
      fx("/api/cron/jobs/" + encodeURIComponent(j.id) + "/trigger?profile=" + encodeURIComponent(j.profile), { method: "POST" })
        .then(function () { busy[1](null); })
        .catch(function (e) { alert("Trigger failed: " + e); busy[1](null); });
    }
    return el("div", "nx-schedule", [
      el("div", "nx-roster-top", [
        el("div", "nx-panel-title", "Standing orders · " + jobs.length + " scheduled jobs"),
        el("div", "nx-muted", (c.quiet_count || 0) + " stay quiet · " + (c.executions_total || 0) + " runs logged"),
      ]),
      el("div", "nx-note", "Jobs whose reply is exactly [SILENT] send nothing when there's nothing to report. The ✓ quiet badge marks jobs that already carry that rule."),
      jobs.length === 0 ? el("div", "nx-emptybig", "No scheduled jobs yet.") :
        el("div", "nx-jobs", jobs.map(function (j) {
          return el("div", "nx-job", [
            el("div", "nx-job-main", [
              el("div", "nx-job-t", [j.name || "(unnamed job)",
                j.silent_rule ? h("span", { className: "nx-badge nx-badge-ok" }, "✓ quiet") : h("span", { className: "nx-badge nx-badge-warn" }, "always pings"),
                (j.paused ? h("span", { className: "nx-badge nx-badge-off" }, "paused") : null)]),
              el("div", "nx-job-p", j.prompt_preview || ""),
              el("div", "nx-job-m", [
                h("span", { className: "nx-tag" }, j.profile),
                h("span", { className: "nx-tag nx-tag-dim" }, schedStr(j.schedule)),
                h("span", { className: "nx-muted" }, "→ " + (j.deliver || "local")),
                j.last_status ? h("span", { className: "nx-muted" }, "last: " + j.last_status) : null,
              ]),
            ]),
            el("div", "nx-job-actions", [
              h("button", { className: "nx-btn nx-btn-sm", disabled: busy[0] === j.id, onClick: function () { runNow(j); } }, busy[0] === j.id ? "…" : "Run now"),
            ]),
          ]);
        })),
    ]);
  }

  // =========================================================================
  // MEMORY (wiki)
  // =========================================================================
  function Memory() {
    var wk = usePoll("wiki");
    var w = (wk && wk.data) || {};
    var pageFor = useState(null);
    function open(kind, name) {
      get("wiki_page?kind=" + kind + "&name=" + encodeURIComponent(name)).then(function (r) { pageFor[1](r && r.ok ? r : { ok: false, name: name }); });
    }
    return el("div", "nx-memory", [
      el("div", "nx-roster-top", [
        el("div", "nx-panel-title", "Shared memory · " + (w.path || "")),
        el("div", "nx-muted", (w.counts ? (w.counts.topics + " topics · " + w.counts.profiles + " lessons · " + w.counts.log + " log lines") : "")),
      ]),
      el("div", "nx-row2", [
        Section("hot.md — what every agent always knows", h("button", { className: "nx-linkbtn", onClick: function () { open("root", "hot"); } }, "open"),
          el("pre", "nx-pre", w.hot || "(empty)")),
        Section("Recent changes", null, el("div", "nx-log", (w.log_recent || []).map(function (l, i) {
          return el("div", "nx-logrow", l);
        }))),
      ]),
      Section("Topic pages", null, el("div", "nx-chips", (w.topics || []).map(function (t) {
        return h("button", { key: t, className: "nx-chipbtn", onClick: function () { open("topics", t); } }, t);
      }))),
      Section("Agent lessons", null, el("div", "nx-chips", (w.profiles || []).map(function (p) {
        return h("button", { key: p, className: "nx-chipbtn nx-chipbtn-alt", onClick: function () { open("profiles", p); } }, p);
      }))),
      pageFor[0] ? h(PageModal, { page: pageFor[0], onClose: function () { pageFor[1](null); } }) : null,
    ]);
  }

  // =========================================================================
  // AGENT MAP
  // =========================================================================
  function AgentMap() {
    var ag = usePoll("agents");
    var agents = (ag && ag.data && ag.data.agents) || [];
    var order = (ag && ag.data && ag.data.category_order) || [];
    var byCat = {};
    agents.forEach(function (a) { (byCat[a.category] = byCat[a.category] || []).push(a); });
    var cats = order.filter(function (c) { return byCat[c]; });
    return el("div", "nx-map", [
      el("div", "nx-panel-title", "Agent city — districts by domain"),
      el("div", "nx-districts", cats.map(function (c) {
        return el("div", "nx-district", [
          el("div", "nx-district-h", c),
          el("div", "nx-towers", byCat[c].map(function (a) {
            var hgt = 34 + Math.min(((a.sessions || 0) * 10), 70) + (a.model_meta.tier === "heavy" ? 24 : 0);
            return el("div", "nx-towerwrap", [
              h("div", { className: cx("nx-tower", (a.sessions ? "nx-tower-live" : "")),
                title: a.name + " · " + a.model + (a.sessions ? " · " + a.sessions + " sessions" : ""),
                style: { height: hgt + "px", background: "linear-gradient(180deg," + a.model_meta.color + "cc,#0c0f1a)", borderColor: a.model_meta.color + "88" } }),
              el("div", "nx-towerlabel", a.name),
            ]);
          })),
        ]);
      })),
      el("div", "nx-legend", [
        legendItem("#f0883e", "heavy 27B"), legendItem("#58a6ff", "warm"),
        legendItem("#3fb950", "cheap"), legendItem("#a371f7", "vision"),
      ]),
      el("div", "nx-note", "Tower height ≈ stored sessions; lit edge = has sessions. Colour = model tier."),
    ]);
  }

  // =========================================================================
  // HEALTH
  // =========================================================================
  function Health() {
    var he = usePoll("health", []);
    var h0 = (he && he.data) || {};
    function bar(label, pct, used, total) {
      var p = pct || 0;
      var col = p > 90 ? "#f85149" : p > 75 ? "#f0883e" : "#3fb950";
      return el("div", "nx-hbar", [
        el("div", "nx-hbar-h", [label, h("b", null, (p != null ? p + "%" : "—"))]),
        el("div", "nx-hbar-track", h("div", { className: "nx-hbar-fill", style: { width: p + "%", background: col } })),
        (used != null && total != null) ? el("div", "nx-muted", fmtGB(used) + " / " + fmtGB(total)) : null,
      ]);
    }
    return el("div", "nx-health", [
      el("div", "nx-panel-title", "The machine"),
      h0.ok === false ? el("div", "nx-note", "Host metrics unavailable (" + (h0.error || "psutil missing") + ").") : null,
      el("div", "nx-hgrid", [
        bar("CPU", h0.cpu_percent, null, null),
        bar("Memory", h0.mem_percent, h0.mem_used, h0.mem_total),
        bar("Disk (hermes home)", h0.disk_percent, h0.disk_used, h0.disk_total),
      ]),
      el("div", "nx-row2", [
        Section("Main model router · 127.0.0.1:8080", null, routerRow("resident models", h0.llm_router || {})),
        Section("Pentest router · 127.0.0.1:8086", null, routerRow("resident models", h0.pentest_router || {})),
      ]),
    ]);
  }
  function fmtGB(b) { return (b / 1073741824).toFixed(1) + " GB"; }

  // =========================================================================
  // MODALS
  // =========================================================================
  function TaskModal(props) {
    var ag = usePoll("agents", []);
    var agents = (ag && ag.data && ag.data.agents) || [];
    var title = useState(""); var body = useState(""); var assignee = useState(props.profile || "");
    var sending = useState(false); var err = useState(null); var done = useState(false);
    function submit() {
      if (!title[0].trim()) { err[1]("Give the mission a title."); return; }
      sending[1](true); err[1](null);
      fx("/api/plugins/kanban/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title[0], body: body[0], assignee: assignee[0] || null, triage: true }),
      }).then(function () { sending[1](false); done[1](true); setTimeout(props.onClose, 900); })
        .catch(function (e) { sending[1](false); err[1](String(e)); });
    }
    return modalShell(props.onClose, "New mission", [
      done[0] ? el("div", "nx-ok", "✓ Mission created on the board.") : h(React.Fragment, null, [
        field("Title", h("input", { className: "nx-input", value: title[0], autoFocus: true, onChange: function (e) { title[1](e.target.value); } })),
        field("Brief (stands alone — subagents see nothing else)", h("textarea", { className: "nx-input nx-textarea", rows: 5, value: body[0], onChange: function (e) { body[1](e.target.value); } })),
        field("Assign to", h("select", { className: "nx-input", value: assignee[0], onChange: function (e) { assignee[1](e.target.value); } },
          [h("option", { key: "_", value: "" }, "— triage / let orchestrator pick —")].concat(agents.map(function (a) {
            return h("option", { key: a.name, value: a.name }, a.name + " · " + a.model);
          })))),
        err[0] ? el("div", "nx-err", err[0]) : null,
        el("div", "nx-modal-foot", [
          h("button", { className: "nx-btn nx-btn-ghost", onClick: props.onClose }, "Cancel"),
          h("button", { className: "nx-btn", disabled: sending[0], onClick: submit }, sending[0] ? "Creating…" : "Create mission"),
        ]),
      ]),
    ]);
  }
  function PageModal(props) {
    var p = props.page || {};
    return modalShell(props.onClose, p.ok ? (p.kind + " / " + p.name) : (p.name + " — not found"), [
      p.ok ? el("pre", "nx-pre nx-pre-tall", p.content) : el("div", "nx-note", "No wiki page for “" + p.name + "” yet."),
    ]);
  }
  function modalShell(onClose, title, kids) {
    return h("div", { className: "nx-modal-back", onClick: function (e) { if (e.target === e.currentTarget) onClose(); } },
      el("div", "nx-modal", [
        el("div", "nx-modal-h", [el("div", "nx-modal-title", title), h("button", { className: "nx-x", onClick: onClose }, "✕")]),
        el("div", "nx-modal-body", kids),
      ]));
  }
  function field(label, input) { return el("label", "nx-field", [el("div", "nx-field-l", label), input]); }

  // =========================================================================
  // DELEGATIONS / PROVENANCE — ground truth, not what orq claims
  // =========================================================================
  function nxStatusColor(s) {
    s = (s || "").toLowerCase();
    if (s.indexOf("done") >= 0 || s === "completed") return "#3fb950";
    if (s.indexOf("block") >= 0 || s.indexOf("fail") >= 0 || s.indexOf("error") >= 0) return "#f85149";
    if (s.indexOf("run") >= 0 || s.indexOf("progress") >= 0 || s.indexOf("claim") >= 0) return "#58a6ff";
    if (s.indexOf("review") >= 0) return "#a371f7";
    return "#8b949e";
  }
  function Provenance() {
    var pv = usePoll("provenance");
    var d = (pv && pv.data) || {};
    var sum = d.summary || {};
    var kb = d.kanban || [];
    var trees = d.sessions || [];
    var openSt = useState({}); var openMap = openSt[0], setOpen = openSt[1];
    function toggle(id) { setOpen(function (m) { var n = Object.assign({}, m); n[id] = !n[id]; return n; }); }
    var bySrc = sum.by_source || {};
    return el("div", "nx-prov", [
      el("div", "nx-prov-banner", "⚖  Ground truth — read straight from kanban.db + each agent's state.db. This is what ACTUALLY ran, with evidence — not what orq told you in chat. Compare the two."),
      el("div", "nx-stats", [
        h(Stat, { key: "k", value: sum.kanban_tasks, label: "kanban delegations" }),
        h(Stat, { key: "s", value: sum.sessions_total, label: "sessions on record" }),
        h(Stat, { key: "t", value: sum.delegation_trees, label: "delegation chains" }),
        h(Stat, { key: "c", value: Object.keys(bySrc).length, label: "channels", sub: Object.keys(bySrc).map(function (x) { return x + ":" + bySrc[x]; }).join("  ") }),
      ]),
      Section("Assigned work (kanban) — who → whom, and what the record shows", null,
        kb.length ? el("div", "nx-flowlist", kb.map(function (t) { return nxDelegRow(t, !!openMap["k" + t.id], function () { toggle("k" + t.id); }); }))
          : el("div", "nx-empty", "No kanban tasks on the board. When orq hands work across profiles with kanban_create, each assignment + its real run and evidence shows here.")),
      Section("Call graph (delegate_task / sub-agents) — the actual spawn tree", null,
        trees.length ? el("div", "nx-treelist", trees.map(function (tr, i) { return nxSessTree(tr, i); }))
          : el("div", "nx-empty", "No delegate_task / sub-agent spawns recorded yet. When an agent spawns a child turn, the real parent→child chain shows here with each one's profile, model and tool count.")),
    ]);
  }
  function nxDelegRow(t, isOpen, onToggle) {
    var from = t.created_by || "—", to = t.assignee || "unassigned";
    var col = nxStatusColor(t.status);
    return el("div", "nx-flow", [
      h("div", { className: "nx-flow-head", onClick: onToggle }, [
        el("div", "nx-flow-lane", [
          h("span", { className: "nx-pnode nx-pnode-from" }, from),
          h("span", { className: "nx-parrow" }, "→"),
          h("span", { className: "nx-pnode nx-pnode-to" }, to),
        ]),
        el("div", "nx-flow-mid", [
          el("div", "nx-flow-title", t.title || t.id),
          h("span", { className: "nx-badge", style: { color: col, background: col + "22" } }, t.status || "?"),
          (t.consecutive_failures ? h("span", { className: "nx-badge nx-badge-warn" }, t.consecutive_failures + " fail") : null),
        ]),
        h("span", { className: "nx-caret" }, isOpen ? "▾" : "▸"),
      ]),
      isOpen ? el("div", "nx-flow-body", [
        (t.runs && t.runs.length) ? el("div", "nx-evid", [tagLabel("runs (evidence)"), el("div", "nx-runs", t.runs.map(function (r, i) {
          var rc = nxStatusColor(r.status);
          return el("div", "nx-run", [
            h("span", { key: "s", className: "nx-badge", style: { color: rc, background: rc + "22" } }, r.status || "?"),
            (r.exit_code != null ? h("span", { key: "e", className: "nx-muted" }, "exit " + r.exit_code) : null),
            (r.error ? h("span", { key: "er", className: "nx-muted" }, String(r.error).slice(0, 90)) : null),
            (r.log_path ? h("span", { key: "l", className: "nx-tag" }, "log") : null),
          ]);
        }))]) : el("div", "nx-muted", "no run records for this task"),
        (t.events && t.events.length) ? el("div", "nx-evid", [tagLabel("events"), el("div", "nx-events", t.events.map(function (e, i) {
          return el("div", "nx-ev", [
            h("span", { key: "k", className: "nx-tag" }, e.kind || e.event || e.type || "event"),
            (e.to_status ? h("span", { key: "s", className: "nx-muted" }, (e.from_status ? e.from_status + "→" : "") + e.to_status) : null),
            (e.actor ? h("span", { key: "a", className: "nx-muted" }, "by " + e.actor) : null),
          ]);
        }))]) : null,
        (t.result ? el("div", "nx-evid", [tagLabel("result"), el("pre", "nx-pre", String(t.result))]) : null),
      ]) : null,
    ]);
  }
  function nxSessTree(tr, idx) {
    return el("div", "nx-tree", [
      el("div", "nx-tnode nx-tnode-root", [
        h("span", { className: "nx-tag" }, tr.profile || "?"),
        el("span", "nx-tnode-title", tr.title || tr.id),
        (tr.model ? h("span", { className: "nx-muted" }, tr.model) : null),
        h("span", { className: "nx-muted" }, (tr.tools || 0) + " tools · " + (tr.msgs || 0) + " msg"),
      ]),
      el("div", "nx-tkids", (tr.children || []).map(function (k, i) {
        return el("div", "nx-tnode nx-tnode-child", [
          h("span", { className: "nx-tbranch" }, "└─"),
          h("span", { className: "nx-tag" }, k.profile || "?"),
          el("span", "nx-tnode-title", k.title || k.id),
          (k.model ? h("span", { className: "nx-muted" }, k.model) : null),
          h("span", { className: "nx-muted" }, (k.tools || 0) + " tools · " + (k.msgs || 0) + " msg"),
        ]);
      })),
    ]);
  }

  // =========================================================================
  // MISSION CONTROL — Agent Collaboration Control Center
  // =========================================================================
  function MissionControl() {
    var pv = usePoll("provenance");
    var ag = usePoll("agents");
    var se = usePoll("sessions?limit=12");
    var kb = usePoll("kanban");
    var d = (pv && pv.data) || {};
    var sum = d.summary || {};
    var agents = (ag && ag.data && ag.data.agents) || [];
    var sess = (se && se.data && se.data.sessions) || [];
    var kanban = (kb && kb.data) || {};
    var kbTasks = (kanban.tasks || []).filter(function (t) { return t.status !== "archived"; });
    var kbByStatus = {};
    kbTasks.forEach(function (t) { (kbByStatus[t.status] = kbByStatus[t.status] || []).push(t); });
    var kanbanByAssignee = {};
    kbTasks.forEach(function (t) { if (t.assignee) (kanbanByAssignee[t.assignee] = kanbanByAssignee[t.assignee] || []).push(t); });

    var openFlow = useState({}); var openMap = openFlow[0], setOpenFlow = openFlow[1];
    function toggleFlow(id) { setOpenFlow(function (m) { var n = Object.assign({}, m); n[id] = !n[id]; return n; }); }

    // Agent availability: online if they have recent sessions or active tasks
    var now = Date.now() / 1000;
    var agentAvail = {};
    agents.forEach(function (a) {
      var recent = a.sessions != null && a.sessions > 0;
      var activeTasks = kanbanByAssignee[a.name] ? kanbanByAssignee[a.name].filter(function (t) {
        return ["triage", "todo", "ready", "running", "claimed", "in_progress"].indexOf(t.status) >= 0;
      }).length : 0;
      agentAvail[a.name] = { online: recent || activeTasks > 0, activeTasks: activeTasks, sessions: a.sessions || 0 };
    });

    var bySrc = sum.by_source || {};
    var heavyCount = agents.filter(function (a) { return a.model_meta && a.model_meta.tier === "heavy"; }).length;

    return el("div", "nx-mission", [
      // Header banner
      el("div", "nx-mission-banner", [
        el("div", "nx-mission-title", [
          h("span", { className: "nx-mission-ico" }, "⚡"),
          "Mission Control"
        ]),
        el("div", "nx-mission-sub", "Agent collaboration oversight — live delegation chains, task lifecycles, and crew availability.")
      ]),

      // Top stats row
      el("div", "nx-stats", [
        h(Stat, { key: "kc", value: sum.kanban_tasks, label: "kanban delegations", sub: "cross-profile handoffs" }),
        h(Stat, { key: "dt", value: sum.delegation_trees, label: "delegation chains", sub: "delegate_task spawns" }),
        h(Stat, { key: "st", value: sum.sessions_total, label: "sessions on record", sub: Object.keys(bySrc).length + " channels" }),
        h(Stat, { key: "av", value: agents.filter(function (a) { return agentAvail[a.name].online; }).length, label: "agents online", sub: agents.length + " total crew" }),
        h(Stat, { key: "tk", value: kbTasks.length, label: "tasks on board", sub: (kbByStatus.running || kbByStatus.in_progress || []).length + " active" }),
        h(Stat, { key: "hv", value: heavyCount, label: "heavy 27B models", sub: "one at a time constraint" }),
      ]),

      // Main content: two columns
      el("div", "nx-row2", [
        // Left: Collaboration Timeline (kanban flow)
        Section("Collaboration Timeline — who handed off to whom, and what happened", null,
          (d.kanban && d.kanban.length) ? el("div", "nx-flowlist", d.kanban.map(function (t) {
            return nxMissionFlowRow(t, !!openMap["k" + t.id], function () { toggleFlow("k" + t.id); });
          })) : el("div", "nx-emptybig", "No cross-profile delegations recorded yet.\nWhen orq creates kanban tasks with assignees, each handoff appears here with its full lifecycle.")
        ),

        // Right: Live Agent Status + Active Tasks
        el("div", "nx-mission-right", [
          Section("Crew Availability", null,
            el("div", "nx-avail-grid",
              agents.map(function (a) {
                var av = agentAvail[a.name];
                var isHeavy = a.model_meta && a.model_meta.tier === "heavy";
                return el("div", cx("nx-avail-card", av.online ? "nx-avail-on" : "nx-avail-off"), [
                  el("div", "nx-avail-head", [
                    el("div", "nx-avail-name", [
                      a.is_default ? h("span", { className: "nx-star", title: "default profile" }, "◆") : null,
                      a.name,
                      isHeavy ? h("span", { className: "nx-heavy-tag", title: "27B model — evicts other heavy models" }, "27B") : null,
                    ]),
                    h("span", { className: cx("nx-avail-dot", av.online ? "nx-on" : "nx-off") }),
                  ]),
                  el("div", "nx-avail-meta", [
                    kv("model", a.model || "—"),
                    av.activeTasks > 0 ? kv("active", av.activeTasks) : null,
                    av.sessions ? kv("sessions", av.sessions) : null,
                  ]),
                  (a.mcp && a.mcp.length) ? el("div", "nx-avail-mcp", a.mcp.map(function (m, i) {
                    return h("span", { key: i, className: "nx-tag" }, m);
                  })) : null,
                ]);
              })
            )
          ),

          Section("Active Tasks by Assignee", null,
            kbTasks.length ? el("div", "nx-active-tasks",
              Object.keys(kanbanByAssignee).map(function (assignee) {
                var tasks = kanbanByAssignee[assignee].filter(function (t) {
                  return ["triage", "todo", "ready", "running", "claimed", "in_progress"].indexOf(t.status) >= 0;
                });
                if (!tasks.length) return null;
                return el("div", "nx-assignee-group", [
                  el("div", "nx-assignee-h", [assignee, h("span", { className: "nx-muted" }, tasks.length)]),
                  el("div", "nx-assignee-tasks", tasks.map(function (t) {
                    return el("div", "nx-atask", [
                      el("div", "nx-atask-t", t.title || t.id),
                      el("div", "nx-atask-m", [
                        h("span", { className: "nx-badge", style: { color: nxStatusColor(t.status), background: nxStatusColor(t.status) + "22" } }, t.status),
                        h("span", { className: "nx-muted" }, ago(t.started_at || t.created_at)),
                      ]),
                    ]);
                  })),
                ]);
              })
            ) : el("div", "nx-empty", "No active tasks.")
          ),
        ]),
      ]),

      // Delegation Trees (session spawns)
      Section("Delegation Chains — actual delegate_task / sub-agent spawns", null,
        (d.sessions && d.sessions.length) ? el("div", "nx-treelist", d.sessions.map(function (tr, i) {
          return nxSessTree(tr, i);
        })) : el("div", "nx-empty", "No delegate_task spawns recorded. When an agent spawns a child turn, the real parent→child chain appears here.")
      ),

      // Configuration & Safety
      Section("Collaboration Configuration & Safety", null,
        el("div", "nx-config-grid", [
          configRow("Default Concurrency", "1", "Only one collaboration run at a time."),
          configRow("Max Rounds per Run", "3", "Bounded execution — no overnight or unlimited runs."),
          configRow("Recursive Spawning", "Blocked", "No self-replicating agent creation."),
          configRow("Duplicate Prevention", "Enabled", "Retries do not create duplicate tasks."),
          configRow("Authentication Required", "Yes", "All state changes go through Hermes' authenticated API."),
          configRow("Read-Only Backend", "Enforced", "This dashboard never writes to kanban.db or state.db directly."),
          configRow("Heavy Model Constraint", heavyCount + " profiles", "27B models evict each other — serialized via local router."),
          configRow("Data Source", "Ground Truth", "kanban.db + each profile's state.db — not agent claims."),
        ])
      ),
    ]);
  }

  function nxMissionFlowRow(t, isOpen, onToggle) {
    var from = t.created_by || "—", to = t.assignee || "unassigned";
    var col = nxStatusColor(t.status);
    var hasRuns = t.runs && t.runs.length;
    var hasEvents = t.events && t.events.length;
    return el("div", "nx-flow", [
      h("div", { className: "nx-flow-head", onClick: onToggle }, [
        el("div", "nx-flow-lane", [
          h("span", { className: "nx-pnode nx-pnode-from" }, from),
          h("span", { className: "nx-parrow" }, "→"),
          h("span", { className: "nx-pnode nx-pnode-to" }, to),
        ]),
        el("div", "nx-flow-mid", [
          el("div", "nx-flow-title", t.title || t.id),
          h("span", { className: "nx-badge", style: { color: col, background: col + "22" } }, t.status || "?"),
          (t.consecutive_failures ? h("span", { className: "nx-badge nx-badge-warn" }, t.consecutive_failures + " fail") : null),
          (hasRuns ? h("span", { className: "nx-tag" }, hasRuns + " run" + (hasRuns > 1 ? "s" : "")) : null),
          (hasEvents ? h("span", { className: "nx-tag nx-tag-dim" }, hasEvents + " event" + (hasEvents > 1 ? "s" : "")) : null),
        ]),
        h("span", { className: "nx-caret" }, isOpen ? "▾" : "▸"),
      ]),
      isOpen ? el("div", "nx-flow-body", [
        hasRuns ? el("div", "nx-evid", [
          tagLabel("runs (evidence)"),
          el("div", "nx-runs", t.runs.map(function (r, i) {
            var rc = nxStatusColor(r.status);
            return el("div", "nx-run", [
              h("span", { key: "s", className: "nx-badge", style: { color: rc, background: rc + "22" } }, r.status || "?"),
              (r.exit_code != null ? h("span", { key: "e", className: "nx-muted" }, "exit " + r.exit_code) : null),
              (r.error ? h("span", { key: "er", className: "nx-muted" }, String(r.error).slice(0, 120)) : null),
              (r.log_path ? h("span", { key: "l", className: "nx-tag" }, "log") : null),
              (r.profile ? h("span", { key: "p", className: "nx-tag nx-tag-dim" }, r.profile) : null),
              (r.model ? h("span", { key: "m", className: "nx-tag nx-tag-dim" }, r.model) : null),
            ]);
          })),
        ]) : el("div", "nx-muted", "no run records for this task"),
        hasEvents ? el("div", "nx-evid", [
          tagLabel("events"),
          el("div", "nx-events", t.events.map(function (e, i) {
            return el("div", "nx-ev", [
              h("span", { key: "k", className: "nx-tag" }, e.kind || e.event || e.type || "event"),
              (e.to_status ? h("span", { key: "s", className: "nx-muted" }, (e.from_status ? e.from_status + "→" : "") + e.to_status) : null),
              (e.actor ? h("span", { key: "a", className: "nx-muted" }, "by " + e.actor) : null),
              (e.created_at || e.ts ? h("span", { key: "t", className: "nx-muted" }, ago(e.created_at || e.ts)) : null),
            ]);
          })),
        ]) : null,
        (t.result ? el("div", "nx-evid", [tagLabel("result"), el("pre", "nx-pre", String(t.result))]) : null),
      ]) : null,
    ]);
  }

  function configRow(label, value, desc) {
    return el("div", "nx-config-row", [
      el("div", "nx-config-l", [
        el("div", "nx-config-label", label),
        el("div", "nx-config-desc", desc),
      ]),
      el("div", "nx-config-v", value),
    ]);
  }

  // =========================================================================
  // SHELL
  // =========================================================================
  var NAV = [
    ["cockpit", "Cockpit", "◎"],
    ["mission_control", "Mission Control", "⚡"],
    ["roster", "Roster", "⬡"],
    ["missions", "Missions", "▦"],
    ["provenance", "Delegations", "⇄"],
    ["schedule", "Schedule", "◷"],
    ["memory", "Memory", "❖"],
    ["map", "Agent city", "⌖"],
    ["health", "Health", "♥"],
  ];
  function Nexora() {
    var tab = useState("cockpit"); var t = tab[0], setTab = tab[1];
    var tick = useState(0);
    useEffect(function () { var id = setInterval(function () { tick[1](function (n) { return n + 1; }); }, 1000); return function () { clearInterval(id); }; }, []);
    var go = function (x) { setTab(x); };
    var page;
    if (t === "cockpit") page = h(Cockpit, { go: go });
    else if (t === "mission_control") page = h(MissionControl);
    else if (t === "roster") page = h(Roster);
    else if (t === "missions") page = h(Missions);
    else if (t === "provenance") page = h(Provenance);
    else if (t === "schedule") page = h(Schedule);
    else if (t === "memory") page = h(Memory);
    else if (t === "map") page = h(AgentMap);
    else page = h(Health);

    return el("div", "nx-root", [
      el("div", "nx-topbar", [
        el("div", "nx-brand", [el("span", "nx-brand-n", "NEXORA"), el("span", "nx-brand-s", "OPERATOR SYSTEM")]),
        el("div", "nx-topnav", NAV.map(function (n) {
          return h("button", { key: n[0], className: cx("nx-navbtn", t === n[0] && "nx-navbtn-on"), onClick: function () { setTab(n[0]); } },
            [h("span", { className: "nx-navico" }, n[2]), n[1]]);
        })),
        el("div", "nx-clock", nowStr()),
      ]),
      el("div", "nx-view", page),
    ]);
  }
  function nowStr() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  window.__HERMES_PLUGINS__.register("nexora", Nexora);
})();
