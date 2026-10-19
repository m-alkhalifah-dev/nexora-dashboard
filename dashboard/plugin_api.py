"""NEXORA mission-control backend routes.

Mounted at /api/plugins/nexora/. Reads the Hermes install directly from disk
(profile configs, per-profile state.db + cron, kanban.db, the shared wiki) so it
does not depend on internal Hermes APIs that may change between versions.

Everything here is best-effort and READ-ONLY. Any missing piece degrades to an
empty section instead of a 500. All *writes* (create a kanban task, run a cron
job) are done by the frontend through Hermes' own authenticated REST API, never
from here — this file never opens a DB for writing.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter

router = APIRouter()

# ---------------------------------------------------------------- locations


def hermes_home() -> Path:
    for getter in (
        lambda: __import__("hermes_cli.config_home", fromlist=["get_hermes_home"]).get_hermes_home(),
        lambda: __import__("hermes_constants", fromlist=["get_hermes_home"]).get_hermes_home(),
    ):
        try:
            p = Path(getter())
            if p.exists():
                return p
        except Exception:
            pass
    env = os.environ.get("HERMES_HOME")
    if env and Path(env).exists():
        return Path(env)
    local = os.environ.get("LOCALAPPDATA")
    if local and (Path(local) / "hermes").exists():
        return Path(local) / "hermes"
    return Path.home() / ".hermes"


def root_home() -> Path:
    """The machine root home (unwraps <root>/profiles/<name> -> <root>)."""
    h = hermes_home()
    if h.parent.name.lower() == "profiles":
        return h.parent.parent
    return h


def wiki_dir() -> Path:
    env = os.environ.get("HERMES_WIKI_DIR")
    if env:
        return Path(env)
    return Path(r"D:\Projects\_wiki")


# ---------------------------------------------------------------- roster metadata
# Display grouping. Unknown profiles fall back to "Other" gracefully.
CATEGORY = {
    "default": "Core", "orq": "Core",
    "study": "Academic", "lect": "Academic", "ar": "Academic",
    "research": "Knowledge & web", "rag": "Knowledge & web", "web": "Knowledge & web",
    "office": "Make things", "art": "Make things", "code": "Make things", "lab": "Make things",
    "sec": "Security", "dfir": "Security", "secrep": "Security", "pentest": "Security",
    "pa": "Run the day", "biz": "Run the day", "ops": "Run the day",
}
CATEGORY_ORDER = ["Core", "Academic", "Knowledge & web", "Make things", "Security", "Run the day", "Other"]


def model_meta(model: str) -> dict[str, Any]:
    """tier (heavy models evict each other) + colour, by model family."""
    m = (model or "").lower()
    if any(t in m for t in ("27b", "fanar", "bonsai", "saluki")):
        return {"tier": "heavy", "label": "27B · one at a time", "color": "#f0883e"}   # amber
    if "14b" in m:
        return {"tier": "mid", "label": "14B", "color": "#e3b341"}                      # gold
    if any(t in m for t in ("vl", "vision", "qwen3vl")):
        return {"tier": "vision", "label": "vision · warm", "color": "#a371f7"}          # purple
    if any(t in m for t in ("laguna", "code")):
        return {"tier": "cheap", "label": "cheap", "color": "#3fb950"}                   # green
    if any(t in m for t in ("4b", "8b", "lfm", "qwen3.5")):
        return {"tier": "warm", "label": "always warm", "color": "#58a6ff"}              # blue
    if model:
        return {"tier": "cloud", "label": "cloud/other", "color": "#8b949e"}
    return {"tier": "other", "label": "", "color": "#8b949e"}


def _read(p: Path, cap: int = 100_000) -> str:
    try:
        return p.read_text(encoding="utf-8-sig")[:cap]
    except OSError:
        return ""


def _load_yaml(p: Path) -> dict:
    try:
        d = yaml.safe_load(p.read_text(encoding="utf-8-sig"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _role_from_soul(soul: str) -> str:
    for line in soul.splitlines():
        s = line.strip()
        if not s or s.startswith("<!--") or s.startswith("#"):
            continue
        return s[:200]
    return ""


def _profiles_dir() -> Path:
    return root_home() / "profiles"


def _ro(db: Path, timeout: float = 2.0) -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=timeout)
    c.row_factory = sqlite3.Row
    return c


def _session_count(profile_dir: Path) -> int | None:
    sdb = profile_dir / "state.db"
    if not sdb.exists():
        return None
    try:
        c = _ro(sdb)
        n = c.execute("SELECT COUNT(*) FROM sessions WHERE COALESCE(archived,0)=0 AND COALESCE(hidden,0)=0").fetchone()[0]
        c.close()
        return int(n)
    except Exception:
        return None


# ---------------------------------------------------------------- agents


def _agent(profile_dir: Path) -> dict[str, Any]:
    name = profile_dir.name
    cfg = _load_yaml(profile_dir / "config.yaml")
    prof = _load_yaml(profile_dir / "profile.yaml")
    soul = _read(profile_dir / "SOUL.md", 8000)

    mdl = cfg.get("model") or {}
    model = mdl.get("default") or ""
    base_url = mdl.get("base_url") or ""
    agent_cfg = cfg.get("agent") or {}
    effort = agent_cfg.get("reasoning_effort") or ""
    max_turns = agent_cfg.get("max_turns")
    toolsets = ((cfg.get("platform_toolsets") or {}).get("cli")) or []
    mcp = sorted((cfg.get("mcp_servers") or {}).keys())
    skills_dirs = (cfg.get("skills") or {}).get("external_dirs") or []
    hooks = sorted((cfg.get("hooks") or {}).keys())
    fallbacks = [
        f"{fp.get('provider', '?')}/{fp.get('model', '?')}"
        for fp in (cfg.get("fallback_providers") or [])
        if isinstance(fp, dict)
    ]
    desc = cfg.get("description") or prof.get("description") or _role_from_soul(soul)
    alias = prof.get("alias") or prof.get("aliases")

    has_lesson = (wiki_dir() / "profiles" / f"{name}.md").exists()

    return {
        "name": name,
        "category": CATEGORY.get(name, "Other"),
        "role": (desc or "").strip(),
        "model": model,
        "model_meta": model_meta(model),
        "effort": effort,
        "max_turns": max_turns,
        "base_url": base_url,
        "toolsets": toolsets,
        "toolset_count": len(toolsets),
        "mcp": mcp,
        "skills_dirs": skills_dirs,
        "hooks": hooks,
        "fallbacks": fallbacks,
        "soul_chars": len(soul),
        "has_wiki_lesson": has_lesson,
        "sessions": _session_count(profile_dir),
        "is_default": name == "default",
    }


def _all_agents() -> list[dict[str, Any]]:
    pdir = _profiles_dir()
    out: list[dict[str, Any]] = []
    if pdir.exists():
        for d in sorted(pdir.iterdir()):
            if d.is_dir() and (d / "config.yaml").exists():
                try:
                    out.append(_agent(d))
                except Exception as exc:
                    out.append({"name": d.name, "category": "Other", "role": f"(parse error: {exc})",
                                "model": "", "model_meta": model_meta(""), "effort": "", "toolsets": [],
                                "toolset_count": 0, "mcp": [], "skills_dirs": [], "hooks": [], "fallbacks": [],
                                "has_wiki_lesson": False, "sessions": None, "is_default": False})
    out.sort(key=lambda a: (CATEGORY_ORDER.index(a["category"]) if a["category"] in CATEGORY_ORDER else 99, a["name"]))
    return out


@router.get("/agents")
def agents() -> dict[str, Any]:
    ags = _all_agents()
    return {"agents": ags, "category_order": CATEGORY_ORDER, "home": str(root_home())}


# ---------------------------------------------------------------- wiki


@router.get("/wiki")
def wiki() -> dict[str, Any]:
    w = wiki_dir()
    hot = _read(w / "hot.md", 8000)
    index = _read(w / "index.md", 8000)
    log_lines = [l for l in _read(w / "log.md", 24000).splitlines() if l.strip() and not l.startswith("#")]
    topics = sorted(p.stem for p in (w / "topics").glob("*.md")) if (w / "topics").exists() else []
    profiles = sorted(p.stem for p in (w / "profiles").glob("*.md")) if (w / "profiles").exists() else []
    return {
        "exists": w.exists(),
        "path": str(w),
        "hot": hot,
        "index": index,
        "log_recent": log_lines[-20:][::-1],
        "topics": topics,
        "profiles": profiles,
        "counts": {"topics": len(topics), "profiles": len(profiles), "log": len(log_lines)},
    }


_SAFE_SLUG = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


@router.get("/wiki_page")
def wiki_page(name: str = "", kind: str = "topics") -> dict[str, Any]:
    """Read one wiki page. kind: topics | profiles | root (hot/index/log/SCHEMA)."""
    w = wiki_dir()
    if kind == "root":
        if name not in ("hot", "index", "log", "SCHEMA"):
            return {"ok": False, "error": "unknown root page"}
        p = w / f"{name}.md"
    else:
        if kind not in ("topics", "profiles") or not _SAFE_SLUG.match(name):
            return {"ok": False, "error": "bad name"}
        p = w / kind / f"{name}.md"
    # Defence in depth: resolved path must stay inside the wiki dir.
    try:
        p.resolve().relative_to(w.resolve())
    except (ValueError, OSError):
        return {"ok": False, "error": "path escapes wiki"}
    if not p.exists():
        return {"ok": False, "error": "not found"}
    return {"ok": True, "name": name, "kind": kind, "path": str(p), "content": _read(p, 60_000)}


# ---------------------------------------------------------------- kanban


def _kanban_db() -> Path:
    return root_home() / "kanban.db"


@router.get("/kanban")
def kanban() -> dict[str, Any]:
    db = _kanban_db()
    if not db.exists():
        return {"exists": False, "tasks": [], "by_status": {}, "by_assignee": {}}
    tasks: list[dict[str, Any]] = []
    try:
        c = _ro(db)
        cols = [r[1] for r in c.execute("PRAGMA table_info(tasks)").fetchall()]
        wanted = ["id", "title", "assignee", "status", "priority", "created_at", "started_at",
                  "completed_at", "tenant", "result", "consecutive_failures", "workspace_kind"]
        sel = [c0 for c0 in wanted if c0 in cols]
        where = "WHERE COALESCE(status,'') != 'archived'" if "status" in cols else ""
        rows = c.execute(
            f"SELECT {','.join(sel)} FROM tasks {where} ORDER BY COALESCE(started_at,created_at) DESC LIMIT 60"
        ).fetchall()
        tasks = [dict(r) for r in rows]
        c.close()
    except Exception as exc:
        return {"exists": True, "error": str(exc), "tasks": [], "by_status": {}, "by_assignee": {}}
    by_status: dict[str, int] = {}
    by_assignee: dict[str, int] = {}
    for t in tasks:
        s = t.get("status") or "unknown"
        by_status[s] = by_status.get(s, 0) + 1
        if t.get("assignee"):
            by_assignee[t["assignee"]] = by_assignee.get(t["assignee"], 0) + 1
    return {"exists": True, "tasks": tasks, "by_status": by_status, "by_assignee": by_assignee}


# ---------------------------------------------------------------- cron (aggregate all profiles)


def _profile_cron_jobs(profile_dir: Path) -> list[dict[str, Any]]:
    """Read a profile's cron jobs from jobs.json (absent when it has none)."""
    jf = profile_dir / "cron" / "jobs.json"
    if not jf.exists():
        return []
    try:
        data = json.loads(jf.read_text(encoding="utf-8-sig"))
    except Exception:
        return []
    jobs = data.get("jobs") if isinstance(data, dict) else data
    if not isinstance(jobs, list):
        return []
    out = []
    for j in jobs:
        if not isinstance(j, dict):
            continue
        prompt = j.get("prompt") or j.get("task") or ""
        sched = j.get("schedule_display")
        if not sched:
            sraw = j.get("schedule") or j.get("cron") or j.get("expression") or ""
            sched = (sraw.get("display") or sraw.get("expr")) if isinstance(sraw, dict) else sraw
        state = j.get("state") or ""
        out.append({
            "id": j.get("id") or j.get("job_id") or "",
            "name": j.get("name") or "",
            "schedule": sched or "",
            "enabled": j.get("enabled", True),
            "paused": bool(j.get("paused_at")) or state == "paused",
            "deliver": j.get("deliver") or j.get("delivery") or "local",
            "silent_rule": "[SILENT]" in (prompt or ""),
            "prompt_preview": (prompt or "")[:160],
            "last_status": j.get("last_status") or j.get("last_run_status") or "",
            "next_run_at": j.get("next_run_at") or j.get("next_run"),
            "last_run_at": j.get("last_run_at") or j.get("last_run"),
        })
    return out


