"use strict";
var IS_NATIVE = !!(window.Android && window.Android.schedule);
var CAP = { framed: !!(window.claude && window.claude.use) };
/* ================= 常量 ================= */
var KEY = "teacher_schedule_v1";
var WD = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
var PORDER = ["1-2", "3-4", "5-6", "7-8", "9-10"];
var DAYC = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* 学校作息（2020-2021 第二学期作息表；4、5号楼第3-4节单独时间） */
function defaultPeriods() {
  return {
    "1-2": { t: ["08:10", "09:50"], in: ["07:35", "08:00"], out: ["09:50", "10:20"] },
    "3-4": { t: ["10:30", "12:10"], in: ["10:05", "10:30"], out: ["12:10", "12:40"],
             alt: { t: ["10:10", "11:50"], in: ["09:45", "10:10"], out: ["11:50", "12:20"] } },
    "5-6": { t: ["14:40", "16:20"], in: ["14:05", "14:30"], out: ["16:20", "16:50"] },
    "7-8": { t: ["16:40", "18:20"], in: ["16:15", "16:40"], out: ["18:20", "18:50"] },
    "9-10": { t: ["19:00", "20:40"], in: ["18:35", "19:00"], out: ["20:40", "21:10"] }
  };
}
function mkCourse(day, p, name, cls, room) { return { id: uid(), day: day, p: p, name: name, cls: cls, room: room, w1: 2, w2: 19, par: 0 }; }
function sem2026a() {
  return {
    id: "2026-2027-1", name: "2026-2027学年第一学期", start: "2026-08-31", weeks: 20,
    holidays: [
      { from: "2026-09-25", to: "2026-09-27", label: "中秋节放假" },
      { from: "2026-10-01", to: "2026-10-07", label: "国庆节放假" },
      { from: "2027-01-01", to: "2027-01-03", label: "元旦放假" }
    ],
    makeups: [
      { date: "2026-09-20", asDay: 5, par: 2, label: "补周五的课（双周）" },
      { date: "2026-10-10", asDay: 5, par: 1, label: "补周五的课（单周）" }
    ],
    events: [
      { date: "2026-12-12", label: "大学英语四六级考试" },
      { date: "2027-01-08", label: "考查课结束" },
      { date: "2027-01-09", label: "期末集中实训、考试周开始（至1月15日）" }
    ],
    courses: (window.PRESET && PRESET.courses) ? PRESET.courses.map(function (c) { return mkCourse(c[0], c[1], c[2], c[3], c[4]); }) : []
  };
}
function defaults() {
  return { v: 2, notifOn: true, altBuildings: "4,5", periods: defaultPeriods(), semesters: [sem2026a()], activeId: "2026-2027-1", notes: [], punched: {}, adjust: [], journal: {}, journalOn: true };
}

/* ================= 存储 & 迁移 ================= */
function migrate(s) {
  if (!s) return defaults();
  if (s.v === 2) return s;
  // v1 → v2：课程迁入 2026-2027 第一学期，作息改为学校作息表，记事保留
  var n = defaults();
  var sem = n.semesters[0];
  if (s.courses && s.courses.length) sem.courses = s.courses.map(function (c) { c.par = c.par || 0; return c; });
  n.notes = (s.notes || []).map(function (x) { x.semId = sem.id; return x; });
  return n;
}
function loadState() {
  var raw = null;
  try { if (window.Android && Android.load) raw = Android.load(); } catch (e) {}
  if (!raw) { try { raw = localStorage.getItem(KEY); } catch (e) {} }
  var s = null;
  if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
  return migrate(s);
}
function save() {
  PCACHE = {};
  cloudQueue();
  var raw = JSON.stringify(S, function (k, v) { return k === "_seq" ? undefined : v; });
  try { if (window.Android && Android.save) Android.save(raw); } catch (e) {}
  try { localStorage.setItem(KEY, raw); } catch (e) {}
  reschedule();
}
var S = loadState();
function ensureFields() {
  if (!S.punched) S.punched = {};
  if (!S.adjust) S.adjust = [];
  if (!S.journal) S.journal = {};
  if (S.journalOn === undefined) S.journalOn = true;
  if (!S.journalSince) S.journalSince = ymd(new Date());
  if (!S.rosters) S.rosters = {};
  if (window.PRESET && PRESET.rosters && !S.rosterSeeded) {
    Object.keys(PRESET.rosters).forEach(function (cls) {
      if (!S.rosters[cls] || !S.rosters[cls].length) S.rosters[cls] = PRESET.rosters[cls].map(function (x) { return { id: String(x[0]), name: x[1], st: "在读" }; });
    });
    S.rosterSeeded = true;
  }
}
ensureFields();

/* ================= 时间工具 ================= */
function pad(n) { return (n < 10 ? "0" : "") + n; }
function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseYmd(s) { var a = s.split("-"); return new Date(+a[0], +a[1] - 1, +a[2]); }
function dow(d) { var x = d.getDay(); return x === 0 ? 7 : x; }
function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function mondayOf(d) { var m = day0(d); m.setDate(m.getDate() - (dow(m) - 1)); return m; }
function at(d, hm) { var a = hm.split(":"); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +a[0], +a[1]); }
function md(d) { return (d.getMonth() + 1) + "/" + d.getDate(); }
function pLabel(p) { return p.replace("-", "–") + "节"; }

/* ================= 学期 ================= */
function semRange(sem) { var s = parseYmd(sem.start); return [s, addDays(s, sem.weeks * 7)]; }
function semFor(d) {
  var x = day0(d);
  return S.semesters.find(function (s) { var r = semRange(s); return x >= r[0] && x < r[1]; }) || null;
}
function curSem() {
  return semFor(new Date()) || S.semesters.find(function (s) { return s.id === S.activeId; }) || S.semesters[0] || null;
}
function weekOf(d, sem) {
  sem = sem || semFor(d) || curSem(); if (!sem) return 0;
  return Math.floor(Math.round((mondayOf(d) - parseYmd(sem.start)) / 864e5) / 7) + 1;
}
function holidayOn(d, sem) { var s = ymd(d); return (sem.holidays || []).find(function (h) { return s >= h.from && s <= h.to; }); }
function makeupOn(d, sem) { var s = ymd(d); return (sem.makeups || []).find(function (m) { return m.date === s; }); }
function eventsOn(d, sem) { var s = ymd(d); return (sem && sem.events || []).filter(function (e) { return e.date === s; }); }
function dayInfo(d) {
  var sem = semFor(d);
  if (!sem) return { sem: null, label: "假期（不在任何学期内）" };
  var h = holidayOn(d, sem); if (h) return { sem: sem, holiday: h, label: h.label || "放假" };
  var m = makeupOn(d, sem); if (m) return { sem: sem, makeup: m, label: m.label || ("补" + WD[m.asDay] + "的课") };
  return { sem: sem };
}

/* ================= 教学楼 & 作息 ================= */
function bld(room) { var m = String(room || "").match(/^\s*(\d)/); return m ? +m[1] : 0; }
function isAltB(b) { return String(S.altBuildings || "").split(/[,，、\s]+/).indexOf(String(b)) >= 0; }
function timesFor(co) {
  var p = S.periods[co.p]; if (!p) return null;
  var b = bld(co.room), alt = p.alt && isAltB(b) && p.alt.t && p.alt.t[0] ? p.alt : null;
  return {
    t: alt ? alt.t : p.t,
    in: alt && alt.in && alt.in[0] ? alt.in : p.in,
    out: alt && alt.out && alt.out[0] ? alt.out : p.out,
    alt: !!alt, b: b
  };
}

/* ================= 上课实例 ================= */
function mkOcc(co, d, sem, w, adj) {
  var tm = timesFor(co); if (!tm) return null;
  return {
    co: co, tm: tm, week: w, date: ymd(d), sem: sem, oid: ymd(d) + "_" + co.p, adj: adj || null,
    start: at(d, tm.t[0]), end: at(d, tm.t[1]),
    inS: tm.in ? at(d, tm.in[0]) : null, inE: tm.in ? at(d, tm.in[1]) : null,
    outS: tm.out ? at(d, tm.out[0]) : null, outE: tm.out ? at(d, tm.out[1]) : null
  };
}
/* 按课表推出某天的常规课（不含调课） */
function regularOn(d) {
  var info = dayInfo(d), sem = info.sem;
  if (!sem || info.holiday) return [];
  var w = weekOf(d, sem);
  var wd = info.makeup ? info.makeup.asDay : dow(d);
  var par = info.makeup && info.makeup.par ? info.makeup.par : (w % 2 ? 1 : 2);
  return sem.courses.filter(function (co) {
    return co.day === wd && w >= co.w1 && w <= co.w2 && (!co.par || co.par === par);
  });
}
function courseById(id) { return allCourses().find(function (c) { return c.id === id; }); }
function adjFor(ds, cid) { return (S.adjust || []).find(function (a) { return a.odate === ds && a.cid === cid && a.kind !== "add"; }); }
function occurrencesOn(d) {
  var ds = ymd(d), sem = semFor(d), w = sem ? weekOf(d, sem) : 0, out = [];
  regularOn(d).forEach(function (co) {
    if (adjFor(ds, co.id)) return; // 已调走或停课
    var o = mkOcc(co, d, sem, w); if (o) out.push(o);
  });
  (S.adjust || []).forEach(function (a) {
    if (a.kind === "cancel" || a.date !== ds) return;
    var base = a.kind === "move" ? courseById(a.cid) : null;
    var co = Object.assign({}, base || { id: "x" + a.id, name: a.name, cls: a.cls, day: dow(d), w1: 1, w2: 30, par: 0 }, { p: a.p, room: a.room || (base ? base.room : "") });
    var o = mkOcc(co, d, sem || curSem(), w || weekOf(d), a); if (o) out.push(o);
  });
  out.sort(function (a, b) { return a.start - b.start; });
  return out;
}
function occurrences(from, days) {
  var out = [];
  for (var i = 0; i < days; i++) out = out.concat(occurrencesOn(addDays(from, i)));
  return out;
}
function ckey(co) { return co.cls + "｜" + co.name; }
function notesFor(key) { return S.notes.filter(function (n) { return n.key === key; }).sort(function (a, b) { return b.ts - a.ts; }); }
function noteForOcc(o) { return S.notes.find(function (n) { return n.oid === o.oid && n.key === ckey(o.co); }); }
function punched(o, kind) { return !!S.punched[o.oid + "|" + kind]; }
/* 打卡规则：每天上午、下午各打一次上班卡、一次下班卡（晚上的课并入下午）。
   上班卡 = 该时段第一节课的“上课打卡”时间段；下班卡 = 该时段最后一节课的“下课打卡”时间段。 */
var PCACHE = {};
function halfOf(o) { return o.start.getHours() < 12 ? "am" : "pm"; }
function punchesOn(d) {
  var ds = ymd(d);
  if (PCACHE[ds]) return PCACHE[ds];
  var occ = occurrencesOn(d), out = [];
  ["am", "pm"].forEach(function (hf) {
    var l = occ.filter(function (o) { return halfOf(o) === hf; });
    if (!l.length) return;
    var f = l[0], z = l[l.length - 1], tag = hf === "am" ? "上午" : "下午";
    if (f.inS) out.push({ key: ds + "|" + hf + "|in", kind: "in", half: hf, tag: tag, name: tag + "上班打卡", s: f.inS, e: f.inE, o: f, n: l.length });
    if (z.outS) out.push({ key: ds + "|" + hf + "|out", kind: "out", half: hf, tag: tag, name: tag + "下班打卡", s: z.outS, e: z.outE, o: z, n: l.length });
  });
  return (PCACHE[ds] = out);
}
function isPunched(p) { return !!S.punched[p.key]; }
function punchesFor(o) { return punchesOn(parseYmd(o.date)).filter(function (p) { return p.o.oid === o.oid; }); }
function halfPunches(o) { var hf = halfOf(o); return punchesOn(parseYmd(o.date)).filter(function (p) { return p.half === hf; }); }

function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  var s = Math.floor(ms / 1000), d = Math.floor(s / 86400); s %= 86400;
  var h = Math.floor(s / 3600); s %= 3600; var m = Math.floor(s / 60); s %= 60;
  if (d > 0) return d + "天 " + h + "小时" + (d < 3 ? " " + m + "分" : "");
  return (h > 0 ? pad(h) + ":" : "") + pad(m) + ":" + pad(s);
}
function relDay(d) {
  var n = Math.round((day0(d) - day0(new Date())) / 864e5);
  if (n === 0) return "今天"; if (n === 1) return "明天"; if (n === 2) return "后天";
  return md(d);
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function short(cls) { return String(cls).replace(/[(（]国际[)）]/, ""); }
function jsq(s) { return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }

/* ================= 系统通知（打卡提醒） ================= */
function reschedule() {
  try { if (!(window.Android && Android.schedule)) return; } catch (e) { return; }
  var list = [];
  if (S.notifOn) {
    var now = Date.now();
    for (var di = 0; di < 8; di++) {
      punchesOn(addDays(new Date(), di)).forEach(function (p) {
        if (isPunched(p)) return;
        var o = p.o, where = o.co.room + " · " + short(o.co.cls), altTip = o.tm.alt ? "（" + o.tm.b + "号楼时间）" : "";
        if (p.kind === "in") {
          if (p.s - now > 0) list.push({ at: p.s.getTime(), title: "⏰ " + p.name + " " + hm(p.s) + "–" + hm(p.e) + altTip, text: p.tag + "第一节 " + hm(o.start) + " 上课 · " + where });
          var late = p.e.getTime() - 5 * 60000;
          if (late - now > 0) list.push({ at: late, title: "⚠ " + p.name + "还剩 5 分钟", text: "截止 " + hm(p.e) + " · 打过了请在 App 里点“我已打卡”" });
        } else if (p.s - now > 0) {
          list.push({ at: p.s.getTime(), title: "⏰ " + p.name + " " + hm(p.s) + "–" + hm(p.e) + altTip, text: (p.half === "am" ? "上午的课结束了" : "今天的课全部结束了") + "，别忘了记录本节进度" });
        }
      });
    }
  }
  if (S.journalOn) {
    var nowD = new Date();
    for (var i = 0; i < 8; i++) {
      var d = addDays(nowD, i), ds = ymd(d), oc = occurrencesOn(d);
      if (!oc.length || S.journal[ds]) continue;
      var last = oc[oc.length - 1], t = last.end.getTime() + 10 * 60000;
      if (t > Date.now()) list.push({ at: t, title: "📒 今天的课上完了", text: "学校要求的「教学日志」填了吗？填好后在 App 首页点“已填写”" });
      var snz = (S.journalSnooze || {})[ds];
      if (snz && snz > Date.now()) list.push({ at: snz, title: "📒 教学日志还没填", text: md(d) + " 的教学日志，记得填写" });
    }
  }
  list.sort(function (a, b) { return a.at - b.at; });
  try { Android.schedule(JSON.stringify(list.slice(0, 60))); } catch (e) {}
}

/* ================= UI 外壳 ================= */
var tab = "home", noteFilter = "all", noteQuery = "";
var $ = function (id) { return document.getElementById(id); };
function toast(t) { var e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { e.classList.remove("show"); }, 2000); }
document.querySelectorAll(".tabs button").forEach(function (b) {
  b.onclick = function () { tab = b.dataset.t; render(); window.scrollTo(0, 0); };
});