def _cron_heartbeat(profile_dir: Path) -> dict[str, Any]:
    cdir = profile_dir / "cron"
    hb = _read(cdir / "ticker_heartbeat", 64).strip()
    last = _read(cdir / "ticker_last_success", 64).strip()
    execs = 0
    edb = cdir / "executions.db"
    if edb.exists():
        try:
            c = _ro(edb)
            execs = c.execute("SELECT COUNT(*) FROM executions").fetchone()[0]
            c.close()
        except Exception:
            pass
    return {"heartbeat": hb, "last_success": last, "executions": execs}


@router.get("/cron")
def cron() -> dict[str, Any]:
    pdir = _profiles_dir()
    profiles_out: list[dict[str, Any]] = []
    all_jobs: list[dict[str, Any]] = []
    total_exec = 0
    # root home (default profile stores cron under root/cron, profiles under profiles/<n>/cron)
    roots: list[tuple[str, Path]] = [("default", root_home())]
    if pdir.exists():
        for d in sorted(pdir.iterdir()):
            if d.is_dir():
                roots.append((d.name, d))
    for name, base in roots:
        jobs = _profile_cron_jobs(base)
        hb = _cron_heartbeat(base)
        total_exec += hb["executions"]
        for j in jobs:
            j["profile"] = name
            all_jobs.append(j)
        if jobs or hb["executions"]:
            profiles_out.append({"profile": name, "jobs": len(jobs), **hb})
    quiet = sum(1 for j in all_jobs if j.get("silent_rule"))
    return {
        "jobs": all_jobs,
        "job_count": len(all_jobs),
        "quiet_count": quiet,
        "executions_total": total_exec,
        "profiles": profiles_out,
    }


# ---------------------------------------------------------------- recent sessions (across profiles)


@router.get("/sessions")
def sessions(limit: int = 12) -> dict[str, Any]:
    out: list[dict[str, Any]] = []
    roots: list[tuple[str, Path]] = [("default", root_home() / "state.db")]
    pdir = _profiles_dir()
    if pdir.exists():
        for d in sorted(pdir.iterdir()):
            if d.is_dir() and (d / "state.db").exists():
                roots.append((d.name, d / "state.db"))
    for name, sdb in roots:
        if not sdb.exists():
            continue
        try:
            c = _ro(sdb)
            cols = [r[1] for r in c.execute("PRAGMA table_info(sessions)").fetchall()]
            order = "last_activity_at" if "last_activity_at" in cols else "started_at"
            sel = [x for x in ("id", "title", "source", "model", "message_count", "tool_call_count",
                               "started_at", "last_activity_at") if x in cols]
            rows = c.execute(
                f"SELECT {','.join(sel)} FROM sessions "
                f"WHERE COALESCE(hidden,0)=0 ORDER BY {order} DESC LIMIT 6"
            ).fetchall()
            for r in rows:
                d0 = dict(r)
                d0["profile"] = name
                out.append(d0)
            c.close()
        except Exception:
            continue
    out.sort(key=lambda s: s.get("last_activity_at") or s.get("started_at") or 0, reverse=True)
    return {"sessions": out[:limit]}