function renderTop() {
  var now = new Date(), sem = semFor(now), info = dayInfo(now);
  var titles = { home: "我的课堂", table: "课表", stu: "学生名单", notes: "课堂记事", set: "设置" };
  var pill = sem ? "第 " + weekOf(now, sem) + " 周" : "假期";
  $("top").innerHTML = (tab === "home" ? '<div class="brand"><img src="img/school_red.png" alt="河南经贸职业学院 国际学院（格里菲斯学院）"></div>' : "") +
    '<div class="toprow"><div><div class="sub">' + (now.getMonth() + 1) + "月" + now.getDate() + "日 " + WD[dow(now)] +
    (info.holiday || info.makeup ? ' · <b style="color:var(--amber)">' + esc(info.label) + '</b>' : "") +
    '</div><h1>' + titles[tab] + '</h1></div><span class="weekpill">' + pill + '</span></div>';
  document.querySelectorAll(".tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === tab); });
}
function render() {
  PCACHE = {};
  cleanupPunched();
  renderTop();
  if (tab === "home") renderHome();
  else if (tab === "table") renderTable();
  else if (tab === "notes") renderNotes();
  else if (tab === "stu") renderStudents();
  else renderSet();
}
function cleanupPunched() {
  var lim = ymd(addDays(new Date(), -10));
  Object.keys(S.punched).forEach(function (k) { if (k.slice(0, 10) < lim) delete S.punched[k]; });
}

/* ================= 首页 ================= */
function lastNoteBlock(co, title) {
  var ns = notesFor(ckey(co));
  var h = '<div class="recall"><h3><span>' + (title || "上次课堂记录") + '</span>';
  if (!ns.length) return h + '</h3><div class="empty">这个班还没有记录。下课后点“记录本节”写下进度。</div></div>';
  var n = ns[0];
  h += '<small>' + esc(n.date.slice(5).replace("-", "/")) + " " + WD[dow(parseYmd(n.date))] + " " + esc(n.p ? pLabel(n.p) : "") + '</small></h3>';
  h += noteFields(n, true);
  if (ns.length > 1) h += '<button class="mini" style="margin-top:6px" onclick="openClassNotes(\'' + esc(jsq(ckey(co))) + '\')">查看全部 ' + ns.length + ' 条</button>';
  return h + '</div>';
}
function noteFields(n, withTodo) {
  var h = "";
  if (n.progress) h += '<div class="field"><div class="k">进度</div><div class="v">' + esc(n.progress) + '</div></div>';
  var at = attSummaryText(n), mk = marksText(n);
  if (at || mk) h += '<div class="field"><div class="k">考勤 / 课堂表现</div>' + (at ? '<div class="sumline">' + at + '</div>' : "") + (mk ? '<div class="sumline">' + mk + '</div>' : "") + '</div>';
  if (n.students) h += '<div class="field"><div class="k">学生情况</div><div class="v">' + esc(n.students) + '</div></div>';
  if (n.other) h += '<div class="field' + (withTodo && n.todo && !n.todoDone ? ' todo' : '') + '"><div class="k">其他事项' + (n.todo ? (n.todoDone ? ' <span class="chip g">已完成</span>' : ' <span class="chip a">下节课要办</span>') : '') + '</div><div class="v">' + esc(n.other) + '</div></div>';
  return h || '<div class="empty">（空记录）</div>';
}
function openTodos(co) { return notesFor(ckey(co)).filter(function (n) { return n.todo && !n.todoDone && n.other; }); }

/* ---------- 倒计时（大号数字块） ---------- */
function cdTiles(ms) {
  if (ms < 0) ms = 0;
  var t = Math.floor(ms / 1000), d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
  var parts = d > 0 ? [[d, "天"], [h, "时"], [m, "分"]] : (h > 0 ? [[h, "时"], [m, "分"], [sec, "秒"]] : [[m, "分"], [sec, "秒"]]);
  return parts.map(function (p, i) {
    return (i ? '<span class="colon">:</span>' : "") + '<div class="tl"><b>' + (p[1] === "天" ? p[0] : pad(p[0])) + '</b><i>' + p[1] + '</i></div>';
  }).join("");
}
function urgentLevel(ms, kind) {
  if (kind === "start") return ms < 5 * 60000 ? 2 : (ms < 15 * 60000 ? 1 : 0);
  return ms < 5 * 60000 ? 2 : 0;
}

/* ---------- 打卡横幅 ---------- */
function punchBanners(today, now) {
  var h = "";
  punchesOn(now).forEach(function (p) {
    var o = p.o, kind = p.kind, s = p.s, e = p.e, name = p.name;
    var where = (kind === "in" ? p.tag + "第一节 " : (p.half === "am" ? "上午最后一节 " : "今天最后一节 ")) + esc(o.co.room) + " · " + esc(short(o.co.cls)) + (o.tm.alt ? " · " + o.tm.b + "号楼时间" : "");
    (function () {
      if (isPunched(p)) return;
      if (now >= s && now < e) {
        h += '<div class="punch hot"><div class="ph">⏰ ' + name + '进行中</div>' +
          '<div class="pw">' + hm(s) + '<em>–</em>' + hm(e) + '</div>' +
          '<div class="pc">截止还剩 <span class="cdx" data-to="' + e.getTime() + '">' + fmtCountdown(e - now) + '</span></div>' +
          '<div class="pwhere">' + where + '</div>' +
          '<button class="pbig" onclick="markPunch(\'' + p.key + '\')">✓ 我已打卡</button></div>';
      } else if (s > now && s - now < 90 * 60000) {
        h += '<div class="punch"><div class="ph">🕘 ' + name + ' · <span class="cdx" data-to="' + s.getTime() + '">' + fmtCountdown(s - now) + '</span> 后开始</div>' +
          '<div class="pw sm">' + hm(s) + '<em>–</em>' + hm(e) + '</div><div class="pwhere">' + where + '</div></div>';
      }
    })();
  });
  return h;
}
function markPunch(key) {
  var p = punchesOn(parseYmd(key.slice(0, 10))).find(function (x) { return x.key === key; });
  S.punched[key] = 1; save();
  toast("已记下：" + (p ? p.name : "打卡"));
  if (p && p.kind === "out" && !noteForOcc(p.o)) { render(); noteOcc(p.o.oid, true); return; }
  render();
}

/* ---------- 教学日志提醒 ---------- */
function journalDue(now) {
  if (!S.journalOn) return [];
  var out = [];
  for (var i = 0; i < 3; i++) {
    var d = addDays(now, -i), ds = ymd(d), occ = occurrencesOn(d);
    if (ds < S.journalSince) break;
    if (!occ.length || S.journal[ds]) continue;
    var last = occ[occ.length - 1];
    if (last.end > now) continue;
    var snz = (S.journalSnooze || {})[ds];
    if (snz && snz > now.getTime()) continue;
    out.push({ date: ds, d: d, n: occ.length, last: last });
  }
  return out;
}
function journalCard(now) {
  var due = journalDue(now); if (!due.length) return "";
  var t = due[0], isToday = t.date === ymd(now);
  var h = '<div class="journal"><div class="jt">📒 ' + (isToday ? "今天的课上完了" : md(t.d) + " " + WD[dow(t.d)] + " 的课") + '</div>' +
    '<div class="jq">学校要求的「教学日志」填了吗？</div><div class="js">' + t.n + ' 节课 · 最后一节 ' + esc(short(t.last.co.cls)) + " " + pLabel(t.last.co.p) + '</div>' +
    '<div class="jb"><button class="pbig" onclick="journalDone(\'' + t.date + '\')">✓ 已填写</button><button class="jlater" onclick="journalLater(\'' + t.date + '\')">1 小时后提醒</button></div>';
  if (due.length > 1) h += '<div class="js" style="margin-top:8px">另有 ' + due.slice(1).map(function (x) { return md(x.d); }).join("、") + ' 的日志未确认</div>';
  return h + '</div>';
}
function journalDone(ds) { S.journal[ds] = 1; save(); toast("教学日志已确认 ✓"); render(); }
function journalLater(ds) {
  S.journalSnooze = S.journalSnooze || {}; S.journalSnooze[ds] = Date.now() + 3600e3;
  save(); toast("1 小时后再提醒你"); render();
}

var occCache = [];
function renderHome() {
  var now = new Date();
  var occ = occurrences(now, 30);
  occCache = occ;
  var cur = occ.find(function (o) { return o.start <= now && now < o.end; });
  var next = occ.find(function (o) { return o.start > now; });
  var today = occurrencesOn(now);
  var info = dayInfo(now);
  var h = "";

  h += punchBanners(today, now);
  h += journalCard(now);

  var pending = today.filter(function (o) { return o.end <= now && !noteForOcc(o); });
  var lastPending = pending[pending.length - 1];

  if (cur) {
    var left = cur.end - now, pct = Math.min(100, Math.max(0, (now - cur.start) / (cur.end - cur.start) * 100));
    h += '<div class="hero live' + (urgentLevel(left, "end") ? " urg2" : "") + '" id="hero" data-kind="end"><div class="htop"><span class="tag">● 正在上课</span><span class="hlbl">距离下课</span></div>' +
      '<div class="tiles" id="cd" data-to="' + cur.end.getTime() + '">' + cdTiles(left) + '</div>' +
      '<div class="bar"><i id="bar" style="width:' + pct.toFixed(1) + '%" data-s="' + cur.start.getTime() + '" data-e="' + cur.end.getTime() + '"></i></div>' +
      heroGrid(cur) +
      (rosterOf(cur.co.cls).length ? '<div class="btnrow">' + attBtn(cur) + '<button class="hbtn" onclick="noteOcc(\'' + cur.oid + '\')">' + (noteForOcc(cur) ? "📝 修改记录" : "📝 记录本节") + '</button></div>' +
        '<div class="btnrow" style="margin-top:8px"><button class="hbtn ghost" onclick="luckyFromHero(\'' + cur.oid + '\')">🎲 随机抽人</button><button class="hbtn ghost" style="flex:.6" onclick="occSheet(\'' + cur.oid + '\')">调课</button></div></div>'
      : '<div class="btnrow"><button class="hbtn" onclick="noteOcc(\'' + cur.oid + '\')">' + (noteForOcc(cur) ? "修改本节记录" : "记录本节") + '</button><button class="hbtn ghost" style="flex:.5" onclick="occSheet(\'' + cur.oid + '\')">调课</button></div></div>');
    h += todoBlock(cur.co);
    h += lastNoteBlock(cur.co, "本班上次记录");
    if (next) h += '<div class="sect">下一节</div>' + rowHtml(next);
  } else if (next) {
    var l2 = next.start - now, u = urgentLevel(l2, "start");
    h += '<div class="hero' + (u === 2 ? " urg2" : (u === 1 ? " urg1" : " calm")) + '" id="hero" data-kind="start"><div class="htop"><span class="tag">下一节 · ' + relDay(next.start) + " " + WD[dow(next.start)] + '</span><span class="hlbl">' + (u ? "快上课了！" : "距离上课") + '</span></div>' +
      '<div class="tiles" id="cd" data-to="' + next.start.getTime() + '">' + cdTiles(l2) + '</div>' +
      heroGrid(next) +
      '<div class="btnrow">' + (rosterOf(next.co.cls).length ? attBtn(next) : "") + '<button class="hbtn ghost" onclick="occSheet(\'' + next.oid + '\')">调课 / 停课</button></div></div>';
    if (lastPending) h += promptHtml(lastPending);
    h += todoBlock(next.co);
    h += lastNoteBlock(next.co, "本班上次记录 · 接着讲");
  } else {
    var cs0 = curSem();
    if (cs0 && !cs0.courses.length) h += '<div class="hero calm"><span class="tag">还没有课表</span><div style="font-size:24px;font-weight:700;margin-top:12px">先导入你的课表</div><div class="cdl">在“智慧经贸 → 教师课表查询”截图，App 会自动识别</div><div class="btnrow"><button class="hbtn" onclick="importSchedule(\'' + cs0.id + '\')">📷 导入课表截图</button><button class="hbtn ghost" style="flex:.6" onclick="tab=\'table\';tableSemId=\'' + cs0.id + '\';render();editCourse(null)">手动添加</button></div></div>';
    else h += '<div class="hero calm"><span class="tag">近期没有课</span><div style="font-size:24px;font-weight:700;margin-top:12px">接下来 30 天没有排课</div><div class="cdl">可能是假期；新学期可在“设置 → 学期与课表”导入课表截图</div></div>';
    if (lastPending) h += promptHtml(lastPending);
  }

  h += '<div class="sect"><span>今天 · ' + WD[dow(now)] + (info.makeup ? "（" + esc(info.label) + "）" : "") + '</span><button onclick="addSheet(\'' + ymd(now) + '\')">＋ 临时加课</button></div>';
  if (info.holiday) h += '<div class="row"><div class="m"><div class="c">🎉 ' + esc(info.label) + '</div><div class="s">今天不上课</div></div></div>';
  h += dayRows(now, today, true);

  // 未来 7 天（含放假 / 调课 / 学校事件）
  var marks = [];
  for (var i = 1; i < 8; i++) {
    var d = addDays(now, i), di = dayInfo(d);
    if (di.holiday || di.makeup) marks.push({ date: ymd(d), label: di.label, kind: di.holiday ? "h" : "m" });
    eventsOn(d, di.sem).forEach(function (e) { marks.push({ date: ymd(d), label: e.label, kind: "e" }); });
  }
  h += '<div class="sect">未来 7 天</div>';
  var any = false;
  for (i = 1; i < 8; i++) {
    var dd = addDays(now, i), ds = ymd(dd), list = occurrencesOn(dd), ghosts = ghostsOn(dd), mk = marks.filter(function (m) { return m.date === ds; });
    if (!list.length && !ghosts.length && !mk.length) continue;
    any = true;
    h += '<div class="dlabel">' + relDay(dd) + " · " + WD[dow(dd)] + mk.map(function (m) { return ' <span class="chip ' + (m.kind === "h" ? "g" : "a") + '">' + esc(m.label) + '</span>'; }).join("") + '</div>';
    h += dayRows(dd, list, false);
  }
  if (!any) h += '<div class="row"><div class="m"><div class="s">未来一周没有课</div></div></div>';
  $("view").innerHTML = h;
}
/* 某天的课（含已停课/调走的灰色行） */
function ghostsOn(d) {
  var ds = ymd(d);
  return regularOn(d).map(function (co) { return { co: co, a: adjFor(ds, co.id) }; }).filter(function (x) { return x.a; });
}
function dayRows(d, list, isToday) {
  var rows = list.map(function (o) { return { t: o.start.getTime(), h: rowHtml(o) }; });
  ghostsOn(d).forEach(function (g) {
    var tm = timesFor(g.co), a = g.a;
    var txt = a.kind === "cancel" ? "本次停课" : "已调到 " + md(parseYmd(a.date)) + " " + WD[dow(parseYmd(a.date))] + " " + pLabel(a.p) + (a.room ? " · " + a.room : "");
    rows.push({ t: at(d, tm ? tm.t[0] : "00:00").getTime(), h: '<div class="row ghost" onclick="adjSheetFor(\'' + ymd(d) + '\',\'' + g.co.id + '\')"><div class="p"><b>' + g.co.p + '</b><span>' + (tm ? tm.t[0] : "") + '</span></div><div class="m"><div class="c">' + esc(short(g.co.cls)) + '</div><div class="s">' + esc(txt) + '</div></div><span class="chip a">' + (a.kind === "cancel" ? "停课" : "调走") + '</span></div>' });
  });
  rows.sort(function (a, b) { return a.t - b.t; });
  if (!rows.length && isToday && !dayInfo(d).holiday) return '<div class="row"><div class="m"><div class="s">今天没有课，休息一下。</div></div></div>';
  return rows.map(function (r) { return r.h; }).join("");
}
function heroGrid(o) {
  var tm = o.tm, a = o.adj;
  var h = '<div class="grid"><div class="room"><span class="rl"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>教室</span><b>' + esc(o.co.room) + '</b>' + (tm.b ? '<span class="rb">' + tm.b + ' 号楼</span>' : "") + '</div><div class="info">' +
    '<div class="cls">' + esc(o.co.cls) + '</div><div class="crs">' + esc(o.co.name) + '</div>' +
    '<div class="time">' + pLabel(o.co.p) + " · " + tm.t[0] + "–" + tm.t[1] + " · 第" + o.week + "周" + (rosterOf(o.co.cls).length ? " · 应到 " + activeOf(o.co.cls).length + " 人" : "") + (tm.alt ? ' <span class="altchip">' + tm.b + '号楼时间</span>' : "") + '</div>' +
    '</div></div>';
  if (a) h += '<div class="adjnote">🔁 ' + (a.kind === "add" ? "临时加课" : "已调课：原 " + md(parseYmd(a.odate)) + " " + WD[dow(parseYmd(a.odate))] + " " + pLabel(a.op || "") + (a.oroom ? " · " + esc(a.oroom) : "")) + (a.note ? " · " + esc(a.note) : "") + '</div>';
  var hp = halfPunches(o);
  if (hp.length) h += '<div class="pbox">' + hp.map(function (p) {
    var mine = p.o.oid === o.oid, done = isPunched(p);
    return '<div class="' + (mine ? "mine" : "") + '"><i>' + p.name + (mine ? (p.kind === "in" ? " · 本节课前" : " · 本节课后") : (p.kind === "in" ? " · " + pLabel(p.o.co.p) + "前" : " · " + pLabel(p.o.co.p) + "后")) + '</i><b>' + (done ? "✓ 已打卡" : hm(p.s) + "–" + hm(p.e)) + '</b></div>';
  }).join("") + '</div>';
  return h;
}
function promptHtml(o) {
  return '<div class="prompt"><div class="t"><b>刚下课：' + esc(short(o.co.cls)) + '</b>' + pLabel(o.co.p) + " · 还没记录本节进度</div>" +
    '<button class="pbtn" onclick="noteOcc(\'' + o.oid + '\')">去记录</button></div>';
}
function todoBlock(co) {
  var t = openTodos(co); if (!t.length) return "";
  var h = '<div class="recall todo"><h3><span style="color:var(--amber)">⚑ 这个班有待办</span></h3>';
  t.forEach(function (n) {
    h += '<div class="check"><input type="checkbox" onchange="doneTodo(\'' + n.id + '\')"><span style="white-space:pre-wrap">' + esc(n.other) + ' <small style="color:var(--ink3)">(' + n.date.slice(5).replace("-", "/") + ')</small></span></div>';
  });
  return h + '</div>';
}
function doneTodo(id) {
  var n = S.notes.find(function (x) { return x.id === id; }); if (!n) return;
  n.todoDone = true; save(); toast("已标记完成"); render();
}
function rowHtml(o) {
  var now = new Date(), tm = o.tm;
  var st = o.end <= now ? "done" : (o.start <= now ? "now" : "");
  var n = noteForOcc(o), right;
  if (st === "done") right = n ? '<span class="mini">✓ 已记</span>' : '<span class="mini" style="background:var(--amberbg);color:var(--amber)">记录</span>';
  else right = '<div class="r">' + esc(o.co.room) + '</div>';
  return '<div class="row ' + st + '" onclick="occSheet(\'' + o.oid + '\')"><div class="p"><b>' + o.co.p + '</b><span' + (tm.alt ? ' style="color:var(--amber);font-weight:700"' : "") + '>' + tm.t[0] + '</span></div>' +
    '<div class="m"><div class="c">' + esc(short(o.co.cls)) + (st === "now" ? '<span class="chip a">上课中</span>' : '') + (o.adj ? '<span class="chip a">' + (o.adj.kind === "add" ? "加课" : "调课") + '</span>' : "") + (tm.alt ? '<span class="chip">' + tm.b + '号楼</span>' : "") + '</div><div class="s">' + esc(o.co.name) + (st === "done" ? " · " + esc(o.co.room) : punchesFor(o).map(function (p) { return " · " + (p.kind === "in" ? "上班卡 " : "下班卡 ") + hm(p.s); }).join("")) + '</div></div>' + right + '</div>';
}

/* ---------- 单节课操作：记录 / 调课 / 停课 ---------- */
function occSheet(oid) {
  var o = findOcc(oid); if (!o) return;
  var now = new Date(), a = o.adj, d = parseYmd(o.date);
  var h = '<div class="shead"><div><h2>' + esc(short(o.co.cls)) + '</h2><div class="sh">' + esc(o.co.name) + " · " + md(d) + " " + WD[dow(d)] + " · " + pLabel(o.co.p) + " " + o.tm.t[0] + "–" + o.tm.t[1] + " · " + esc(o.co.room) + '</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  if (a) h += '<div class="hint">' + (a.kind === "add" ? "这是临时加的课" : "已调课：原 " + md(parseYmd(a.odate)) + " " + WD[dow(parseYmd(a.odate))] + " " + pLabel(a.op || "") + (a.oroom ? " · " + esc(a.oroom) : "")) + (a.note ? "（" + esc(a.note) + "）" : "") + '</div>';
  h += '<button class="prim" onclick="noteOcc(\'' + oid + '\')">📝 ' + (noteForOcc(o) ? "查看 / 修改本节记录" : "记录本节") + '</button>';
  if (o.end > now) {
    h += '<button class="sec" onclick="adjEditor(\'' + oid + '\')">🔁 调课（改日期 / 节次 / 教室）</button>';
    if (a && a.kind === "add") h += '<button class="sec danger" onclick="delAdj(\'' + a.id + '\')">删除这节加课</button>';
    else h += '<button class="sec danger" onclick="cancelOcc(\'' + oid + '\')">本次停课</button>';
  }
  if (a && a.kind === "move") h += '<button class="sec" onclick="delAdj(\'' + a.id + '\')">↩ 恢复原来的时间和教室</button>';
  h += '<button class="sec" onclick="openClassNotes(\'' + esc(jsq(ckey(o.co))) + '\')">查看这个班的全部记录</button>';
  openSheet(h);
}
function adjSheetFor(ds, cid) {
  var a = adjFor(ds, cid), co = courseById(cid); if (!a || !co) return;
  var h = '<div class="shead"><div><h2>' + esc(short(co.cls)) + '</h2><div class="sh">' + esc(co.name) + " · 原 " + md(parseYmd(ds)) + " " + WD[dow(parseYmd(ds))] + " " + pLabel(co.p) + " · " + esc(co.room) + '</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  h += '<div class="hint">' + (a.kind === "cancel" ? "本次已停课" : "已调到 " + md(parseYmd(a.date)) + " " + WD[dow(parseYmd(a.date))] + " " + pLabel(a.p) + " · " + esc(a.room)) + (a.note ? "（" + esc(a.note) + "）" : "") + '</div>';
  if (a.kind === "move") h += '<button class="prim" onclick="adjEditor(\'' + a.date + "_" + a.p + '\')">修改调课</button>';
  h += '<button class="sec" onclick="delAdj(\'' + a.id + '\')">↩ 恢复原课</button>';
  openSheet(h);
}
function pSelect(id, v) { return '<select id="' + id + '">' + PORDER.map(function (p) { return '<option' + (p === v ? " selected" : "") + '>' + p + '</option>'; }).join("") + '</select>'; }
var adjCtx = null;
function adjEditor(oid) {
  var o = findOcc(oid); if (!o) return;
  var a = o.adj && o.adj.kind === "move" ? o.adj : null;
  var odate = a ? a.odate : o.date, base = a ? courseById(a.cid) : o.co;
  adjCtx = { o: o, a: a, odate: odate, cid: base.id, op: base.p, oroom: base.room };
  var h = '<div class="shead"><div><h2>调课</h2><div class="sh">' + esc(short(base.cls)) + " · " + esc(base.name) + '</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  h += '<div class="hint">原定：' + md(parseYmd(odate)) + " " + WD[dow(parseYmd(odate))] + " " + pLabel(base.p) + " · " + esc(base.room) + '</div>';
  h += '<div class="two"><div><label class="fl">调到哪天</label><input id="j_date" type="date" value="' + o.date + '"></div><div style="flex:.7"><label class="fl">节次</label>' + pSelect("j_p", o.co.p) + '</div></div>';
  h += '<label class="fl">教室 <em>没变就不用改</em></label><input id="j_room" value="' + esc(o.co.room) + '" inputmode="numeric">';
  h += '<label class="fl">备注 <em>可不填</em></label><input id="j_note" value="' + esc(a ? a.note || "" : "") + '" placeholder="例：与王老师对调">';
  h += '<button class="prim" onclick="saveAdj()">保存调课</button>';
  openSheet(h);
}
function saveAdj() {
  var c = adjCtx, date = $("j_date").value, p = $("j_p").value, room = $("j_room").value.trim(), note = $("j_note").value.trim();
  if (!date) { toast("请选择日期"); return; }
  S.adjust = S.adjust.filter(function (x) { return !(x.odate === c.odate && x.cid === c.cid && x.kind !== "add"); });
  if (date === c.odate && p === c.op && room === c.oroom) { save(); closeSheet(); toast("和原课一样，已恢复原课"); render(); return; }
  S.adjust.push({ id: uid(), kind: "move", odate: c.odate, cid: c.cid, op: c.op, oroom: c.oroom, date: date, p: p, room: room, note: note });
  save(); closeSheet(); toast("已调课：" + md(parseYmd(date)) + " " + pLabel(p) + " · " + room); render();
}
function cancelOcc(oid) {
  var o = findOcc(oid); if (!o) return;
  ask("本次（" + md(parseYmd(o.date)) + " " + pLabel(o.co.p) + "）停课？", function () { doCancelOcc(o); }, "确定停课");
}
function doCancelOcc(o) {
  var a = o.adj, odate = a ? a.odate : o.date, cid = a ? a.cid : o.co.id, base = courseById(cid) || o.co;
  S.adjust = S.adjust.filter(function (x) { return !(x.odate === odate && x.cid === cid && x.kind !== "add"); });
  S.adjust.push({ id: uid(), kind: "cancel", odate: odate, cid: cid, op: base.p, oroom: base.room, date: odate, p: base.p, room: base.room });
  save(); closeSheet(); toast("已标记停课，可随时恢复"); render();
}
function delAdj(id) {
  S.adjust = S.adjust.filter(function (x) { return x.id !== id; });
  save(); closeSheet(); toast("已恢复"); render();
}
function addSheet(ds, pp) {
  var sem = curSem(), keys = uniq((sem ? sem.courses : []).map(ckey));
  var h = '<div class="shead"><div><h2>临时加课</h2><div class="sh">补课、代课、临时安排</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  h += '<label class="fl">班级 / 课程</label><select id="k_key" onchange="$(\'k_other\').style.display=this.value?\'none\':\'block\'">' + keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(short(k.split("｜")[0])) + " · " + esc(k.split("｜")[1]) + '</option>'; }).join("") + '<option value="">其他（手动输入）</option></select>';
  h += '<div id="k_other" style="display:' + (keys.length ? "none" : "block") + '"><input id="k_cls" placeholder="班级" style="margin-top:8px"><input id="k_name" placeholder="课程" style="margin-top:8px"></div>';
  h += '<div class="two"><div><label class="fl">日期</label><input id="k_date" type="date" value="' + (ds || ymd(new Date())) + '"></div><div style="flex:.7"><label class="fl">节次</label>' + pSelect("k_p", pp || "3-4") + '</div></div>';
  h += '<label class="fl">教室</label><input id="k_room" inputmode="numeric" placeholder="例：3410">';
  h += '<label class="fl">备注 <em>可不填</em></label><input id="k_note" placeholder="例：补国庆的课">';
  h += '<button class="prim" onclick="saveAdd()">添加</button>';
  openSheet(h);
}
function saveAdd() {
  var k = $("k_key").value, cls, name, cid = "";
  if (k) { var co = (curSem() ? curSem().courses : []).find(function (c) { return ckey(c) === k; }); cls = co.cls; name = co.name; }
  else { cls = $("k_cls").value.trim(); name = $("k_name").value.trim(); }
  var date = $("k_date").value, room = $("k_room").value.trim();
  if (!cls || !name || !date) { toast("班级、课程、日期都要填"); return; }
  S.adjust.push({ id: uid(), kind: "add", date: date, p: $("k_p").value, room: room, name: name, cls: cls, note: $("k_note").value.trim() });
  save(); closeSheet(); toast("已添加临时课"); render();
}

function tick() {
  var cd = $("cd"), hero = $("hero");
  if (cd) {
    var left = +cd.dataset.to - Date.now();
    if (left <= 0) { render(); return; }
    cd.innerHTML = cdTiles(left);
    if (hero) {
      var u = urgentLevel(left, hero.dataset.kind);
      var want = u === 2 ? "urg2" : (u === 1 ? "urg1" : "");
      if ((want && !hero.classList.contains(want)) || (!want && (hero.classList.contains("urg1") || hero.classList.contains("urg2")))) { render(); return; }
    }
  }
  var redo = false;
  document.querySelectorAll(".cdx").forEach(function (e) { var l = +e.dataset.to - Date.now(); if (l <= 0) redo = true; else e.textContent = fmtCountdown(l); });
  if (redo) { render(); return; }
  var bar = $("bar");
  if (bar) { var s = +bar.dataset.s, e = +bar.dataset.e; bar.style.width = Math.min(100, (Date.now() - s) / (e - s) * 100).toFixed(1) + "%"; }
}
setInterval(function () { if (tab === "home" && !$("mask").classList.contains("show")) tick(); }, 1000);
document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("mask").classList.contains("show")) render(); });
window.onAppResume = function () { if (!$("mask").classList.contains("show")) render(); reschedule(); };