# ---------------------------------------------------------------- routing (from orq SOUL)


@router.get("/routing")
def routing() -> dict[str, Any]:
    orq = _profiles_dir() / "orq" / "SOUL.md"
    soul = _read(orq, 12000)
    rows: list[dict[str, str]] = []
    for line in soul.splitlines():
        s = line.strip()
        if s.startswith("|") and s.count("|") >= 3:
            cells = [c.strip() for c in s.strip("|").split("|")]
            if len(cells) >= 3 and "---" not in cells[0] and cells[0].lower() not in ("work",):
                rows.append({"work": cells[0], "profile": cells[1], "model": cells[2]})
    # the one-big-model constraint text
    constraint = ""
    m = re.search(r"one big model at a time.*?(?=\n##|\Z)", soul, re.S | re.I)
    if m:
        constraint = m.group(0).strip()[:1200]
    return {"exists": orq.exists(), "rows": rows, "constraint": constraint, "soul_chars": len(soul)}


# ---------------------------------------------------------------- overview


@router.get("/overview")
def overview() -> dict[str, Any]:
    ag = _all_agents()
    models: dict[str, int] = {}
    tiers: dict[str, int] = {}
    with_mcp = with_lessons = total_sessions = 0
    for a in ag:
        models[a["model"]] = models.get(a["model"], 0) + 1
        tiers[a["model_meta"]["tier"]] = tiers.get(a["model_meta"]["tier"], 0) + 1
        if a["mcp"]:
            with_mcp += 1
        if a["has_wiki_lesson"]:
            with_lessons += 1
        if isinstance(a.get("sessions"), int):
            total_sessions += a["sessions"]
    w = wiki()
    k = kanban()
    cr = cron()
    active = sum(v for s, v in k.get("by_status", {}).items()
                 if s in ("in_progress", "running", "claimed", "ready"))
    return {
        "generated_at": int(time.time()),
        "agents_total": len(ag),
        "models_distinct": len([m for m in models if m]),
        "tiers": tiers,
        "heavy_agents": tiers.get("heavy", 0),
        "agents_with_mcp": with_mcp,
        "agents_with_lessons": with_lessons,
        "lesson_coverage_pct": round(100 * with_lessons / len(ag)) if ag else 0,
        "total_sessions": total_sessions,
        "wiki_ok": w["exists"],
        "wiki_topics": w["counts"]["topics"],
        "wiki_profiles": w["counts"]["profiles"],
        "kanban_active": active,
        "kanban_total": len(k.get("tasks", [])),
        "kanban_by_status": k.get("by_status", {}),
        "cron_jobs": cr["job_count"],
        "cron_quiet": cr["quiet_count"],
        "cron_executions": cr["executions_total"],
    }


@router.get("/health")
def health() -> dict[str, Any]:
    """Light host snapshot. Falls back gracefully if psutil is unavailable."""
    out: dict[str, Any] = {"ok": True}
    try:
        import psutil  # type: ignore
        vm = psutil.virtual_memory()
        du = psutil.disk_usage(str(root_home()))
        out.update({
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "cpu_count": psutil.cpu_count(),
            "mem_total": vm.total, "mem_used": vm.used, "mem_percent": vm.percent,
            "disk_total": du.total, "disk_used": du.used, "disk_percent": du.percent,
        })
    except Exception as exc:
        out["ok"] = False
        out["error"] = str(exc)
    # local llama.cpp router reachability (the "one big model" host).
    # Probe both concurrently so a down router can't stack timeouts.
    try:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as ex:
            f1 = ex.submit(_probe_router, "http://127.0.0.1:8080/v1/models")
            f2 = ex.submit(_probe_router, "http://127.0.0.1:8086/v1/models")
            out["llm_router"] = f1.result()
            out["pentest_router"] = f2.result()
    except Exception:
        out["llm_router"] = _probe_router("http://127.0.0.1:8080/v1/models")
        out["pentest_router"] = _probe_router("http://127.0.0.1:8086/v1/models")
    return out


def _probe_router(url: str) -> dict[str, Any]:
    try:
        import urllib.request
        with urllib.request.urlopen(url, timeout=0.6) as r:  # noqa: S310 (localhost only)
            data = json.loads(r.read().decode("utf-8", "replace"))
        models = [m.get("id") for m in (data.get("data") or []) if isinstance(m, dict)]
        return {"up": True, "models": [m for m in models if m][:12]}
    except Exception:
        return {"up": False, "models": []}


# ---------------------------------------------------------------- provenance
# Ground-truth delegation record: read straight from kanban.db + each profile's
# state.db. This is what ACTUALLY ran — independent of what orq (or any agent)
# claims in chat. Read-only.


def _tcols(c: sqlite3.Connection, table: str) -> list[str]:
    try:
        return [r[1] for r in c.execute(f"PRAGMA table_info({table})").fetchall()]
    except Exception:
        return []