/* ---------- 页内确认框（不用系统 confirm/alert，网页版里它们会被拦截） ---------- */
var askFn = null;
function ask(msg, yes, okText) {
  askFn = yes;
  var m = $("askmask");
  if (!m) { m = document.createElement("div"); m.id = "askmask"; m.className = "askmask"; document.body.appendChild(m); }
  m.innerHTML = '<div class="askbox"><div class="askmsg">' + esc(msg) + '</div><div class="askbtns"><button class="sec" style="margin:0" onclick="askClose()">取消</button>' +
    (yes ? '<button class="prim" style="margin:0" onclick="askOk()">' + esc(okText || "确定") + '</button>' : "") + '</div></div>';
  m.classList.add("show");
}
function notice(msg) { ask(msg, null); var b = document.querySelector("#askmask .sec"); if (b) b.textContent = "知道了"; }
function askClose() { var m = $("askmask"); if (m) m.classList.remove("show"); askFn = null; }
function askOk() { var f = askFn; askClose(); if (f) f(); }
function showCopy(text, title) {
  var ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { toast("已复制到剪贴板，可粘贴到微信发给自己"); }, function () {}); ok = true; } } catch (e) {}
  openSheet('<div class="shead"><div><h2>' + esc(title || "复制内容") + '</h2><div class="sh">' + (ok ? "已尝试复制到剪贴板；如果没成功，长按下面的文字全选复制" : "长按下面的文字全选复制") + '</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>' +
    '<textarea id="copybox" readonly style="min-height:240px;font-size:12px">' + esc(text) + '</textarea>');
  setTimeout(function () { var t = $("copybox"); if (t) { t.focus(); t.select(); } }, 100);
}

/* ================= 弹层 ================= */
function openSheet(html) { $("sheet").innerHTML = '<div class="grab"></div>' + html; $("mask").classList.add("show"); $("sheet").scrollTop = 0; }
function closeSheet() { $("mask").classList.remove("show"); if (window.ocrBusy) window.ocrCancel = true; }
$("mask").addEventListener("click", function (e) { if (e.target === $("mask") && !window.ocrBusy) closeSheet(); });
window.onBackPressed = function () {
  if ($("pickmask") && $("pickmask").classList.contains("show")) { closePick(); return true; }
  if ($("askmask") && $("askmask").classList.contains("show")) { askClose(); return true; }
  if ($("mask").classList.contains("show")) { closeSheet(); return true; }
  if (tab !== "home") { tab = "home"; render(); return true; }
  return false;
};

/* ---------- 记事编辑 ---------- */
var editing = null;
function findOcc(oid) {
  var o = occCache.find(function (x) { return x.oid === oid; });
  if (o) return o;
  return occurrencesOn(parseYmd(oid.split("_")[0])).find(function (x) { return x.oid === oid; });
}
function noteOcc(oid, fromPunch) {
  var o = findOcc(oid); if (!o) return;
  noteEditor({ co: o.co, oid: o.oid, date: o.date, p: o.co.p, week: o.week, note: noteForOcc(o), fromPunch: fromPunch });
}
function noteEditor(ctx) {
  editing = ctx;
  var n = ctx.note || {};
  var prev = notesFor(ckey(ctx.co)).filter(function (x) { return x !== ctx.note; })[0];
  var d = parseYmd(ctx.date);
  var h = '<div class="shead"><div><h2>' + esc(short(ctx.co.cls)) + '</h2><div class="sh">' + esc(ctx.co.name) + " · " + md(d) + " " + WD[dow(d)] + (ctx.p ? " · " + pLabel(ctx.p) : "") + (ctx.week ? " · 第" + ctx.week + "周" : "") + '</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  if (ctx.fromPunch) h += '<div class="hint" style="background:var(--okbg);color:var(--ok)">✓ 下课打卡已记下。顺手记一下进度？不想写直接关掉就行。</div>';
  if (prev && prev.progress) h += '<div class="hint">上次进度：' + esc(prev.progress) + '</div>';
  h += '<label class="fl">本节进度 <em>讲到哪里了</em></label><textarea id="f_prog" placeholder="例：第3章 3.2 抽样分布讲完，例题3-5留作业">' + esc(n.progress) + '</textarea>';
  ctx.att = Object.assign({}, n.att || {});
  ctx.marks = (n.marks || []).map(function (m) { return Object.assign({}, m); });
  ctx.attMode = "a"; ctx.attOpen = !!ctx.autoAtt || Object.keys(ctx.att).length > 0;
  if (rosterOf(ctx.co.cls).length) {
    h += '<label class="fl">点名 <em>可选 · 默认全到，只点出没来的</em></label><div class="attbox" id="f_att"></div>';
    h += '<label class="fl">课堂表现 <em>可选 · 先点类型，再选学生</em></label><div class="attbox"><div class="tagrow">' +
      MARK_TAGS.map(function (t) { return '<button onclick="addMark(\'' + t + '\')">＋ ' + t + '</button>'; }).join("") + '</div><div class="marks" id="f_marks"></div></div>';
  } else {
    h += '<div class="hint" style="margin-top:12px">这个班还没有学生名单。到“学生”页导入后，就能在这里直接点名、记录上台做题。</div>';
  }
  h += '<label class="fl">学生情况补充 <em>可不填</em></label><textarea id="f_stu" placeholder="例：第三排上课玩手机；李四进步明显">' + esc(n.students) + '</textarea>';
  h += '<label class="fl">其他事项</label><textarea id="f_oth" placeholder="例：下节课收作业；周四小测">' + esc(n.other) + '</textarea>';
  h += '<label class="check"><input type="checkbox" id="f_todo"' + (n.todo ? " checked" : "") + '>下节课提醒我（在下一节这个班的页面上显示）</label>';
  h += '<button class="prim" onclick="saveNote()">保存</button>';
  if (!ctx.note) h += '<button class="sec" onclick="closeSheet();toast(\'没关系，下课后随时可以补记\')">先不写，关闭</button>';
  if (ctx.note) h += '<button class="sec danger" onclick="delNote(\'' + ctx.note.id + '\')">删除这条记录</button>';
  openSheet(h);
  if ($("f_att")) { drawAtt(); drawMarks(); }
  if (ctx.autoLucky) setTimeout(function () { addMark("上台做题", true); }, 50);
  if (ctx.autoAtt && $("f_att")) setTimeout(function () { var b = $("f_att"); if (b) $("sheet").scrollTop = b.offsetTop - 60; }, 30);
}
function ins(id, t) {
  var e = $(id), v = e.value;
  e.value = v + (v && !/\n$/.test(v) ? "\n" : "") + t; e.focus();
  try { e.setSelectionRange(e.value.length, e.value.length); } catch (x) {}
}
function saveNote() {
  var ctx = editing; if (!ctx) return;
  var prog = $("f_prog").value.trim(), stu = $("f_stu").value.trim(), oth = $("f_oth").value.trim(), todo = $("f_todo").checked;
  var n = ctx.note;
  var att = ctx.att || {}, marks = ctx.marks || [];
  var hasAtt = Object.keys(att).length > 0, hasMk = marks.length > 0;
  var tookAtt = ctx.attOpen && rosterOf(ctx.co.cls).length > 0;
  if (!prog && !stu && !oth && !hasAtt && !hasMk && !tookAtt) {
    if (n) { ask("内容都清空了，删除这条记录？", function () { S.notes = S.notes.filter(function (x) { return x !== n; }); save(); toast("已删除"); closeSheet(); render(); }, "删除"); return; }
    closeSheet(); render(); return;
  }
  if (!n) {
    var sem = semFor(parseYmd(ctx.date)) || curSem();
    n = { id: uid(), key: ckey(ctx.co), cls: ctx.co.cls, course: ctx.co.name, oid: ctx.oid || null, date: ctx.date, p: ctx.p || "", week: ctx.week || weekOf(parseYmd(ctx.date)), semId: sem ? sem.id : "", ts: Date.now() };
    S.notes.push(n);
  }
  n.progress = prog; n.students = stu; n.other = oth;
  if (hasAtt) n.att = att; else delete n.att;
  if (ctx.attOpen && rosterOf(ctx.co.cls).length) n.attDone = true;
  if (hasMk) n.marks = marks; else delete n.marks;
  if (todo && !n.todo) n.todoDone = false;
  n.todo = todo && !!oth; n.updated = Date.now();
  save(); closeSheet(); toast("已保存"); render();
}
function delNote(id) {
  ask("确定删除这条记录？", function () { doDelNote(id); }, "删除");
}
function doDelNote(id) {
  S.notes = S.notes.filter(function (n) { return n.id !== id; });
  save(); closeSheet(); toast("已删除"); render();
}
function allCourses() { var a = []; S.semesters.forEach(function (s) { a = a.concat(s.courses); }); return a; }
function editNote(id) {
  var n = S.notes.find(function (x) { return x.id === id; }); if (!n) return;
  var co = allCourses().find(function (c) { return ckey(c) === n.key; }) || { cls: n.cls, name: n.course };
  noteEditor({ co: co, oid: n.oid, date: n.date, p: n.p, week: n.week, note: n });
}
function openClassNotes(key) {
  var ns = notesFor(key), parts = key.split("｜"), sem = curSem();
  var h = '<h2>' + esc(short(parts[0])) + '</h2><div class="sh">' + esc(parts[1]) + " · 共 " + ns.length + " 条记录</div>";
  var cs = sem ? sem.courses.filter(function (c) { return ckey(c) === key; }) : [];
  if (cs.length) h += '<div class="hint">上课时间：' + esc(cs.map(function (c) { var tm = timesFor(c); return WD[c.day] + " " + pLabel(c.p) + " " + (tm ? tm.t[0] : "") + " · " + c.room; }).join("；")) + '</div>';
  if (!ns.length) h += '<div class="empty" style="margin:16px 0">还没有记录。</div>';
  ns.forEach(function (n) { h += noteCard(n, false); });
  h += '<button class="prim" onclick="newNoteFor(\'' + esc(jsq(key)) + '\')">＋ 补一条记录</button>';
  openSheet(h);
}
function newNoteFor(key) {
  var co = allCourses().find(function (c) { return ckey(c) === key; }); if (!co) return;
  var now = new Date(), best = null;
  for (var i = 0; i < 14 && !best; i++) {
    occurrencesOn(addDays(now, -i)).forEach(function (o) { if (ckey(o.co) === key && o.start <= now) best = o; });
  }
  if (best && !noteForOcc(best)) noteEditor({ co: best.co, oid: best.oid, date: best.date, p: best.co.p, week: best.week, note: null });
  else noteEditor({ co: co, oid: null, date: ymd(now), p: "", week: weekOf(now), note: null });
}
function noteCard(n, showClass) {
  var d = parseYmd(n.date);
  return '<div class="note' + (n.todo && !n.todoDone ? " todoOpen" : "") + '"><div class="h"><b>' + (showClass ? esc(short(n.cls)) : md(d) + " " + WD[dow(d)]) + '</b><span>' +
    (showClass ? md(d) + " " + WD[dow(d)] + " · " : "") + (n.p ? pLabel(n.p) + " · " : "") + "第" + n.week + "周</span></div>" +
    noteFields(n, true) +
    '<div class="acts">' + (n.todo && !n.todoDone ? '<button onclick="doneTodo(\'' + n.id + '\');closeSheet()">✓ 待办完成</button>' : '') + '<button onclick="editNote(\'' + n.id + '\')">编辑</button></div></div>';
}