@router.get("/provenance")
def provenance(limit: int = 40) -> dict[str, Any]:
    out: dict[str, Any] = {"kanban": [], "sessions": [], "summary": {}}

    # --- kanban: durable cross-profile handoffs (created_by -> assignee) ---
    db = _kanban_db()
    if db.exists():
        try:
            c = _ro(db)
            tcols = _tcols(c, "tasks")
            want = ["id", "title", "assignee", "created_by", "status", "priority", "created_at",
                    "started_at", "completed_at", "result", "consecutive_failures"]
            sel = [x for x in want if x in tcols] or ["id"]
            ev_cols = _tcols(c, "task_events")
            run_cols = _tcols(c, "task_runs")
            rows = c.execute(
                f"SELECT {','.join(sel)} FROM tasks ORDER BY COALESCE(started_at,created_at) DESC LIMIT ?",
                (limit,)).fetchall()
            for r in rows:
                t = dict(r)
                tid = t.get("id")
                events: list[dict[str, Any]] = []
                if ev_cols and tid is not None:
                    tcol = "created_at" if "created_at" in ev_cols else ("ts" if "ts" in ev_cols else None)
                    order = f" ORDER BY {tcol}" if tcol else ""
                    try:
                        for er in c.execute(f"SELECT * FROM task_events WHERE task_id=?{order} LIMIT 40", (tid,)).fetchall():
                            ed = dict(er)
                            events.append({k: ed.get(k) for k in
                                           ("kind", "event", "type", "actor", "from_status", "to_status",
                                            "created_at", "ts", "note") if k in ed})
                    except Exception:
                        pass
                runs: list[dict[str, Any]] = []
                if run_cols and tid is not None:
                    try:
                        for rr in c.execute(f"SELECT * FROM task_runs WHERE task_id=? LIMIT 20", (tid,)).fetchall():
                            rd = dict(rr)
                            runs.append({k: rd.get(k) for k in
                                         ("id", "run_id", "status", "started_at", "ended_at", "exit_code",
                                          "error", "log_path", "pid", "profile", "model") if k in rd})
                    except Exception:
                        pass
                res = t.get("result")
                t["result"] = res[:600] if isinstance(res, str) else res
                t["events"] = events
                t["runs"] = runs
                out["kanban"].append(t)
            c.close()
        except Exception as exc:
            out["kanban_error"] = str(exc)

    # --- session call-graph: delegate_task / sub-agent spawns (parent_session_id) ---
    roots: list[tuple[str, Path]] = [("default", root_home() / "state.db")]
    pdir = _profiles_dir()
    if pdir.exists():
        for d in sorted(pdir.iterdir()):
            if d.is_dir() and (d / "state.db").exists():
                roots.append((d.name, d / "state.db"))
    nodes: dict[str, dict[str, Any]] = {}
    for pname, sdb in roots:
        if not sdb.exists():
            continue
        try:
            c = _ro(sdb)
            scols = _tcols(c, "sessions")
            order = "last_activity_at" if "last_activity_at" in scols else "started_at"
            sel = [x for x in ("id", "title", "source", "model", "parent_session_id", "message_count",
                               "tool_call_count", "started_at", "last_activity_at", "profile_name") if x in scols]
            for sr in c.execute(
                    f"SELECT {','.join(sel)} FROM sessions WHERE COALESCE(hidden,0)=0 "
                    f"ORDER BY {order} DESC LIMIT 80").fetchall():
                sd = dict(sr)
                sd["profile"] = sd.get("profile_name") or pname
                nodes[sd["id"]] = sd
            c.close()
        except Exception:
            continue
    children: dict[str, list[str]] = {}
    for sid, sd in nodes.items():
        pid = sd.get("parent_session_id")
        if pid:
            children.setdefault(pid, []).append(sid)

    def _node(sd: dict[str, Any]) -> dict[str, Any]:
        return {"id": sd.get("id"), "profile": sd.get("profile"), "model": sd.get("model"),
                "title": sd.get("title"), "source": sd.get("source"),
                "tools": sd.get("tool_call_count"), "msgs": sd.get("message_count"),
                "at": sd.get("last_activity_at") or sd.get("started_at")}

    trees: list[dict[str, Any]] = []
    parents = sorted((p for p in children if p in nodes),
                     key=lambda p: nodes[p].get("last_activity_at") or nodes[p].get("started_at") or 0,
                     reverse=True)
    for pid in parents[:20]:
        p = _node(nodes[pid])
        p["children"] = [_node(nodes[cid]) for cid in children.get(pid, []) if cid in nodes]
        trees.append(p)
    out["sessions"] = trees

    by_src: dict[str, int] = {}
    for sd in nodes.values():
        by_src[sd.get("source") or "?"] = by_src.get(sd.get("source") or "?", 0) + 1
    out["summary"] = {
        "kanban_tasks": len(out["kanban"]),
        "sessions_total": len(nodes),
        "delegation_trees": len(trees),
        "by_source": by_src,
        "generated_at": int(time.time()),
        "note": "Read directly from kanban.db + each profile's state.db — what actually ran, not what any agent reported.",
    }
    return out