/* ================= 课表页 ================= */
var tableSemId = null;
function tableSem() { return S.semesters.find(function (s) { return s.id === tableSemId; }) || curSem(); }
function adjListHtml() {
  var lim = ymd(addDays(new Date(), -7));
  var list = S.adjust.filter(function (a) { return (a.date >= lim) || (a.odate && a.odate >= lim); })
    .sort(function (a, b) { return (a.odate || a.date).localeCompare(b.odate || b.date); });
  var h = '<div class="sect"><span>调课 / 停课 / 加课</span><button onclick="addSheet()">＋ 临时加课</button></div>';
  if (!list.length) return h + '<div class="card" style="font-size:13px;color:var(--ink2)">临时调课：在首页点那节课 →“调课”或“本次停课”。调课后的时间、教室、打卡提醒都会自动更新。</div>';
  list.forEach(function (a) {
    var co = a.cid ? courseById(a.cid) : null, cls = co ? co.cls : a.cls, name = co ? co.name : a.name;
    var od = a.odate ? parseYmd(a.odate) : null, nd = parseYmd(a.date);
    var txt = a.kind === "add" ? "加课 " + md(nd) + " " + WD[dow(nd)] + " " + pLabel(a.p) + " · " + esc(a.room) :
      a.kind === "cancel" ? "停课 " + md(od) + " " + WD[dow(od)] + " " + pLabel(a.op) :
      md(od) + " " + WD[dow(od)] + " " + pLabel(a.op) + " " + esc(a.oroom) + " → " + md(nd) + " " + WD[dow(nd)] + " " + pLabel(a.p) + " " + esc(a.room);
    h += '<div class="row"><div class="m"><div class="c">' + esc(short(cls || "")) + ' <span class="chip a">' + (a.kind === "add" ? "加课" : a.kind === "cancel" ? "停课" : "调课") + '</span></div><div class="s" style="white-space:normal">' + txt + (a.note ? " · " + esc(a.note) : "") + '</div></div><button class="mini" onclick="ask(\'撤销这条调课？\',function(){delAdj(\'' + a.id + '\')},\'撤销\')">撤销</button></div>';
  });
  return h;
}
/* 课表页：周视图表格（本周实际安排 / 固定课表） */
var tableMode = "week", tableWeekOff = 0;
var CLR = [["#c0141f", "#fde9ea"], ["#b7791f", "#fbf1dc"], ["#1f7a6e", "#e0f2ef"], ["#2f5fa8", "#e5ecf8"], ["#7a4f9a", "#f1e9f7"], ["#c2571a", "#fdece0"], ["#4a7a2f", "#eaf3e1"], ["#4f5d6b", "#e9edf1"]];
function clsColor(cls) {
  var all = uniq(allCourses().map(function (c) { return c.cls; }).concat(Object.keys(S.rosters || {}))).sort();
  var i = all.indexOf(cls); return CLR[(i < 0 ? 0 : i) % CLR.length];
}
function compactCls(cls) { return short(cls).replace(/^\d{2}/, ""); }
function cellBlock(co, opt) {
  var c = clsColor(co.cls), tm = timesFor(co);
  return '<div class="tc' + (opt.cls || "") + '" style="--c:' + c[0] + ';--cb:' + c[1] + '" onclick="' + opt.click + '">' +
    (opt.badge ? '<i class="tb">' + opt.badge + '</i>' : "") +
    '<b>' + esc(co.room || "—") + '</b><span class="tn">' + esc(compactCls(co.cls)) + '</span><span class="tk">' + esc(co.name) + '</span>' +
    (tm && tm.alt ? '<span class="tt">' + tm.t[0] + '</span>' : "") + '</div>';
}
function renderTable() {
  var sem = tableSem();
  var h = "";
  if (S.semesters.length > 1) {
    h += '<div class="chips" style="margin-bottom:8px">' + S.semesters.map(function (s) {
      return '<button class="fchip' + (sem && s.id === sem.id ? " on" : "") + '" onclick="tableSemId=\'' + s.id + '\';renderTable()">' + esc(s.name) + '</button>';
    }).join("") + '</div>';
  }
  if (!sem) { $("view").innerHTML = '<div class="card empty">还没有学期。到“设置 → 学期与课表”新建一个。</div>'; return; }
  var now = new Date(), today = ymd(now);
  var mon = addDays(mondayOf(now), tableWeekOff * 7), wk = weekOf(mon, sem);
  var inRange = mon >= addDays(semRange(sem)[0], -6) && mon < semRange(sem)[1];
  h += '<div class="seg2"><button class="' + (tableMode === "week" ? "on" : "") + '" onclick="tableMode=\'week\';renderTable()">每周安排</button><button class="' + (tableMode === "fixed" ? "on" : "") + '" onclick="tableMode=\'fixed\';renderTable()">固定课表</button></div>';
  if (tableMode === "week") {
    h += '<div class="wknav"><button aria-label="上一周" onclick="tableWeekOff--;renderTable()">‹</button><div><b>' + (inRange ? "第 " + wk + " 周" : "学期外") + '</b><span>' + md(mon) + " – " + md(addDays(mon, 6)) + '</span></div><button aria-label="下一周" onclick="tableWeekOff++;renderTable()">›</button></div>' +
      (tableWeekOff ? '<div style="text-align:center;margin:-4px 0 8px"><button class="mini" onclick="tableWeekOff=0;renderTable()">回到本周</button></div>' : "");
  } else {
    var r = semRange(sem);
    h += '<div class="fixhd"><div><b>' + esc(sem.name) + '</b><span>' + ymd(r[0]).replace(/-/g, "/") + " 起 · " + sem.weeks + " 周 · 点格子修改 · 空格可添加</span></div><button class=\"mini\" onclick=\"importSchedule('" + sem.id + "')\">📷 导入截图</button></div>";
  }

  // 收集每个格子的内容
  var cells = {}, used = {}, days = [1, 2, 3, 4, 5], hol = {};
  function put(d, p, html) { var k = d + "_" + p; (cells[k] = cells[k] || []).push(html); used[p] = 1; if (d > 5 && days.indexOf(d) < 0) days.push(d); }
  if (tableMode === "week") {
    for (var i = 0; i < 7; i++) {
      var dd = addDays(mon, i), ds = ymd(dd), di = dayInfo(dd);
      if (di.holiday) hol[i + 1] = di.label.replace("放假", "");
      else if (di.makeup) hol[i + 1] = "补" + WD[di.makeup.asDay].slice(1);
      occurrencesOn(dd).forEach(function (o) {
        var st = o.end <= now ? " past" : (o.start <= now ? " now" : "");
        put(i + 1, o.co.p, cellBlock(o.co, { cls: st, click: "occSheet('" + o.oid + "')", badge: o.adj ? (o.adj.kind === "add" ? "加" : "调") : (noteForOcc(o) ? "✓" : "") }));
      });
      ghostsOn(dd).forEach(function (g) {
        put(i + 1, g.co.p, cellBlock(g.co, { cls: " ghost", click: "adjSheetFor('" + ds + "','" + g.co.id + "')", badge: g.a.kind === "cancel" ? "停" : "走" }));
      });
    }
  } else {
    var w0 = semFor(now) === sem ? weekOf(now, sem) : 0;
    sem.courses.forEach(function (c) {
      var off = w0 && (w0 < c.w1 || w0 > c.w2 || (c.par && c.par !== (w0 % 2 ? 1 : 2)));
      put(c.day, c.p, cellBlock(c, { cls: off ? " past" : "", click: "editCourse('" + c.id + "')", badge: c.par ? (c.par === 1 ? "单" : "双") : "" }));
    });
  }
  days.sort();
  // 1-2 节、9-10 节没有课时不占位置；3-4 到 7-8 节始终显示
  var rows = PORDER.filter(function (p) { return used[p] || p === "3-4" || p === "5-6" || p === "7-8"; });

  var cols = "38px repeat(" + days.length + ",minmax(0,1fr))";
  h += '<div class="tt-wrap"><div class="tgrid" style="grid-template-columns:' + cols + '">';
  h += '<div class="th corner"></div>';
  days.forEach(function (d) {
    var dt = addDays(mon, d - 1), isT = tableMode === "week" && ymd(dt) === today;
    h += '<div class="th' + (isT ? " today" : "") + (hol[d] ? " hol" : "") + '"><b>' + WD[d] + '</b>' + (tableMode === "week" ? '<span>' + (hol[d] ? esc(hol[d]) : md(dt)) + '</span>' : "") + '</div>';
  });
  rows.forEach(function (p, ri) {
    if (p === "5-6" && ri > 0) h += '<div class="brk" style="grid-column:1/-1"><span>午休</span></div>';
    if (p === "9-10" && ri > 0) h += '<div class="brk" style="grid-column:1/-1"><span>晚上</span></div>';
    var pt = S.periods[p];
    h += '<div class="ph"><b>' + p.replace("-", "<br>") + '</b><span>' + (pt ? pt.t[0] : "") + '</span></div>';
    days.forEach(function (d) {
      var k = d + "_" + p, dt = addDays(mon, d - 1);
      var isHol = tableMode === "week" && hol[d] && !/^补/.test(hol[d]);
      var empty = tableMode === "week" ? "addSheet('" + ymd(dt) + "','" + p + "')" : "editCourse(null," + d + ",'" + p + "')";
      h += '<div class="td' + (isHol ? " hol" : "") + (tableMode === "week" && ymd(dt) === today ? " today" : "") + '"' + (cells[k] ? "" : ' onclick="' + empty + '"') + '>' + (cells[k] ? cells[k].join("") : (isHol ? "" : '<span class="plus">＋</span>')) + '</div>';
    });
  });
  h += '</div></div>';

  // 图例：每个班一种颜色
  var legend = uniq(sem.courses.map(function (c) { return c.cls + "｜" + c.name; }));
  if (legend.length) h += '<div class="legend">' + legend.map(function (k) {
    var pr = k.split("｜"), c = clsColor(pr[0]), n = sem.courses.filter(function (x) { return x.cls === pr[0] && x.name === pr[1]; }).length;
    return '<span style="--c:' + c[0] + ';--cb:' + c[1] + '"><i></i>' + esc(compactCls(pr[0])) + '<em>' + esc(pr[1]) + ' · ' + n + '节/周</em></span>';
  }).join("") + '</div>';
  if (!sem.courses.length) h += '<div class="card empty" style="margin-top:10px">这个学期还没有课程。<button class="mini" onclick="importSchedule(\'' + sem.id + '\')">📷 导入课表截图</button></div>';
  if (tableMode === "week") h += '<div class="tnote">格子里：✓ 已记录 · 调/加 调课或加课 · 停/走 停课或已调走。点格子可记录、调课；点空格可临时加课。</div>';
  h += adjListHtml();
  $("view").innerHTML = h;
}
function editCourse(id, pd, pp) {
  var sem = tableSem(); if (!sem) return;
  var c = sem.courses.find(function (x) { return x.id === id; }) || { day: pd || dow(new Date()), p: pp || "3-4", name: "", cls: "", room: "", w1: 2, w2: 19, par: 0 };
  var ac = allCourses(), names = uniq(ac.map(function (x) { return x.name; })), clss = uniq(ac.map(function (x) { return x.cls; }));
  var h = '<h2>' + (id ? "修改课程" : "添加课程") + '</h2><div class="sh">' + esc(sem.name) + '</div>';
  h += '<div class="two"><div><label class="fl">星期</label><select id="c_day">' + [1, 2, 3, 4, 5, 6, 7].map(function (d) { return '<option value="' + d + '"' + (d === c.day ? " selected" : "") + '>' + WD[d] + '</option>'; }).join("") + '</select></div>' +
    '<div><label class="fl">节次</label><select id="c_p">' + PORDER.map(function (p) { return '<option' + (p === c.p ? " selected" : "") + '>' + p + '</option>'; }).join("") + '</select></div></div>';
  h += '<label class="fl">班级</label><input id="c_cls" list="dl_cls" value="' + esc(c.cls) + '" placeholder="25大数据与会计1(国际)"><datalist id="dl_cls">' + clss.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist>';
  h += '<label class="fl">课程</label><input id="c_name" list="dl_name" value="' + esc(c.name) + '" placeholder="课程名称"><datalist id="dl_name">' + names.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist>';
  h += '<label class="fl">教室 <em>第一位数字 = 楼号</em></label><input id="c_room" value="' + esc(c.room) + '" placeholder="3410">';
  h += '<div class="two"><div><label class="fl">起始周</label><input id="c_w1" type="number" inputmode="numeric" value="' + c.w1 + '"></div><div><label class="fl">结束周</label><input id="c_w2" type="number" inputmode="numeric" value="' + c.w2 + '"></div>' +
    '<div><label class="fl">单双周</label><select id="c_par">' + ["每周", "单周", "双周"].map(function (t, i) { return '<option value="' + i + '"' + ((c.par || 0) === i ? " selected" : "") + '>' + t + '</option>'; }).join("") + '</select></div></div>';
  h += '<button class="prim" onclick="saveCourse(\'' + (id || "") + '\')">保存</button>';
  if (id) h += '<button class="sec danger" onclick="delCourse(\'' + id + '\')">删除这门课</button>';
  openSheet(h);
}
function saveCourse(id) {
  var sem = tableSem();
  var v = { day: +$("c_day").value, p: $("c_p").value, cls: $("c_cls").value.trim(), name: $("c_name").value.trim(), room: $("c_room").value.trim(), w1: +$("c_w1").value || 1, w2: +$("c_w2").value || 30, par: +$("c_par").value || 0 };
  if (!v.cls || !v.name) { toast("班级和课程不能为空"); return; }
  if (id) Object.assign(sem.courses.find(function (x) { return x.id === id; }), v);
  else { v.id = uid(); sem.courses.push(v); }
  save(); closeSheet(); toast("已保存"); render();
}
function delCourse(id) {
  ask("删除这门课？（已写的记事会保留）", function () { doDelCourse(id); }, "删除");
}
function doDelCourse(id) {
  var sem = tableSem();
  sem.courses = sem.courses.filter(function (x) { return x.id !== id; }); save(); closeSheet(); render();
}

/* ================= 记事页 ================= */
function renderNotes() {
  var sem = curSem();
  var keys = uniq((sem ? sem.courses.map(ckey) : []).concat(S.notes.map(function (n) { return n.key; })));
  var h = '<input class="search" id="nq" placeholder="搜索记录（学生姓名、知识点…）" value="' + esc(noteQuery) + '" oninput="noteQuery=this.value;drawNoteList()">';
  h += '<div class="chips"><button class="fchip' + (noteFilter === "all" ? " on" : "") + '" onclick="noteFilter=\'all\';renderNotes()">全部</button>' +
    '<button class="fchip' + (noteFilter === "todo" ? " on" : "") + '" onclick="noteFilter=\'todo\';renderNotes()">⚑ 待办</button>' +
    keys.map(function (k) { var p = k.split("｜"); return '<button class="fchip' + (noteFilter === k ? " on" : "") + '" onclick="noteFilter=\'' + esc(jsq(k)) + '\';renderNotes()">' + esc(short(p[0])) + (keys.filter(function (x) { return x.split("｜")[0] === p[0]; }).length > 1 ? "·" + esc(p[1].slice(0, 4)) : "") + '</button>'; }).join("") + '</div>';
  if (noteFilter !== "all" && noteFilter !== "todo") h += '<div class="sect"><span>' + esc(noteFilter.split("｜")[1]) + '</span><button onclick="newNoteFor(\'' + esc(jsq(noteFilter)) + '\')">＋ 新记录</button></div>';
  h += '<div id="nlist" style="margin-top:12px"></div>';
  $("view").innerHTML = h;
  drawNoteList();
}
function drawNoteList() {
  var q = noteQuery.trim();
  var ns = S.notes.slice().sort(function (a, b) { return (b.date + b.p).localeCompare(a.date + a.p) || b.ts - a.ts; });
  if (noteFilter === "todo") ns = ns.filter(function (n) { return n.todo && !n.todoDone; });
  else if (noteFilter !== "all") ns = ns.filter(function (n) { return n.key === noteFilter; });
  if (q) ns = ns.filter(function (n) { return [n.progress, n.students, n.other, n.cls, n.course, attSummaryPlain(n), marksPlain(n)].join(" ").indexOf(q) >= 0; });
  var h = "";
  if (!ns.length) h = '<div class="card empty">' + (S.notes.length ? "没有符合条件的记录" : "还没有记录。<br>下课后在首页点“记录本节”，或者点某个班级补记。") + '</div>';
  ns.forEach(function (n) { h += noteCard(n, noteFilter === "all" || noteFilter === "todo"); });
  $("nlist").innerHTML = h;
}

/* ================= 设置页 ================= */
function renderSet() {
  var now = new Date(), cs = curSem();
  var h = '<div class="sect" style="margin-top:4px">学期与课表</div>';
  S.semesters.slice().sort(function (a, b) { return b.start.localeCompare(a.start); }).forEach(function (s) {
    var r = semRange(s), live = semFor(now) === s;
    h += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>' + esc(s.name) + '</b>' + (live ? '<span class="chip">当前 · 第' + weekOf(now, s) + '周</span>' : (cs === s ? '<span class="chip a">默认</span>' : "")) + '</div>' +
      '<div style="font-size:13px;color:var(--ink2);margin-top:2px">' + ymd(r[0]).replace(/-/g, "/") + " – " + ymd(addDays(r[1], -1)).replace(/-/g, "/") + " · " + s.weeks + "周 · " + s.courses.length + "节/周 · 放假" + (s.holidays || []).length + "段 · 调课" + (s.makeups || []).length + '天</div>' +
      '<div class="btns3"><button class="mini" onclick="importSchedule(\'' + s.id + '\')">📷 更换课表</button><button class="mini" onclick="editSemester(\'' + s.id + '\')">编辑校历</button>' +
      (S.semesters.length > 1 ? '<button class="mini" style="background:var(--redbg);color:var(--red)" onclick="delSemester(\'' + s.id + '\')">删除</button>' : "") + '</div></div>';
  });
  h += '<div class="two"><button class="sec" style="margin-top:0" onclick="importCalendar()">📷 导入新校历图片</button><button class="sec" style="margin-top:0" onclick="editSemester(null)">＋ 手动新建学期</button></div>';
  h += '<div style="font-size:12px;color:var(--ink3);margin:8px 2px 0">日期落在哪个学期，App 就自动切到哪个学期；放假日不排课，调课日按“补周几”的课表上。</div>';

  h += '<div class="sect">作息与打卡</div><div class="card">';
  h += '<div class="hint" style="margin:0 0 8px">打卡规则：每天上午、下午各打一次<b>上班卡</b>（该时段第一节课的上课打卡时间）和一次<b>下班卡</b>（该时段最后一节课的下课打卡时间）；晚上的课算在下午。下表是各节次对应的打卡时间段。</div>';
  PORDER.forEach(function (p) {
    var x = S.periods[p];
    h += '<div class="ptrow"><b>' + p + '节</b><span>' + x.t.join("–") + '</span><small>打卡 上' + (x.in ? x.in.join("–") : "—") + " 下" + (x.out ? x.out.join("–") : "—") + '</small></div>';
    if (x.alt && x.alt.t && x.alt.t[0]) h += '<div class="ptrow alt"><b>└ ' + esc(S.altBuildings) + '号楼</b><span>' + x.alt.t.join("–") + '</span><small>打卡 上' + (x.alt.in ? x.alt.in.join("–") : "—") + " 下" + (x.alt.out ? x.alt.out.join("–") : "—") + '</small></div>';
  });
  h += '<button class="sec" onclick="editPeriods()">修改作息 / 打卡时间</button></div>';

  h += '<div class="card"><label class="check" style="margin:0"><input type="checkbox"' + (S.journalOn ? " checked" : "") + ' onchange="S.journalOn=this.checked;save();render()"><b>教学日志提醒</b></label>' +
    '<div style="font-size:13px;color:var(--ink2);margin-top:4px">每天最后一节课下课 10 分钟后提醒填写学校的「教学日志」，首页也会一直显示，点“已填写”后消失。</div></div>';
  if (!IS_NATIVE && (!CAP.framed || CAP.downloads)) h += '<div class="card"><b>📅 提醒导入苹果日历</b>' +
    '<div style="font-size:13px;color:var(--ink2);margin-top:4px">苹果不允许网页 App 在后台定时推送。把本学期剩余的课导入 iPhone 自带“日历”，就能在<b>上午、下午的上班打卡和下班打卡开始</b>时收到系统提醒，最后一节课后还会提醒填教学日志。</div>' +
    '<div style="font-size:12px;color:var(--ink3);margin-top:4px">调课、停课后请重新导出一次；重复导入前可在日历里删掉旧的“我的课堂”日程。</div>' +
    '<button class="sec" onclick="exportICS()">导出到日历（.ics）</button></div>';
  if (IS_NATIVE) h += '<div class="card"><label class="check" style="margin:0"><input type="checkbox" id="s_notif"' + (S.notifOn ? " checked" : "") + ' onchange="S.notifOn=this.checked;save();toast(S.notifOn?\'已开启打卡通知\':\'已关闭打卡通知\')"><b>打卡系统通知</b></label>' +
    '<div style="font-size:13px;color:var(--ink2);margin-top:4px">上班打卡开始时、截止前 5 分钟、下班打卡开始时各提醒一次（每天最多上午、下午各一组）。点首页“我已打卡”后，截止提醒会自动取消。</div>' +
    '<div style="font-size:12px;color:var(--ink3);margin-top:4px">小米/华为/OPPO/vivo 手机请在系统设置里允许本 App 通知、自启动和后台运行，否则可能收不到。</div>' +
    (window.Android && Android.testNotify ? '<button class="sec" onclick="Android.testNotify()">发一条测试通知</button>' : "") + '</div>';

  h += '<div class="sect">外观</div>' + bgCard();
  h += '<div class="sect">数据</div><div class="card">' + (CAP.framed ? '<div id="cloudline" style="font-size:13px;font-weight:700;color:var(--teal);margin-bottom:6px">' + cloudLine() + '</div>' : '') + '<div style="color:var(--ink2);font-size:13px;margin:0 0 4px">' + (IS_NATIVE ? "卸载 App 会清空数据，换手机前请先备份。" : CAP.framed ? "也可以导出一份备份文件自己留着。" : "从主屏幕删除 App 或清除 Safari 网站数据会清空数据，换手机前请先备份。") + '共 ' + S.notes.length + ' 条记事。</div>' +
    '<button class="sec" onclick="exportData()">导出备份（发到微信/文件）</button><button class="sec" onclick="importData()">从备份恢复</button><button class="sec" onclick="exportText()">导出记事为文字</button></div>';
  h += '<div class="card"><button class="sec danger" style="margin-top:0" onclick="resetAll()">恢复初始数据（清空所有记事）</button></div>';
  h += '<div class="about"><img src="img/school_red.png" alt="河南经贸职业学院 国际学院（格里菲斯学院）"><div>我的课堂 v1.7.1 · 数据只保存在本机</div></div>';
  $("view").innerHTML = h;
}
function delSemester(id) {
  var s = S.semesters.find(function (x) { return x.id === id; });
  ask("删除“" + s.name + "”及其课表？（记事会保留）", function () { doDelSemester(id); }, "删除");
}
function doDelSemester(id) {
  S.semesters = S.semesters.filter(function (x) { return x.id !== id; });
  if (S.activeId === id && S.semesters[0]) S.activeId = S.semesters[0].id;
  save(); render();
}

/* ---- 学期 / 校历编辑 ---- */
function holToText(s) { return (s.holidays || []).map(function (h) { return h.from + (h.to !== h.from ? "~" + h.to : "") + " " + (h.label || "放假"); }).join("\n"); }
function mkToText(s) { return (s.makeups || []).map(function (m) { return m.date + " 补" + WD[m.asDay] + (m.par ? (m.par === 1 ? "(单周)" : "(双周)") : ""); }).join("\n"); }
function evToText(s) { return (s.events || []).map(function (e) { return e.date + " " + e.label; }).join("\n"); }
var semDraft = null;
function editSemester(id, draft) {
  var s = draft || (id ? JSON.parse(JSON.stringify(S.semesters.find(function (x) { return x.id === id; }))) : null);
  if (!s) {
    var m = mondayOf(new Date());
    s = { id: "", name: "", start: ymd(m), weeks: 20, holidays: [], makeups: [], events: [], courses: [] };
  }
  semDraft = { id: id, s: s };
  var inSem = semFor(new Date()) && semFor(new Date()).id === id;
  var h = '<h2>' + (id ? "编辑校历" : (draft ? "确认识别结果" : "新建学期")) + '</h2><div class="sh">' + (draft ? "请核对，识别有误直接改" : "放假、调课会自动影响倒计时和课表") + '</div>';
  h += '<label class="fl">学期名称</label><input id="e_name" value="' + esc(s.name) + '" placeholder="2027学年第二学期">';
  h += '<div class="two"><div><label class="fl">第 1 周的周一</label><input id="e_start" type="date" value="' + s.start + '"></div><div style="flex:.6"><label class="fl">总周数</label><input id="e_weeks" type="number" inputmode="numeric" value="' + s.weeks + '"></div></div>';
  h += '<div class="hint" id="e_wk">' + weekHint(s.start) + '</div>';
  if (id && inSem) h += '<div class="two" style="align-items:center;margin-top:8px"><span style="flex:none">或直接设：本周是第</span><input id="e_now" type="number" inputmode="numeric" style="width:70px;flex:none;text-align:center"><button class="mini" style="flex:none" onclick="setNowWeek()">换算</button></div>';
  h += '<label class="fl">放假 <em>每行一段：开始~结束 说明</em></label><textarea id="e_hol" placeholder="2026-10-01~2026-10-07 国庆节放假">' + esc(holToText(s)) + '</textarea>';
  h += '<label class="fl">调课 <em>每行：日期 补周几(单/双周)</em></label><textarea id="e_mk" placeholder="2026-10-10 补周五(单周)">' + esc(mkToText(s)) + '</textarea>';
  h += '<label class="fl">其他校历事项 <em>首页“未来7天”会提示</em></label><textarea id="e_ev" placeholder="2026-12-12 四六级考试">' + esc(evToText(s)) + '</textarea>';
  h += '<button class="prim" onclick="saveSemester()">保存</button>';
  if (!id) h += '<div style="font-size:12px;color:var(--ink3);margin-top:8px">保存后可在课表页“导入截图”录入这个学期的课程。</div>';
  openSheet(h);
  $("e_start").onchange = function () { $("e_wk").textContent = weekHint(this.value); };
}
function weekHint(start) {
  if (!start) return "";
  var now = new Date(), w = Math.floor(Math.round((mondayOf(now) - parseYmd(start)) / 864e5) / 7) + 1;
  return "按此日期，今天（" + md(now) + "）是第 " + w + " 周";
}
function setNowWeek() {
  var n = parseInt($("e_now").value, 10); if (!(n >= 1 && n <= 30)) { toast("请输入 1–30"); return; }
  var m = mondayOf(new Date()); m = addDays(m, -(n - 1) * 7);
  $("e_start").value = ymd(m); $("e_wk").textContent = weekHint(ymd(m));
}
function parseHolText(t) {
  var out = [];
  t.split(/\n/).forEach(function (l) {
    var m = l.match(/(\d{4}-\d{1,2}-\d{1,2})\s*(?:[~～至\-—]\s*(\d{4}-\d{1,2}-\d{1,2}))?\s*(.*)/);
    if (m) out.push({ from: normD(m[1]), to: normD(m[2] || m[1]), label: m[3].trim() || "放假" });
  });
  return out;
}
function parseMkText(t) {
  var out = [];
  t.split(/\n/).forEach(function (l) {
    var m = l.match(/(\d{4}-\d{1,2}-\d{1,2}).*?(?:周|星期)([一二三四五六日天])/);
    if (m) { var par = /单/.test(l) ? 1 : (/双/.test(l) ? 2 : 0); out.push({ date: normD(m[1]), asDay: DAYC[m[2]], par: par, label: "补" + WD[DAYC[m[2]]] + "的课" + (par ? (par === 1 ? "（单周）" : "（双周）") : "") }); }
  });
  return out;
}
function parseEvText(t) {
  var out = [];
  t.split(/\n/).forEach(function (l) { var m = l.match(/(\d{4}-\d{1,2}-\d{1,2})\s+(.+)/); if (m) out.push({ date: normD(m[1]), label: m[2].trim() }); });
  return out;
}
function normD(s) { var a = s.split("-"); return a[0] + "-" + pad(+a[1]) + "-" + pad(+a[2]); }
function saveSemester() {
  var d = semDraft, s = d.s;
  s.name = $("e_name").value.trim() || "未命名学期";
  s.start = ymd(mondayOf(parseYmd($("e_start").value || ymd(new Date()))));
  s.weeks = Math.max(1, Math.min(30, +$("e_weeks").value || 20));
  s.holidays = parseHolText($("e_hol").value);
  s.makeups = parseMkText($("e_mk").value);
  s.events = parseEvText($("e_ev").value);
  if (d.id) {
    var i = S.semesters.findIndex(function (x) { return x.id === d.id; });
    S.semesters[i] = s;
  } else {
    var same = S.semesters.find(function (x) { return x.name === s.name; });
    if (same) {
      s.id = same.id; s.courses = same.courses;
      S.semesters[S.semesters.indexOf(same)] = s;
    } else {
      s.id = uid(); S.semesters.push(s);
    }
  }
  S.activeId = s.id;
  save(); closeSheet(); toast("学期已保存"); render();
  if (!s.courses.length) setTimeout(function () { ask("这个学期还没有课表，现在导入课表截图吗？", function () { importSchedule(s.id); }, "导入课表"); }, 300);
}

/* ---- 作息编辑 ---- */
function editPeriods() {
  var h = '<h2>作息与打卡时间</h2><div class="sh">“' + esc(S.altBuildings) + '号楼”一行留空 = 与普通教学楼相同</div>';
  h += '<label class="fl">单独作息的教学楼 <em>教室号第一位 = 楼号</em></label><input id="alt_b" value="' + esc(S.altBuildings) + '" placeholder="4,5">';
  PORDER.forEach(function (p) {
    var x = S.periods[p], a = x.alt || {};
    h += '<div class="card" style="margin-top:10px;padding:10px 12px"><b>' + p + ' 节</b>' +
      trow("上课", p, "t", x.t) + trow("上课打卡", p, "in", x.in) + trow("下课打卡", p, "out", x.out) +
      '<div style="font-size:12px;color:var(--amber);font-weight:700;margin-top:8px">' + esc(S.altBuildings) + '号楼</div>' +
      trow("上课", p, "at", a.t) + trow("上课打卡", p, "ain", a.in) + trow("下课打卡", p, "aout", a.out) + '</div>';
  });
  h += '<button class="prim" onclick="savePeriods()">保存</button><button class="sec" onclick="ask(\'恢复为学校作息表？\',function(){S.periods=defaultPeriods();S.altBuildings=\'4,5\';save();closeSheet();render();},\'恢复\')">恢复学校默认作息</button>';
  openSheet(h);
}
function trow(lbl, p, k, v) {
  v = v || ["", ""];
  return '<div class="ptime"><b>' + lbl + '</b><input type="time" id="pt_' + p + '_' + k + '_0" value="' + (v[0] || "") + '"><span>–</span><input type="time" id="pt_' + p + '_' + k + '_1" value="' + (v[1] || "") + '"></div>';
}
function savePeriods() {
  function g(p, k) { var a = $("pt_" + p + "_" + k + "_0").value, b = $("pt_" + p + "_" + k + "_1").value; return a && b && a < b ? [a, b] : null; }
  var bad = 0;
  PORDER.forEach(function (p) {
    var t = g(p, "t"); if (!t) { bad++; return; }
    var x = { t: t, in: g(p, "in"), out: g(p, "out") };
    var at2 = g(p, "at");
    if (at2) x.alt = { t: at2, in: g(p, "ain"), out: g(p, "aout") };
    S.periods[p] = x;
  });
  S.altBuildings = $("alt_b").value.trim();
  save(); closeSheet(); toast(bad ? "有 " + bad + " 个节次时间不完整，已跳过" : "已保存"); render();
}

/* ---- 备份 ---- */
function shareText(text, title) {
  try { if (window.Android && Android.share) { Android.share(text, title || "分享"); return; } } catch (e) {}
  if (navigator.share && !CAP.framed) { navigator.share({ title: title, text: text }).catch(function (e) { if (!e || e.name !== "AbortError") showCopy(text, title); }); return; }
  showCopy(text, title);
}
function exportData() {
  var txt = JSON.stringify(S);
  if (CAP.downloads) { CAP.downloads.save({ filename: "我的课堂备份-" + ymd(new Date()) + ".json", data: txt }).then(function (r) { if (r && r.status === "saved") toast("备份已保存"); }, function () { showCopy(txt, "我的课堂-备份"); }); return; }
  shareText(txt, "我的课堂-备份");
}
function exportText() {
  var keys = uniq(S.notes.map(function (n) { return n.key; })), out = "";
  keys.forEach(function (k) {
    out += "【" + k.replace("｜", " · ") + "】\n";
    notesFor(k).reverse().forEach(function (n) {
      out += "- " + n.date + (n.p ? " " + n.p + "节" : "") + " 第" + n.week + "周\n";
      if (n.progress) out += "  进度：" + n.progress + "\n";
      if (attSummaryPlain(n)) out += "  考勤：" + attSummaryPlain(n) + "\n";
      if (marksPlain(n)) out += "  表现：" + marksPlain(n) + "\n";
      if (n.students) out += "  学生：" + n.students + "\n";
      if (n.other) out += "  其他：" + n.other + "\n";
    });
    out += "\n";
  });
  shareText(out || "暂无记事", "课堂记事");
}
function importData() {
  openSheet('<h2>从备份恢复</h2><div class="sh">把之前导出的备份内容整段粘贴进来</div><textarea id="imp" style="min-height:160px"></textarea><button class="prim" onclick="doImport()">恢复</button>');
}
function doImport() {
  try {
    var s = JSON.parse($("imp").value.trim());
    if (!s || (!s.courses && !s.semesters) || !s.notes) throw 0;
    ask("将用备份覆盖当前数据，确定？", function () { applyBackup(s); }, "覆盖并恢复");
  } catch (e) { toast("内容不是有效的备份"); }
}
function applyBackup(s) {
  try {
    S = migrate(s); ensureFields(); save(); closeSheet(); toast("恢复成功"); render();
  } catch (e) { toast("内容不是有效的备份"); }
}
function resetAll() {
  ask("清空所有记事和课程修改？此操作无法撤销。", function () { S = defaults(); ensureFields(); save(); render(); }, "清空");
}


/* ================= 云端保存（在 claude.ai 里打开时：数据存到你的账号下，换设备也在） ================= */
var CLOUD = { db: null, base: null, written: {}, timer: 0, busy: false, ready: false, again: false };
function cloudDocs() {
  var core = {}; Object.keys(S).forEach(function (k) { if (k !== "notes") core[k] = S[k]; });
  var docs = { core: { json: JSON.stringify(core) } }, buckets = {};
  S.notes.forEach(function (n) { var b = "notes_" + (n.date || "0000-00").slice(0, 7); (buckets[b] = buckets[b] || []).push(n); });
  Object.keys(buckets).forEach(function (b) { docs[b] = { json: JSON.stringify(buckets[b]) }; });
  Object.keys(CLOUD.written).forEach(function (k) { if (!docs[k] && k.indexOf("notes_") === 0) docs[k] = { json: "[]" }; });
  return docs;
}
function cloudQueue() {
  if (!CLOUD.ready) return;
  clearTimeout(CLOUD.timer); CLOUD.timer = setTimeout(cloudFlush, 700);
}
async function cloudFlush() {
  if (!CLOUD.ready) return;
  if (CLOUD.busy) { CLOUD.again = true; return; }
  CLOUD.busy = true;
  try {
    var docs = cloudDocs();
    for (var k in docs) {
      if (CLOUD.written[k] === docs[k].json) continue;
      await CLOUD.db.collection(CLOUD.base).doc(k).set({ json: docs[k].json, at: Date.now() });
      CLOUD.written[k] = docs[k].json;
    }
    setCloudState("ok");
  } catch (e) {
    setCloudState(e && e.code === "quota_exceeded" ? "full" : "err");
  }
  CLOUD.busy = false;
  if (CLOUD.again) { CLOUD.again = false; cloudFlush(); }
}
function setCloudState(st) { CLOUD.state = st; var e = $("cloudline"); if (e) e.innerHTML = cloudLine(); }
function cloudLine() {
  if (!CAP.framed) return "";
  if (CLOUD.state === "ok") return "☁️ 已保存到你的 Claude 账号，换手机、换电脑打开都在";
  if (CLOUD.state === "err") return "⚠️ 云端保存失败，数据暂存在本机，稍后会重试";
  if (CLOUD.state === "full") return "⚠️ 云端空间已满，请导出备份后删除旧学期的记事";
  if (CLOUD.state === "off") return "⚠️ 没有连接到云端（请先登录 claude.ai），数据只保存在本机浏览器";
  return "☁️ 正在连接云端…";
}
async function cloudLoad() {
  var snap = await CLOUD.db.collection(CLOUD.base).get();
  var core = null, notes = [], written = {};
  snap.docs.forEach(function (d) {
    var b = d.data(); if (!b || typeof b.json !== "string") return;
    written[d.id] = b.json;
    try {
      if (d.id === "core") core = JSON.parse(b.json);
      else if (d.id.indexOf("notes_") === 0) notes = notes.concat(JSON.parse(b.json));
    } catch (e) {}
  });
  return { core: core, notes: notes, written: written };
}
async function cloudInit() {
  if (!CAP.framed) return;
  try {
    var db = await claude.use("db"), user = await claude.use("user");
    var id = user ? await user.id() : null;
    try { CAP.downloads = await claude.use("downloads"); } catch (e) {}
    try { var sm = await claude.use("sample"); if (sm) { var lim = await sm.limits().catch(function () { return null; }); CAP.sample = sm; CAP.sampleImages = lim && lim.images ? lim.images : null; } } catch (e) {}
    if (!db || !id) { setCloudState("off"); if (tab === "set") render(); return; }
    CLOUD.db = db; CLOUD.base = "data/users/" + id;
    var r = await cloudLoad();
    if (r.core) {
      r.core.notes = r.notes;
      S = migrate(r.core); ensureFields();
      CLOUD.written = r.written;
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    }
    CLOUD.ready = true;
    if (!r.core) cloudFlush(); else setCloudState("ok");
    if (!$("mask").classList.contains("show")) render();
  } catch (e) { setCloudState("err"); }
}
document.addEventListener("visibilitychange", async function () {
  if (document.hidden || !CLOUD.ready || CLOUD.busy || CLOUD.timer && false) return;
  try {
    var r = await cloudLoad();
    if (r.core && JSON.stringify(r.written) !== JSON.stringify(CLOUD.written) && !CLOUD.busy) {
      r.core.notes = r.notes; S = migrate(r.core); ensureFields(); CLOUD.written = r.written;
      if (!$("mask").classList.contains("show")) render();
    }
  } catch (e) {}
});

/* ---- 用 Claude 读图（在 claude.ai 里打开时），比离线识别更准 ---- */
async function imgBlob(file, maxBytes) {
  if (file.size <= (maxBytes || 4e6) && /jpe?g|png/.test(file.type)) return file;
  var img = await fileToImg(file), W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 2000 / Math.max(W, H));
  var c = document.createElement("canvas"); c.width = Math.round(W * k); c.height = Math.round(H * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(function (ok) { c.toBlob(ok, "image/jpeg", 0.85); });
}
async function aiSchedule(files) {
  var blobs = []; for (var i = 0; i < files.length; i++) blobs.push(await imgBlob(files[i], CAP.sampleImages.maxBytes));
  var prompt = "这些图片是一位中国高校教师的课表截图（教务系统“教师课表查询”页面，按顺序排列，可能跨多张）。" +
    "页面结构：彩色横条写着“[星期X]”，下面每行是：节次（如“3-4节”）| 课程名【起止周；教室号】| 班级。" +
    "请提取每一节课，只回复一个 JSON 数组，每项格式：" +
    '{"day":1到7(星期一=1),"p":"节次如3-4","name":"课程名（去掉“(引进课程)”这类括号后缀）","cls":"班级原样如25大数据与会计1(国际)","room":"教室号如3410","w1":起始周数字,"w2":结束周数字,"par":0每周/1单周/2双周}。' +
    "看不清的字段按最可能的写。不要输出任何其他文字。";
  var r = await CAP.sample.json(prompt, { images: blobs.slice(0, CAP.sampleImages.maxCount || 5), modelTier: "default" });
  if (!Array.isArray(r)) throw new Error("没有读到课程");
  return r.filter(function (c) { return c && c.day && c.p; }).map(function (c) {
    return { day: +c.day, p: String(c.p).replace(/[^\d-]/g, ""), name: String(c.name || ""), cls: String(c.cls || ""), room: String(c.room || ""), w1: +c.w1 || 1, w2: +c.w2 || 20, par: +c.par || 0 };
  }).filter(function (c) { return PORDER.indexOf(c.p) >= 0; });
}
async function aiCalendar(file) {
  var blob = await imgBlob(file, CAP.sampleImages.maxBytes);
  var prompt = "这张图是中国高校的学期校历。请读出：学期名称（如2026-2027学年第一学期）、第1周星期一的日期（看表格第1周那一行的周一）、总周数、" +
    "所有放假（日期段）、所有调课补课（某日补周几的课，注明单双周）、其他重要事项（如四六级考试、考试周、报到）。" +
    '只回复一个 JSON 对象：{"name":"","start":"YYYY-MM-DD","weeks":20,"holidays":[{"from":"YYYY-MM-DD","to":"YYYY-MM-DD","label":"国庆节放假"}],' +
    '"makeups":[{"date":"YYYY-MM-DD","asDay":5,"par":0或1单周或2双周}],"events":[{"date":"YYYY-MM-DD","label":""}]}。年份按学年推算（第一学期9-12月是前一年，1月是后一年）。不要输出其他文字。';
  var r = await CAP.sample.json(prompt, { images: [blob], modelTier: "default" });
  var sem = { id: "", name: String(r.name || "新学期"), start: ymd(mondayOf(parseYmd(r.start || ymd(new Date())))), weeks: +r.weeks || 20, courses: [],
    holidays: (r.holidays || []).map(function (h) { return { from: normD(h.from), to: normD(h.to || h.from), label: h.label || "放假" }; }),
    makeups: (r.makeups || []).map(function (m) { var par = +m.par || 0; return { date: normD(m.date), asDay: +m.asDay, par: par, label: "补" + WD[+m.asDay] + "的课" + (par ? (par === 1 ? "（单周）" : "（双周）") : "") }; }),
    events: (r.events || []).map(function (e) { return { date: normD(e.date), label: String(e.label) }; }) };
  return sem;
}

/* ================= 图片识别（离线 OCR） ================= */
var OCRW = null;
function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
function simdOK() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
}
async function ocrWorker(progress) {
  if (OCRW) return OCRW;
  if (!window.Tesseract) await loadScript("ocr/tesseract.min.js");
  progress && progress("正在加载识别引擎…");
  OCRW = await Tesseract.createWorker("chi_sim", 1, {
    workerPath: "ocr/worker.min.js",
    corePath: "ocr/core/" + (simdOK() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js"),
    langPath: "ocr/lang", gzip: !!IS_NATIVE, cacheMethod: "none", workerBlobURL: false
  });
  return OCRW;
}
function fileToImg(f) {
  return new Promise(function (ok, bad) {
    var r = new FileReader();
    r.onload = function () { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = bad; i.src = r.result; };
    r.onerror = bad; r.readAsDataURL(f);
  });
}
/* 裁出某一列（按宽度比例），放大+灰度，可选二值化 */
function cropCanvas(img, x0r, x1r, bin) {
  var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  var k = W < 1000 ? 2 : (W > 1600 ? 1600 / W * 1.4 : 1.4);
  var x0 = Math.round(W * x0r), x1 = Math.round(W * x1r);
  var c = document.createElement("canvas");
  c.width = Math.round((x1 - x0) * k); c.height = Math.round(H * k);
  var g = c.getContext("2d"); g.imageSmoothingQuality = "high";
  g.drawImage(img, x0, 0, x1 - x0, H, 0, 0, c.width, c.height);
  var d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for (var i = 0; i < a.length; i += 4) {
    var v = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2];
    if (bin) v = v < 150 ? 0 : 255;
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return { canvas: c, k: k };
}
async function ocrLines(img, x0r, x1r, bin) {
  var w = await ocrWorker();
  var cc = cropCanvas(img, x0r, x1r, bin);
  var r = await w.recognize(cc.canvas, {}, { blocks: true });
  var out = [];
  (r.data.blocks || []).forEach(function (b) { b.paragraphs.forEach(function (p) { p.lines.forEach(function (l) {
    out.push({ y0: l.bbox.y0 / cc.k, y1: l.bbox.y1 / cc.k, yc: (l.bbox.y0 + l.bbox.y1) / 2 / cc.k, text: l.text.replace(/\s+/g, "").trim() });
  }); }); });
  return out;
}

/* ---- 课表截图解析（教务系统“教师课表查询”页面：节次 | 课程【周次；教室】 | 班级） ---- */
var FIX = [[/效学/g, "数学"], [/期未/g, "期末"], [/[《〈<]/g, "("], [/[》〉>]/g, ")"], [/（/g, "("], [/）/g, ")"], [/[|｜]/g, ""]];
function fixText(s) { FIX.forEach(function (f) { s = s.replace(f[0], f[1]); }); return s; }
function lev(a, b) {
  var m = a.length, n = b.length, d = []; for (var i = 0; i <= m; i++) { d[i] = [i]; } for (var j = 0; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function snap(s, known) {
  if (!s) return s; var best = null, bd = 99;
  known.forEach(function (k) { var x = lev(s, k); if (x < bd) { bd = x; best = k; } });
  return best && bd > 0 && bd <= Math.max(1, Math.floor(s.length / 4)) ? best : s;
}

/* 课表页里“[星期X]”是彩色横条上的白字：按颜色找横条，再单独识别 */
async function detectDayBands(img) {
  var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  var sw = 120, sh = Math.round(H * sw / W);
  var c = document.createElement("canvas"); c.width = sw; c.height = sh;
  var g = c.getContext("2d"); g.drawImage(img, 0, 0, sw, sh);
  var a = g.getImageData(0, 0, sw, sh).data, rows = [];
  for (var y = 0; y < sh; y++) {
    var n = 0;
    for (var x = 0; x < sw; x++) {
      var i = (y * sw + x) * 4, mx = Math.max(a[i], a[i + 1], a[i + 2]), mn = Math.min(a[i], a[i + 1], a[i + 2]);
      if (mx - mn > 35 && mx > 90) n++;
    }
    rows.push(n / sw > 0.6);
  }
  var bands = [], y0 = -1;
  for (y = 0; y <= sh; y++) {
    if (y < sh && rows[y]) { if (y0 < 0) y0 = y; }
    else if (y0 >= 0) { if (y - y0 >= 2) bands.push([y0 * H / sh, y * H / sh]); y0 = -1; }
  }
  var w = await ocrWorker(), out = [];
  for (var k = 0; k < bands.length; k++) {
    var b0 = bands[k][0] + 2, b1 = bands[k][1] - 2, bw = Math.round(W * 0.5);
    var sc = 3, cv = document.createElement("canvas"); cv.width = bw * sc; cv.height = Math.round((b1 - b0) * sc);
    var gg = cv.getContext("2d"); gg.drawImage(img, 0, b0, bw, b1 - b0, 0, 0, cv.width, cv.height);
    var d = gg.getImageData(0, 0, cv.width, cv.height), p = d.data;
    var lums = [];
    for (var j = 0; j < p.length; j += 16) lums.push(0.3 * p[j] + 0.59 * p[j + 1] + 0.11 * p[j + 2]);
    lums.sort(function (x, y) { return x - y; });
    var bg = lums[Math.floor(lums.length / 2)], th = bg + (255 - bg) * 0.45;
    for (j = 0; j < p.length; j += 4) { var lv = 0.3 * p[j] + 0.59 * p[j + 1] + 0.11 * p[j + 2], v = lv > th ? 0 : 255; p[j] = p[j + 1] = p[j + 2] = v; }
    gg.putImageData(d, 0, 0);
    var r = await w.recognize(cv);
    var t = (r.data.text || "").replace(/\s+/g, "");
    var m = t.match(/[星呈][期朝斯]([一二三四五六日天])/) || t.match(/期([一二三四五六日天])/) || t.match(/周([一二三四五六日天])/);

    out.push({ y: (b0 + b1) / 2, y1: b1, day: m ? DAYC[m[1]] : 0 });
  }
  // 读不出来的按顺序推算
  for (k = 0; k < out.length; k++) if (!out[k].day && k > 0 && out[k - 1].day) { out[k].day = Math.min(7, out[k - 1].day + 1); out[k].guess = true; }
  return out.filter(function (h) { return h.day; });
}
async function parseScheduleImage(img, carryDay, status) {
  var H = img.naturalHeight || img.height;
  status("识别节次…");
  var L = await ocrLines(img, 0, 0.2, true);
  status("识别星期…");
  var heads = await detectDayBands(img);
  status("识别课程…");
  var M = await ocrLines(img, 0.2, 0.7, false);
  status("识别班级…");
  var R = await ocrLines(img, 0.7, 1, false);

  var labels = [];
  L.forEach(function (l) {
    var t = l.text.replace(/[_—~一]/g, "-");
    var m = t.match(/(\d{1,2})-(\d{1,2})节?/) || t.match(/^(\d)(\d)节/);
    if (m && +m[2] === +m[1] + 1) labels.push({ y: l.yc, p: m[1] + "-" + m[2] });
  });
  labels.sort(function (a, b) { return a.y - b.y; });
  var gaps = []; for (var i = 1; i < labels.length; i++) gaps.push(labels[i].y - labels[i - 1].y);
  gaps.sort(function (a, b) { return a - b; });
  var rowH = gaps.length ? gaps[Math.floor(gaps.length / 2)] : H / 10;
  rowH = Math.min(rowH, H / 3);

  var known = { name: uniq(allCourses().map(function (c) { return c.name; })), cls: uniq(allCourses().map(function (c) { return c.cls; })) };
  var out = [], day = carryDay;
  labels.forEach(function (lb, i) {
    var hAbove = heads.filter(function (h) { return h.y < lb.y; }).pop();
    if (hAbove) day = hAbove.day;
    if (!day) return;
    var top = lb.y - rowH / 2, bot = lb.y + rowH / 2;
    if (hAbove) top = Math.max(top, hAbove.y1 + 2);
    var hBelow = heads.find(function (h) { return h.y > lb.y; });
    if (hBelow) bot = Math.min(bot, hBelow.y - 2);
    function pick(arr) { return arr.filter(function (l) { return l.yc > top && l.yc < bot; }).map(function (l) { return l.text; }).join(""); }
    var mid = fixText(pick(M)), right = fixText(pick(R));
    if (!mid) return;
    var wk = mid.match(/(\d{1,2})[-—~至](\d{1,2})周/);
    var room = (mid.match(/周[;；:：,，.]?([A-Za-z]?\d{3,5})/) || [])[1] || "";
    var name = mid.split(/[【\[]/)[0];
    name = name.replace(/\(?引进课程?\)?|\(引进.*$/, "").replace(/\(+$/, "").replace(/[，,;；。.、"”']/g, "");
    var cls = right.replace(/[，,;；。.、"”']/g, "");
    name = snap(name, known.name); cls = snap(cls, known.cls);
    out.push({
      day: day, p: lb.p, name: name, cls: cls, room: room,
      w1: wk ? +wk[1] : 1, w2: wk ? +wk[2] : 20, par: /单周/.test(mid) ? 1 : (/双周/.test(mid) ? 2 : 0)
    });
  });
  return { courses: out, lastDay: day };
}

/* ---- 校历图片解析 ---- */
async function parseCalendarImage(img, status) {
  status("识别标题…");
  var all = await ocrLines(img, 0, 1, false);
  status("识别备注…");
  var rightL = await ocrLines(img, 0.58, 1, false);
  var txt = all.concat(rightL).map(function (l) { return fixText(l.text); });
  var full = txt.join("\n");
  var t = full.match(/(20\d\d)[-—一~至](20\d\d)学年第([一二12])学期/);
  var y1 = t ? +t[1] : new Date().getFullYear(), term = t ? (t[3] === "一" || t[3] === "1" ? 1 : 2) : 1;
  var y2 = t ? +t[2] : y1 + 1;
  function yr(m) { return term === 1 ? (m >= 7 ? y1 : y2) : y2; }
  function D(m, d) { return y_(yr(+m), +m, +d); }
  function y_(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  var s = { id: "", name: t ? y1 + "-" + y2 + "学年第" + (term === 1 ? "一" : "二") + "学期" : "新学期", start: "", weeks: 20, holidays: [], makeups: [], events: [], courses: [] };
  var wk = full.match(/在校(\d{1,2})周/); if (wk) s.weeks = +wk[1];
  var anchor = null, firstClass = null;
  txt.forEach(function (l) {
    var m;
    if ((m = l.match(/(\d{1,2})月(\d{1,2})日?(?:[-—~至]+(?:(\d{1,2})月)?(\d{1,2}))?日?放假/))) {
      s.holidays.push({ from: D(m[1], m[2]), to: m[4] ? D(m[3] || m[1], m[4]) : D(m[1], m[2]), label: "放假" });
    } else if ((m = l.match(/(\d{1,2})月(\d{1,2})日补(?:周|星期)([一二三四五六日])/))) {
      var par = /单/.test(l) ? 1 : (/双/.test(l) ? 2 : 0);
      s.makeups.push({ date: D(m[1], m[2]), asDay: DAYC[m[3]], par: par, label: "补" + WD[DAYC[m[3]]] + "的课" + (par ? (par === 1 ? "（单周）" : "（双周）") : "") });
    } else if ((m = l.match(/(\d{1,2})月(\d{1,2})日?(?:[-—~至]+(\d{1,2}))?日(.{2,20})/))) {
      var label = m[4].replace(/[，,。.]$/, "");
      if (/正式上班/.test(label) && !anchor) anchor = D(m[1], m[2]);
      if (/正式上课/.test(label)) { var dd = D(m[1], m[2]); if (!firstClass || dd < firstClass) firstClass = dd; }
      s.events.push({ date: D(m[1], m[2]), label: label + (m[3] ? "（至" + m[1] + "月" + m[3] + "日）" : "") });
    }
  });
  // 去重
  s.holidays = s.holidays.filter(function (h, i, a) { return a.findIndex(function (x) { return x.from === h.from; }) === i; });
  s.makeups = s.makeups.filter(function (h, i, a) { return a.findIndex(function (x) { return x.date === h.date; }) === i; });
  s.events = s.events.filter(function (h, i, a) { return a.findIndex(function (x) { return x.date === h.date && x.label === h.label; }) === i; });
  s.events.sort(function (a, b) { return a.date.localeCompare(b.date); });
  // 第1周：教职工正式上班所在周；否则最早“正式上课”所在周
  var base = anchor || firstClass || ymd(new Date());
  s.start = ymd(mondayOf(parseYmd(base)));
  // 节日标签
  s.holidays.forEach(function (h) {
    var mo = +h.from.slice(5, 7), dd = +h.from.slice(8);
    if (mo === 10 && dd <= 2) h.label = "国庆节放假"; else if (mo === 1 && dd <= 2) h.label = "元旦放假";
    else if (mo === 9 || (mo === 10 && dd > 2)) h.label = h.label === "放假" ? "中秋节放假" : h.label;
  });
  return { sem: s, found: !!t, anchor: anchor, n: s.holidays.length + s.makeups.length };
}

/* ---- 导入流程 UI ---- */
function pickImages(multiple, cb) {
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; if (multiple) inp.multiple = true;
  inp.onchange = function () { if (inp.files && inp.files.length) cb(Array.prototype.slice.call(inp.files)); };
  inp.click();
}
function progressSheet(title) {
  openSheet('<h2>' + title + '</h2><div class="sh">离线识别，不上传任何数据</div><div class="ocrbox"><div class="spin"></div><div id="ocr_st">准备中…</div></div><div style="font-size:12px;color:var(--ink3)">第一次识别需要加载引擎，约 10–30 秒</div>');
  return function (t) { var e = $("ocr_st"); if (e) e.textContent = t; };
}
var impDraft = null;
function importSchedule(semId) {
  var sem = S.semesters.find(function (s) { return s.id === semId; }); if (!sem) return;
  openSheet('<h2>导入课表截图</h2><div class="sh">导入到：' + esc(sem.name) + '</div>' +
    '<div class="hint">在“智慧经贸 → 教师课表查询”页面截图。一屏放不下就多截几张，按顺序一起选上。</div>' +
    '<button class="prim" onclick="startSchedOCR(\'' + semId + '\')">📷 选择截图</button>');
}
function startSchedOCR(semId) {
  if (CAP.framed && !CAP.sampleImages) { notice("识别图片需要允许本页“使用 Claude 读图”。请刷新页面后在弹出的权限提示里允许；也可以在课表页手动添加课程。"); return; }
  pickImages(true, async function (files) {
    var st = progressSheet("正在识别课表");
    window.ocrBusy = true; window.ocrCancel = false;
    var all = [], carry = 0;
    try {
      if (CAP.sampleImages) {
        st("正在让 Claude 读取 " + files.length + " 张截图…（约 10–30 秒）");
        all = await aiSchedule(files);
        files = [];
      } else await ocrWorker(st);
      for (var i = 0; i < files.length; i++) {
        if (window.ocrCancel) throw new Error("cancel");
        var img = await fileToImg(files[i]);
        var r = await parseScheduleImage(img, carry, function (t) { st("第 " + (i + 1) + "/" + files.length + " 张 · " + t); });
        carry = r.lastDay; all = all.concat(r.courses);
      }
    } catch (e) {
      window.ocrBusy = false;
      if (String(e && e.message) !== "cancel") { closeSheet(); notice("识别失败：" + (e && e.message ? e.message : e)); }
      return;
    }
    window.ocrBusy = false;
    // 同一星期+节次去重（截图重叠时）
    all = all.filter(function (c, i, a) { return a.findIndex(function (x) { return x.day === c.day && x.p === c.p; }) === i; });
    all.sort(function (a, b) { return a.day - b.day || PORDER.indexOf(a.p) - PORDER.indexOf(b.p); });
    impDraft = { semId: semId, courses: all };
    reviewImport();
  });
}
function reviewImport() {
  var sem = S.semesters.find(function (s) { return s.id === impDraft.semId; });
  var cs = impDraft.courses;
  var h = '<h2>识别到 ' + cs.length + ' 节课</h2><div class="sh">请核对，有错直接改；导入到 ' + esc(sem.name) + '</div>';
  if (!cs.length) h += '<div class="card empty">没有识别出课程。请确认截图是“教师课表查询”页面，并且包含“星期X”标题。</div>';
  cs.forEach(function (c, i) {
    h += '<div class="card imp"><div class="two"><select onchange="impSet(' + i + ',\'day\',+this.value)">' + [1, 2, 3, 4, 5, 6, 7].map(function (d) { return '<option value="' + d + '"' + (d === c.day ? " selected" : "") + '>' + WD[d] + '</option>'; }).join("") + '</select>' +
      '<select onchange="impSet(' + i + ',\'p\',this.value)">' + PORDER.map(function (p) { return '<option' + (p === c.p ? " selected" : "") + '>' + p + '</option>'; }).join("") + '</select>' +
      '<input value="' + esc(c.room) + '" placeholder="教室" onchange="impSet(' + i + ',\'room\',this.value.trim())"></div>' +
      '<input value="' + esc(c.cls) + '" placeholder="班级" onchange="impSet(' + i + ',\'cls\',this.value.trim())">' +
      '<input value="' + esc(c.name) + '" placeholder="课程" onchange="impSet(' + i + ',\'name\',this.value.trim())">' +
      '<div class="two" style="align-items:center"><input type="number" value="' + c.w1 + '" onchange="impSet(' + i + ',\'w1\',+this.value)"><span style="flex:none">–</span><input type="number" value="' + c.w2 + '" onchange="impSet(' + i + ',\'w2\',+this.value)"><span style="flex:none">周</span>' +
      '<button class="mini" style="flex:none;background:var(--redbg);color:var(--red)" onclick="impDel(' + i + ')">删</button></div></div>';
  });
  h += '<button class="sec" onclick="impAdd()">＋ 手动补一节</button>';
  if (cs.length) {
    h += '<button class="prim" onclick="applyImport(\'replace\')">替换为这些课（原 ' + sem.courses.length + ' 节）</button>';
    if (sem.courses.length) h += '<button class="sec" onclick="applyImport(\'merge\')">合并（同一星期、节次的覆盖，其余保留）</button>';
  }
  openSheet(h);
}
function impSet(i, k, v) { impDraft.courses[i][k] = v; }
function impDel(i) { impDraft.courses.splice(i, 1); var sc = $("sheet").scrollTop; reviewImport(); $("sheet").scrollTop = sc; }
function impAdd() { impDraft.courses.push({ day: 1, p: "1-2", name: "", cls: "", room: "", w1: 2, w2: 19, par: 0 }); reviewImport(); $("sheet").scrollTop = 1e6; }
function applyImport(mode) {
  var sem = S.semesters.find(function (s) { return s.id === impDraft.semId; });
  var cs = impDraft.courses.filter(function (c) { return c.name && c.cls; }).map(function (c) { c.id = uid(); c.par = c.par || 0; return c; });
  if (mode === "replace") sem.courses = cs;
  else {
    sem.courses = sem.courses.filter(function (o) { return !cs.some(function (c) { return c.day === o.day && c.p === o.p; }); }).concat(cs);
  }
  save(); closeSheet(); toast("课表已更新：" + sem.courses.length + " 节/周");
  tableSemId = sem.id; tab = "table"; render();
}
function importCalendar() {
  openSheet('<h2>导入校历图片</h2><div class="sh">拍照或截图学校发的校历（含“XXXX-XXXX学年第X学期”标题和备注）</div>' +
    '<div class="hint">会自动识别：学期名称、第1周日期、放假、调课补课、考试等事项。识别后可以核对修改。</div>' +
    '<button class="prim" onclick="startCalOCR()">📷 选择校历图片</button>');
}
function startCalOCR() {
  if (CAP.framed && !CAP.sampleImages) { notice("识别图片需要允许本页“使用 Claude 读图”。请刷新页面后在弹出的权限提示里允许；也可以在课表页手动添加课程。"); return; }
  pickImages(false, async function (files) {
    var st = progressSheet("正在识别校历");
    window.ocrBusy = true; window.ocrCancel = false;
    try {
      var r;
      if (CAP.sampleImages) { st("正在让 Claude 读取校历…（约 10–30 秒）"); r = { sem: await aiCalendar(files[0]), found: true }; }
      else {
        await ocrWorker(st);
        var img = await fileToImg(files[0]);
        r = await parseCalendarImage(img, st);
      }
      window.ocrBusy = false;
      if (!r.found) toast("没找到学年标题，请手动填写学期名称");
      var same = S.semesters.find(function (x) { return x.name === r.sem.name; });
      if (same) r.sem.courses = same.courses;
      editSemester(null, r.sem);
    } catch (e) {
      window.ocrBusy = false;
      if (!window.ocrCancel) { closeSheet(); notice("识别失败：" + (e && e.message ? e.message : e)); }
    }
  });
}


/* ---- 导出 .ics（iPhone 用日历提醒代替推送） ---- */
function icsTime(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsEsc(t) { return String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function minsDiff(a, b) { return Math.round((a - b) / 60000); }
function trig(m) { return (m < 0 ? "-" : "") + "PT" + Math.abs(m) + "M"; }
function exportICS() {
  var now = new Date(), sem = curSem(), days = sem ? Math.max(7, Math.ceil((semRange(sem)[1] - now) / 864e5)) : 60;
  days = Math.min(days, 150);
  var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//wodeketang//CN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:我的课堂"];
  var stamp = icsTime(now), n = 0;
  for (var i = 0; i < days; i++) {
    var d = addDays(now, i), occ = occurrencesOn(d), dps = punchesOn(d);
    occ.forEach(function (o) {
      if (o.end < now) return;
      var mine = dps.filter(function (p) { return p.o.oid === o.oid; });
      n++;
      L.push("BEGIN:VEVENT", "UID:" + o.oid + "-" + o.co.id + "@wodeketang", "DTSTAMP:" + stamp,
        "DTSTART:" + icsTime(o.start), "DTEND:" + icsTime(o.end),
        "SUMMARY:" + icsEsc(o.co.room + " " + short(o.co.cls) + " · " + o.co.name + (o.adj ? "（调课）" : "")),
        "LOCATION:" + icsEsc((o.tm.b ? o.tm.b + "号楼 " : "") + o.co.room),
        "DESCRIPTION:" + icsEsc(mine.map(function (p) { return p.name + " " + hm(p.s) + "–" + hm(p.e); }).join("\n") + (o.tm.alt ? "\n" + o.tm.b + "号楼时间" : "")));
      mine.forEach(function (p) {
        L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(p.name + " " + hm(p.s) + "–" + hm(p.e) + (p.kind === "out" ? "，记得记录进度" : "")), "TRIGGER:" + trig(minsDiff(p.s, o.start)), "END:VALARM");
      });
      L.push("END:VEVENT");
    });
    if (S.journalOn && occ.length) {
      var last = occ[occ.length - 1], js = new Date(last.end.getTime() + 10 * 60000);
      if (js > now) L.push("BEGIN:VEVENT", "UID:journal-" + ymd(d) + "@wodeketang", "DTSTAMP:" + stamp, "DTSTART:" + icsTime(js), "DTEND:" + icsTime(new Date(js.getTime() + 15 * 60000)),
        "SUMMARY:📒 填写教学日志", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:学校要求的教学日志填了吗？", "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
    }
  }
  L.push("END:VCALENDAR");
  if (CAP.downloads) {
    CAP.downloads.save({ filename: "我的课堂提醒.ics", data: new Blob([L.join("\r\n")], { type: "text/calendar" }) })
      .then(function (r) { if (r && r.status === "saved") toast("已生成 " + n + " 节课的提醒，打开文件选“添加到日历”"); }, function (e) { notice("导出没有成功：" + (e && e.message || e)); });
    return;
  }
  var blob = new Blob([L.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  var url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "我的课堂提醒.ics"; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  toast("已生成 " + n + " 节课的提醒，按提示“添加到日历”");
}

/* ================= 学生名单 · 点名 · 课堂表现 ================= */
var STATUS = ["在读", "休学", "长期请假", "退学", "转出"];
var ATT = { a: "缺勤", v: "请假", o: "出勤", l: "迟到", e: "早退" };
var ATT_ORDER = ["a", "v", "o", "l", "e"];
/* 出勤 = 学校安排公务、无法上课（不算缺勤）；缺勤/请假/出勤都不在教室，不计入实到、不参与抽人 */
function isAway(k) { return k === "a" || k === "v" || k === "o"; }
function zeroAtt() { return { a: 0, v: 0, o: 0, l: 0, e: 0, t: {} }; }
var MARK_TAGS = ["上台做题", "回答问题", "表扬", "需关注", "作业未交"];
var MARK_RES = { "上台做题": 1, "回答问题": 1 };
function rosterOf(cls) { return (S.rosters && S.rosters[cls]) || []; }
function isActive(st) { return !st.st || st.st === "在读"; }
function activeOf(cls) { return rosterOf(cls).filter(isActive); }
/* 保持名单原表顺序（与成绩册一致），不在读的排到最后；seq = 原表序号 */
function sortedRoster(cls) {
  var l = rosterOf(cls);
  l.forEach(function (x, i) { x._seq = i + 1; });
  return l.slice().sort(function (a, b) { return (isActive(b) - isActive(a)) || (a._seq - b._seq); });
}
function seqOf(st) { return st._seq ? pad(st._seq) : ""; }
function stuOf(cls, id) { return rosterOf(cls).find(function (x) { return x.id === id; }); }
function stuName(cls, id) { var s = stuOf(cls, id); return s ? s.name : id; }
function shortNo(id) { id = String(id || ""); return id.length > 2 ? id.slice(-2) : id; }
function rosterClasses() {
  var sem = curSem();
  return uniq(Object.keys(S.rosters || {}).concat(sem ? sem.courses.map(function (c) { return c.cls; }) : [])).sort();
}

/* ---- 记录里的摘要 ---- */
function attGroups(n) {
  var g = {}; Object.keys(n.att || {}).forEach(function (id) { var k = n.att[id]; (g[k] = g[k] || []).push(id); });
  return g;
}
function attSummaryText(n) {
  if (!n.att || !Object.keys(n.att).length) return n.attDone ? '<b style="color:var(--ok)">已点名 · 全到</b>' : "";
  var g = attGroups(n);
  return ATT_ORDER.filter(function (k) { return g[k]; }).map(function (k) {
    return '<b>' + ATT[k] + ' ' + g[k].length + '</b>：' + g[k].map(function (id) { return esc(stuName(n.cls, id)); }).join("、");
  }).join("　");
}
function attSummaryPlain(n) {
  if (!n.att) return n.attDone ? "全到" : "";
  var g = attGroups(n);
  return ATT_ORDER.filter(function (k) { return g[k]; }).map(function (k) { return ATT[k] + g[k].length + "（" + g[k].map(function (id) { return stuName(n.cls, id); }).join("、") + "）"; }).join("；");
}
function resLabel(r) { return r === "ok" ? "✓" : r === "no" ? "✗" : ""; }
function marksText(n) {
  if (!n.marks || !n.marks.length) return "";
  return n.marks.map(function (m) { return '<b>' + esc(stuName(n.cls, m.id)) + '</b> ' + esc(m.tag) + (m.res ? " " + resLabel(m.res) : ""); }).join("　");
}
function marksPlain(n) {
  if (!n.marks) return "";
  return n.marks.map(function (m) { return stuName(n.cls, m.id) + " " + m.tag + (m.res ? (m.res === "ok" ? "（对）" : "（错）") : ""); }).join("；");
}

/* ---- 记录页里的点名 ---- */
function drawAtt() {
  var c = editing, box = $("f_att"); if (!c || !box) return;
  var cls = c.co.cls, act = activeOf(cls), g = zeroAtt();
  Object.keys(c.att).forEach(function (id) { if (g[c.att[id]] !== undefined) g[c.att[id]]++; });
  var present = act.length - g.a - g.v - g.o;
  var h = '<div class="attsum"><div>应到 <b>' + act.length + '</b> · 实到 <b style="color:var(--ok)">' + present + '</b>' +
    ATT_ORDER.filter(function (k) { return g[k]; }).map(function (k) { return ' · ' + ATT[k] + ' <b style="color:var(--teal)">' + g[k] + '</b>'; }).join("") + '</div>' +
    '<button class="mini" onclick="editing.attOpen=!editing.attOpen;drawAtt()">' + (c.attOpen ? "收起" : "点名") + '</button></div>';
  if (!c.attOpen) {
    var names = Object.keys(c.att).map(function (id) { return stuName(cls, id) + "(" + ATT[c.att[id]] + ")"; });
    if (names.length) h += '<div style="font-size:13px;color:var(--ink2);margin-top:4px">' + esc(names.join("、")) + '</div>';
    box.innerHTML = h; return;
  }
  h += '<div class="attmode">' + ATT_ORDER.map(function (k) { return '<button data-k="' + k + '" class="' + (c.attMode === k ? "on" : "") + '" onclick="editing.attMode=\'' + k + '\';drawAtt()">' + ATT[k] + '</button>'; }).join("") +
    (Object.keys(c.att).length ? '<button onclick="editing.att={};drawAtt()">清空</button>' : "") + '</div>';
  h += '<div style="font-size:12px;color:var(--ink3);margin-bottom:6px">当前：点名字 = 标记“' + ATT[c.attMode] + '”，再点一次取消。“出勤”指学校安排公务不能上课。灰色为休学等不在读学生，不计入应到。</div>';
  h += '<div class="ngrid">' + sortedRoster(cls).map(function (st) {
    if (!isActive(st)) return '<div class="nm-btn off">' + esc(st.name) + '<small>' + esc(st.st) + '</small></div>';
    var k = c.att[st.id];
    return '<button class="nm-btn ' + (k || "") + '" onclick="attTap(\'' + esc(jsq(st.id)) + '\')">' + esc(st.name) + '<small>' + (k ? ATT[k] : seqOf(st)) + '</small></button>';
  }).join("") + '</div>';
  box.innerHTML = h;
}
function attTap(id) {
  var c = editing; if (!c) return;
  if (c.att[id] === c.attMode) delete c.att[id]; else c.att[id] = c.attMode;
  drawAtt();
}

/* ---- 课堂表现 ---- */
function drawMarks() {
  var c = editing, box = $("f_marks"); if (!c || !box) return;
  box.innerHTML = c.marks.map(function (m, i) {
    return '<span class="mk">' + esc(stuName(c.co.cls, m.id)) + ' · ' + esc(m.tag) +
      (MARK_RES[m.tag] ? '<button class="res ' + (m.res || "") + '" onclick="cycleRes(' + i + ')">' + (m.res === "ok" ? "✓ 对" : m.res === "no" ? "✗ 错" : "对错?") + '</button>' : "") +
      '<button class="x" aria-label="删除" onclick="editing.marks.splice(' + i + ',1);drawMarks()">✕</button></span>';
  }).join("");
}
function cycleRes(i) { var m = editing.marks[i]; m.res = !m.res ? "ok" : m.res === "ok" ? "no" : ""; drawMarks(); }
function addMark(tag, lucky) {
  var c = editing; if (!c) return;
  openPick(c.co.cls, "选择学生 · " + tag, function (id) {
    c.marks.push({ id: id, tag: tag, res: "" }); drawMarks(); toast(stuName(c.co.cls, id) + " · " + tag);
  }, { lucky: !!lucky, skip: c.att });
}
/* 首页“点名”按钮：显示本节点名情况，点开直接进入点名 */
function attBtn(o) {
  var n = noteForOcc(o), att = (n && n.att) || {}, g = zeroAtt();
  Object.keys(att).forEach(function (id) { if (g[att[id]] !== undefined) g[att[id]]++; });
  var done = n && (n.attDone || Object.keys(att).length);
  var miss = ATT_ORDER.filter(function (k) { return g[k]; }).map(function (k) { return ATT[k].slice(0, 1) + g[k]; }).join(" ");
  return '<button class="hbtn' + (done ? " done" : "") + '" onclick="attFromHero(\'' + o.oid + '\')">📋 ' + (done ? (miss || "全到 ✓") : "点名") + '</button>';
}
function attFromHero(oid) {
  var o = findOcc(oid); if (!o) return;
  noteEditor({ co: o.co, oid: o.oid, date: o.date, p: o.co.p, week: o.week, note: noteForOcc(o), autoAtt: true });
}
function luckyFromHero(oid) {
  var o = findOcc(oid); if (!o) return;
  noteEditor({ co: o.co, oid: o.oid, date: o.date, p: o.co.p, week: o.week, note: noteForOcc(o), autoLucky: true });
}

/* ---- 选学生（含随机抽人） ---- */
var PICK = null;
function openPick(cls, title, cb, opt) {
  PICK = { cls: cls, title: title, cb: cb, q: "", skip: (opt && opt.skip) || {}, lucky: null };
  $("pickmask").classList.add("show");
  drawPick();
  if (opt && opt.lucky) pickLucky();
}
function closePick() { $("pickmask").classList.remove("show"); PICK = null; }
$("pickmask").addEventListener("click", function (e) { if (e.target === $("pickmask")) closePick(); });
function drawPick() {
  if (!PICK) return;
  var list = sortedRoster(PICK.cls).filter(function (st) { return !PICK.q || st.name.indexOf(PICK.q) >= 0 || String(st.id).indexOf(PICK.q) >= 0; });
  var h = '<div class="shead"><div><h2 style="font-size:17px;margin:0">' + esc(PICK.title) + '</h2><div class="sh" style="margin:2px 0 8px">' + esc(short(PICK.cls)) + '</div></div><button class="xbtn" onclick="closePick()">✕</button></div>';
  if (PICK.lucky) {
    h += '<div class="lucky"><small>🎲 随机抽到</small><b id="luckyname">' + esc(stuName(PICK.cls, PICK.lucky)) + '</b><small>学号 ' + esc(PICK.lucky) + '</small>' +
      '<div class="two"><button class="g" onclick="pickLucky()">再抽一次</button><button onclick="pickChoose(PICK.lucky)">就是 TA</button></div></div>';
  } else {
    h += '<button class="prim" style="margin:4px 0 10px" onclick="pickLucky()">🎲 随机抽一位</button>';
  }
  h += '<input id="pick_q" placeholder="搜姓名或学号" value="' + esc(PICK.q) + '" oninput="PICK.q=this.value.trim();drawPickList()" style="margin-bottom:8px">';
  h += '<div id="pick_list"></div>';
  $("pickbox").innerHTML = h;
  drawPickList();
}
function drawPickList() {
  if (!PICK) return;
  var list = sortedRoster(PICK.cls).filter(function (st) { return !PICK.q || st.name.indexOf(PICK.q) >= 0 || String(st.id).indexOf(PICK.q) >= 0; });
  $("pick_list").innerHTML = '<div class="ngrid">' + list.map(function (st) {
    if (!isActive(st)) return '<div class="nm-btn off">' + esc(st.name) + '<small>' + esc(st.st) + '</small></div>';
    var k = PICK.skip[st.id];
    return '<button class="nm-btn' + (isAway(k) ? " off" : "") + '" onclick="pickChoose(\'' + esc(jsq(st.id)) + '\')">' + esc(st.name) + '<small>' + (k ? ATT[k] : seqOf(st)) + '</small></button>';
  }).join("") + '</div>' + (list.length ? "" : '<div class="empty">没有找到</div>');
}
function pickLucky() {
  if (!PICK) return;
  var pool = activeOf(PICK.cls).filter(function (st) { var k = PICK.skip[st.id]; return !isAway(k); });
  if (!pool.length) { toast("没有可抽的学生"); return; }
  var final = pool[Math.floor(Math.random() * pool.length)].id;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  PICK.lucky = final; drawPick();
  if (reduce) return;
  var el = $("luckyname"), n = 0;
  var t = setInterval(function () {
    if (!PICK || !$("luckyname")) { clearInterval(t); return; }
    n++;
    if (n > 12) { clearInterval(t); $("luckyname").textContent = stuName(PICK.cls, final); return; }
    $("luckyname").textContent = pool[Math.floor(Math.random() * pool.length)].name;
  }, 55);
}
function pickChoose(id) { var cb = PICK && PICK.cb; closePick(); if (cb) cb(id); }

/* ---- 学生页 ---- */
var stuCls = null, stuQ = "";
function defaultStuCls() {
  var cs = rosterClasses(); if (!cs.length) return null;
  if (stuCls && cs.indexOf(stuCls) >= 0) return stuCls;
  var nx = (occCache || []).find(function (o) { return o.end > new Date() && rosterOf(o.co.cls).length; });
  return nx ? nx.co.cls : cs[0];
}
function stuStats(cls) {
  var m = {};
  S.notes.forEach(function (n) {
    if (n.cls !== cls) return;
    Object.keys(n.att || {}).forEach(function (id) { var x = m[id] = m[id] || zeroAtt(); x[n.att[id]]++; });
    (n.marks || []).forEach(function (k) { var x = m[k.id] = m[k.id] || zeroAtt(); var t = x.t[k.tag] = x.t[k.tag] || { n: 0, ok: 0, no: 0 }; t.n++; if (k.res) t[k.res]++; });
  });
  return m;
}
function statPills(x) {
  if (!x) return "";
  var h = "";
  ATT_ORDER.forEach(function (k) { if (x[k]) h += '<span class="stat' + (k === "o" || k === "v" ? "" : " bad") + '">' + ATT[k] + x[k] + '</span>'; });
  MARK_TAGS.forEach(function (t) {
    var y = x.t[t]; if (!y) return;
    var good = t === "表扬" || (MARK_RES[t] && y.ok);
    h += '<span class="stat' + (t === "需关注" || t === "作业未交" ? " bad" : good ? " good" : "") + '">' + t.replace("上台", "") + y.n + (MARK_RES[t] && (y.ok || y.no) ? "·对" + y.ok : "") + '</span>';
  });
  return h;
}
function renderStudents() {
  var cs = rosterClasses();
  stuCls = defaultStuCls();
  var h = "";
  if (!cs.length) {
    $("view").innerHTML = '<div class="card"><b>还没有学生名单</b><div style="font-size:13px;color:var(--ink2);margin:4px 0 8px">导入名单后，上课可以直接点名、随机抽人，并记录每个学生的上台做题、回答问题等情况。</div><button class="prim" style="margin-top:6px" onclick="importRoster()">导入学生名单</button></div>';
    return;
  }
  h += '<div class="chips">' + cs.map(function (c) { return '<button class="fchip' + (c === stuCls ? " on" : "") + '" onclick="stuCls=\'' + esc(jsq(c)) + '\';stuQ=\'\';renderStudents()">' + esc(short(c)) + '</button>'; }).join("") + '</div>';
  var all = rosterOf(stuCls), act = all.filter(isActive);
  var cnt = {}; all.forEach(function (st) { if (!isActive(st)) cnt[st.st] = (cnt[st.st] || 0) + 1; });
  h += '<div class="card" style="margin-top:10px;padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b>' + esc(stuCls) + '</b><div style="font-size:13px;color:var(--ink2)">在读 <b style="color:var(--teal)">' + act.length + '</b> 人 · 共 ' + all.length + ' 人' +
    Object.keys(cnt).map(function (k) { return " · " + k + " " + cnt[k]; }).join("") + '</div></div>' +
    '<button class="mini" onclick="importRoster(\'' + esc(jsq(stuCls)) + '\')">导入/更新</button></div></div>';
  if (!all.length) {
    h += '<div class="card empty">这个班还没有名单。点上方“导入/更新”，或<button class="mini" onclick="addStu()">手动添加</button></div>';
    $("view").innerHTML = h; return;
  }
  h += '<input class="search" id="stu_q" placeholder="搜姓名或学号" value="' + esc(stuQ) + '" oninput="stuQ=this.value.trim();drawStuList()">';
  h += '<div id="stulist"></div>';
  h += '<div style="display:flex;gap:8px;margin-top:8px"><button class="sec" style="margin:0" onclick="addStu()">＋ 添加学生</button><button class="sec" style="margin:0" onclick="openPick(stuCls,\'随机抽人\',function(id){openStu(stuCls,id)},{lucky:true})">🎲 随机抽人</button></div>';
  $("view").innerHTML = h;
  drawStuList();
}
function drawStuList() {
  var stats = stuStats(stuCls);
  var list = sortedRoster(stuCls).filter(function (st) { return !stuQ || st.name.indexOf(stuQ) >= 0 || String(st.id).indexOf(stuQ) >= 0; });
  $("stulist").innerHTML = list.map(function (st) {
    var off = !isActive(st);
    return '<div class="stu' + (off ? " off" : "") + '" onclick="openStu(stuCls,\'' + esc(jsq(st.id)) + '\')"><div class="no">' + seqOf(st) + '</div>' +
      '<div class="nm">' + esc(st.name) + (st.memo ? '<small>' + esc(st.memo) + '</small>' : "") + '</div>' +
      '<div class="st">' + (off ? '<span class="chip m">' + esc(st.st) + '</span>' : statPills(stats[st.id])) + '</div></div>';
  }).join("") || '<div class="empty">没有找到</div>';
}
function openStu(cls, id) {
  var st = stuOf(cls, id); if (!st) return;
  var x = stuStats(cls)[id] || zeroAtt();
  var h = '<div class="shead"><div><h2 style="' + (isActive(st) ? "" : "color:var(--ink3)") + '">' + esc(st.name) + '</h2><div class="sh">' + esc(short(cls)) + ' · 学号 ' + esc(st.id) + '</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  h += '<label class="fl" style="margin-top:4px">学籍状态 <em>非“在读”时名字变灰，点名不计入应到</em></label><div class="seg">' +
    STATUS.map(function (k) { return '<button class="' + ((st.st || "在读") === k ? "on" + (k !== "在读" ? " off" : "") : "") + '" onclick="setStuStatus(\'' + esc(jsq(cls)) + '\',\'' + esc(jsq(id)) + '\',\'' + k + '\')">' + k + '</button>'; }).join("") + '</div>';
  h += '<label class="fl">备注 <em>如：班长、坐第一排、近视</em></label><input id="stu_memo" value="' + esc(st.memo || "") + '" onchange="saveStuMemo(\'' + esc(jsq(cls)) + '\',\'' + esc(jsq(id)) + '\',this.value)">';
  var t = function (k) { return x.t[k] || { n: 0, ok: 0, no: 0 }; };
  h += '<label class="fl">本学期统计</label><div class="kv">' +
    '<div><b>' + x.a + '</b><i>缺勤</i></div><div><b>' + x.v + '</b><i>请假</i></div><div><b>' + x.o + '</b><i>出勤（公务）</i></div>' +
    '<div><b>' + x.l + '</b><i>迟到</i></div><div><b>' + x.e + '</b><i>早退</i></div>' +
    '<div><b>' + t("上台做题").n + '</b><i>上台做题' + (t("上台做题").ok + t("上台做题").no ? " · 对" + t("上台做题").ok : "") + '</i></div>' +
    '<div><b>' + t("回答问题").n + '</b><i>回答问题</i></div><div><b>' + t("表扬").n + '</b><i>表扬</i></div><div><b>' + t("需关注").n + '</b><i>需关注</i></div></div>';
  var hist = S.notes.filter(function (n) { return n.cls === cls && ((n.att && n.att[id]) || (n.marks || []).some(function (m) { return m.id === id; })); })
    .sort(function (a, b) { return (b.date + b.p).localeCompare(a.date + a.p); });
  h += '<label class="fl">课堂记录 <em>' + hist.length + ' 次</em></label>';
  if (!hist.length) h += '<div class="empty">还没有关于 TA 的记录</div>';
  hist.forEach(function (n) {
    var d = parseYmd(n.date), bits = [];
    if (n.att && n.att[id]) bits.push('<span class="stat' + (n.att[id] === "o" || n.att[id] === "v" ? "" : " bad") + '">' + ATT[n.att[id]] + '</span>');
    (n.marks || []).filter(function (m) { return m.id === id; }).forEach(function (m) { bits.push('<span class="stat' + (m.res === "ok" || m.tag === "表扬" ? " good" : m.res === "no" || m.tag === "需关注" || m.tag === "作业未交" ? " bad" : "") + '">' + esc(m.tag) + (m.res ? " " + resLabel(m.res) : "") + '</span>'); });
    h += '<div class="row" style="cursor:default"><div class="m"><div class="c" style="font-weight:700">' + md(d) + " " + WD[dow(d)] + (n.p ? " · " + pLabel(n.p) : "") + '</div><div class="s">' + esc(n.course || "") + '</div></div><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' + bits.join("") + '</div></div>';
  });
  h += '<button class="sec" onclick="editStu(\'' + esc(jsq(cls)) + '\',\'' + esc(jsq(id)) + '\')">修改姓名 / 学号</button>';
  h += '<button class="sec danger" onclick="ask(\'从名单中删除 ' + esc(jsq(st.name)) + '？（已有记录保留，名字会显示为学号）\',function(){delStu(\'' + esc(jsq(cls)) + '\',\'' + esc(jsq(id)) + '\')},\'删除\')">从名单删除</button>';
  openSheet(h);
}
function setStuStatus(cls, id, st) {
  var s = stuOf(cls, id); if (!s) return;
  s.st = st; save(); toast(s.name + "：" + st); openStu(cls, id); if (tab === "stu") drawStuList();
}
function saveStuMemo(cls, id, v) { var s = stuOf(cls, id); if (!s) return; s.memo = v.trim(); save(); if (tab === "stu") drawStuList(); }
function delStu(cls, id) {
  S.rosters[cls] = rosterOf(cls).filter(function (x) { return x.id !== id; }); save(); closeSheet(); toast("已删除"); render();
}
function editStu(cls, id) {
  var s = id ? stuOf(cls, id) : { id: "", name: "" };
  openSheet('<div class="shead"><div><h2>' + (id ? "修改学生" : "添加学生") + '</h2><div class="sh">' + esc(cls) + '</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>' +
    '<label class="fl">姓名</label><input id="se_name" value="' + esc(s.name) + '">' +
    '<label class="fl">学号</label><input id="se_id" inputmode="numeric" value="' + esc(s.id) + '">' +
    '<button class="prim" onclick="saveStu(\'' + esc(jsq(cls)) + '\',\'' + esc(jsq(id || "")) + '\')">保存</button>');
}
function addStu() { editStu(stuCls, ""); }
function saveStu(cls, oldId) {
  var name = $("se_name").value.trim(), nid = $("se_id").value.trim();
  if (!name) { toast("请填写姓名"); return; }
  if (!nid) nid = "x" + uid();
  var list = S.rosters[cls] = rosterOf(cls).slice();
  if (nid !== oldId && list.some(function (x) { return x.id === nid; })) { toast("这个学号已存在"); return; }
  if (oldId) {
    var s = list.find(function (x) { return x.id === oldId; }); s.name = name;
    if (nid !== oldId) {
      s.id = nid;
      S.notes.forEach(function (n) {
        if (n.cls !== cls) return;
        if (n.att && n.att[oldId]) { n.att[nid] = n.att[oldId]; delete n.att[oldId]; }
        (n.marks || []).forEach(function (m) { if (m.id === oldId) m.id = nid; });
      });
    }
  } else list.push({ id: nid, name: name, st: "在读" });
  save(); closeSheet(); toast("已保存"); render();
}

/* ---- 导入名单：Excel（学校成绩册 / 任意含“学号、姓名”列的表）或粘贴 ---- */
var RIMP = null;
function importRoster(cls) {
  var h = '<div class="shead"><div><h2>导入学生名单</h2><div class="sh">学校成绩册、教务导出的名单表都可以，只要有“学号”“姓名”两列</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  h += '<button class="prim" onclick="pickRosterFiles()">📄 选择 Excel 文件（可多选）</button>';
  h += '<div style="font-size:12px;color:var(--ink3);margin-top:6px">支持 .xlsx / .xls，会自动识别表头里的“班级：”。可以一次选几个班的文件。</div>';
  h += '<label class="fl" style="margin-top:18px">或者粘贴名单 <em>每行一个：学号 姓名（没有学号就只写姓名）</em></label>';
  h += '<select id="rp_cls">' + rosterClasses().map(function (c) { return '<option' + (c === (cls || stuCls) ? " selected" : "") + '>' + esc(c) + '</option>'; }).join("") + '<option value="">新班级…</option></select>';
  h += '<input id="rp_new" placeholder="新班级名称，如 25会计4(国际)" style="margin-top:6px">';
  h += '<textarea id="rp_txt" style="min-height:140px;margin-top:6px" placeholder="2601001 张三\n2601002 李四"></textarea>';
  h += '<button class="sec" onclick="pasteRoster()">导入粘贴的名单</button>';
  openSheet(h);
}
function pickRosterFiles() {
  var inp = document.createElement("input");
  inp.type = "file"; inp.multiple = true;
  inp.accept = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
  inp.onchange = async function () {
    var files = Array.prototype.slice.call(inp.files || []); if (!files.length) return;
    try {
      if (!window.XLSX) await loadScript("lib/xlsx.core.min.js");
      var found = [];
      for (var i = 0; i < files.length; i++) {
        var buf = await files[i].arrayBuffer();
        var wb = XLSX.read(buf, { type: "array" });
        wb.SheetNames.forEach(function (sn) {
          var r = parseRosterSheet(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: "" }), files[i].name);
          if (r && r.list.length) found.push(r);
        });
      }
      if (!found.length) { notice("没有在表格里找到“学号”“姓名”两列。请确认是学生名单或成绩册。"); return; }
      RIMP = found; reviewRoster();
    } catch (e) { notice("读取表格失败：" + (e && e.message ? e.message : e)); }
  };
  inp.click();
}
function parseRosterSheet(rows, fname) {
  var cls = "", hr = -1, ci = -1, ni = -1;
  for (var r = 0; r < Math.min(rows.length, 30); r++) {
    var row = rows[r].map(function (v) { return String(v || "").replace(/\s+/g, ""); });
    row.forEach(function (v, c) {
      if (!cls && /^班级[:：]?$/.test(v)) { for (var k = c + 1; k < row.length; k++) if (row[k]) { cls = row[k]; break; } }
      else if (!cls && /^班级[:：].+/.test(v)) cls = v.replace(/^班级[:：]/, "");
    });
    if (hr < 0) {
      var a = row.findIndex(function (v) { return v === "学号"; }), b = row.findIndex(function (v) { return v === "姓名"; });
      if (b >= 0) { hr = r; ci = a; ni = b; }
    }
  }
  if (hr < 0) return null;
  var list = [], seen = {};
  for (r = hr + 1; r < rows.length; r++) {
    var id = ci >= 0 ? String(rows[r][ci] || "").trim() : "", nm = String(rows[r][ni] || "").replace(/\s+/g, "");
    if (!nm || /^(合计|总计|备注|签字|任课)/.test(nm)) continue;
    if (/^\d+\.0$/.test(id)) id = id.replace(/\.0$/, "");
    if (!id) id = "x" + uid();
    if (seen[id]) continue; seen[id] = 1;
    list.push({ id: id, name: nm, st: "在读" });
  }
  if (!cls) { var m = String(fname || "").match(/\d{2}[^_\s.]+?\d\s*[（(]?国际[)）]?/); if (m) cls = m[0]; }
  return { cls: cls, list: list, fname: fname };
}
function reviewRoster() {
  var classes = rosterClasses();
  var h = '<div class="shead"><div><h2>识别到 ' + RIMP.length + ' 个名单</h2><div class="sh">核对班级名称（要和课表里的班级一致），再导入</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>';
  RIMP.forEach(function (r, i) {
    var exist = rosterOf(r.cls).length;
    h += '<div class="card imp"><div style="font-size:12px;color:var(--ink3)">' + esc(r.fname || "") + '</div>' +
      '<input list="rcl" value="' + esc(r.cls) + '" placeholder="班级名称" onchange="RIMP[' + i + '].cls=this.value.trim();reviewRoster()">' +
      '<div style="font-size:13px;margin-top:6px"><b>' + r.list.length + '</b> 人：' + esc(r.list.slice(0, 6).map(function (x) { return x.name; }).join("、")) + (r.list.length > 6 ? "…" : "") + '</div>' +
      (exist ? '<div style="font-size:12px;color:var(--amber);margin-top:2px">这个班已有 ' + exist + ' 人；导入后按学号更新，已设置的休学等状态会保留</div>' : "") + '</div>';
  });
  h += '<datalist id="rcl">' + classes.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("") + '</datalist>';
  h += '<button class="prim" onclick="applyRosters()">导入</button>';
  openSheet(h);
}
function mergeRoster(cls, list) {
  var old = rosterOf(cls), byId = {};
  old.forEach(function (x) { byId[x.id] = x; });
  var merged = list.map(function (x) { var o = byId[x.id]; return o ? Object.assign({}, o, { name: x.name }) : x; });
  old.forEach(function (x) { if (!merged.some(function (y) { return y.id === x.id; })) merged.push(x); });
  S.rosters[cls] = merged;
}
function applyRosters() {
  var bad = RIMP.filter(function (r) { return !r.cls; });
  if (bad.length) { toast("请填写每个名单的班级名称"); return; }
  var n = 0;
  RIMP.forEach(function (r) { mergeRoster(r.cls, r.list); n += r.list.length; });
  stuCls = RIMP[0].cls; RIMP = null;
  save(); closeSheet(); toast("已导入 " + n + " 名学生"); tab = "stu"; render();
}
function pasteRoster() {
  var cls = $("rp_cls").value || $("rp_new").value.trim();
  if (!cls) { toast("请选择或填写班级"); return; }
  var list = [];
  $("rp_txt").value.split(/\n/).forEach(function (l) {
    l = l.trim(); if (!l) return;
    var m = l.match(/^(\S*\d\S*)[\s,，\t]+(\S+)/) || l.match(/^(\S+)[\s,，\t]+(\d{5,})$/);
    if (m && /\d/.test(m[1])) list.push({ id: m[1], name: m[2], st: "在读" });
    else if (m) list.push({ id: m[2], name: m[1], st: "在读" });
    else list.push({ id: "x" + uid(), name: l.replace(/\s+/g, ""), st: "在读" });
  });
  if (!list.length) { toast("没有读到名字"); return; }
  mergeRoster(cls, list); stuCls = cls;
  save(); closeSheet(); toast("已导入 " + list.length + " 名学生"); tab = "stu"; render();
}


/* ================= 自定义背景 ================= */
var BGKEY = KEY + "_bg";
function bgOpt() { return Object.assign({ fade: 58, sat: 55, blur: 1 }, S.bgOpt || {}); }
function bgImg() { try { return localStorage.getItem(BGKEY) || ""; } catch (e) { return ""; } }
function applyBg() {
  var img = bgImg(), o = bgOpt(), L = $("bgl"), F = $("bgf");
  if (!L) {
    L = document.createElement("div"); L.id = "bgl"; F = document.createElement("div"); F.id = "bgf";
    document.body.insertBefore(F, document.body.firstChild); document.body.insertBefore(L, F);
  }
  document.body.classList.toggle("hasbg", !!img);
  L.style.backgroundImage = img ? "url(" + img + ")" : "none";
  L.style.filter = "saturate(" + o.sat + "%) blur(" + o.blur + "px)";
  F.style.background = img ? "rgba(248,245,245," + (o.fade / 100) + ")" : "transparent";
}
function pickBg() {
  var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
  inp.onchange = async function () {
    var f = inp.files && inp.files[0]; if (!f) return;
    try {
      var img = await fileToImg(f), W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 1280 / Math.max(W, H));
      var c = document.createElement("canvas"); c.width = Math.round(W * k); c.height = Math.round(H * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      var url = c.toDataURL("image/jpeg", 0.82);
      try { localStorage.setItem(BGKEY, url); } catch (e) { notice("图片太大，存不下。换一张小一点的照片试试。"); return; }
      applyBg(); toast("背景已更换"); if (tab === "set") render();
    } catch (e) { notice("读取图片失败：" + (e && e.message ? e.message : e)); }
  };
  inp.click();
}
function clearBg() { try { localStorage.removeItem(BGKEY); } catch (e) {} applyBg(); toast("已恢复纯色背景"); render(); }
function setBgOpt(k, v) { S.bgOpt = Object.assign(bgOpt(), {}); S.bgOpt[k] = +v; applyBg(); var e = $("bgv_" + k); if (e) e.textContent = bgLabel(k, +v); }
function bgLabel(k, v) { return k === "fade" ? v + "%" : k === "sat" ? v + "%" : v + "px"; }
function bgCard() {
  var img = bgImg(), o = bgOpt();
  var h = '<div class="card"><b>背景图片</b><div style="font-size:13px;color:var(--ink2);margin:2px 0 8px">选一张手机里的照片当背景，会自动调淡、降低饱和度，保证文字看得清。</div>';
  if (img) {
    h += '<div class="bgprev" style="background-image:url(' + img + ');filter:saturate(' + o.sat + '%)"></div>';
    [["fade", "淡化", 30, 95], ["sat", "色彩", 0, 100], ["blur", "模糊", 0, 12]].forEach(function (x) {
      h += '<div class="slider"><span>' + x[1] + '</span><input type="range" min="' + x[2] + '" max="' + x[3] + '" value="' + o[x[0]] + '" oninput="setBgOpt(\'' + x[0] + '\',this.value)" onchange="save()"><em id="bgv_' + x[0] + '">' + bgLabel(x[0], o[x[0]]) + '</em></div>';
    });
    h += '<div class="two"><button class="sec" onclick="pickBg()">换一张</button><button class="sec" onclick="clearBg()">恢复纯色</button></div>';
  } else {
    h += '<button class="sec" style="margin-top:0" onclick="pickBg()">🖼 选择照片</button>';
  }
  return h + '</div>';
}

/* ================= 启动 ================= */
applyBg();
save();
render();
cloudInit();
(function welcome() {
  var cs = curSem();
  if (S.welcomed || !cs || cs.courses.length) return;
  S.welcomed = true; save();
  openSheet('<div class="shead"><div><h2>欢迎使用“我的课堂”</h2><div class="sh">已内置河南经贸 2026-2027 学年第一学期校历和作息时间（含 4、5 号楼第 3-4 节单独时间）</div></div><button class="xbtn" onclick="closeSheet()">✕</button></div>' +
    '<div class="hint">只差一步：导入你自己的课表。<br>打开微信“智慧经贸 → 教师课表查询”，把一周的课截图（一屏放不下就截几张），在这里选上即可自动识别，识别后可以核对修改。</div>' +
    '<button class="prim" onclick="importSchedule(\'' + cs.id + '\')">📷 导入课表截图</button>' +
    '<button class="sec" onclick="closeSheet();tab=\'table\';tableSemId=\'' + cs.id + '\';render();editCourse(null)">手动一节一节添加</button>' +
    '<div class="hint" style="margin-top:12px">导入课表后，可在“学生”页导入各班名单（学校成绩册 Excel 直接能用），上课时就能点名、随机抽人。</div>' +
    '<div style="font-size:12px;color:var(--ink3);margin-top:10px">所有数据只保存在你自己的手机上。</div>');
})();
if (!IS_NATIVE && !CAP.framed) {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
}
