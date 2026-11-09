/* 授课计划解析：从 Word(.docx) 的表格里读出“周次 / 日期 / 教学内容 / 课时 / 教学方法 / 思政 / 作业”等列。
   不依赖浏览器 DOM，安卓、iPhone、电脑都能用；格式不同的授课计划按表头关键字自动识别。 */
(function (root) {
  "use strict";
  function decode(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&amp;/g, "&");
  }
  // 取出一段 XML 里与 open 标签配对的块（处理嵌套）
  function blocks(xml, tag) {
    var out = [], re = new RegExp("<" + tag + "(?=[\\s>/])[^>]*?(/?)>|</" + tag + ">", "g"), m, depth = 0, start = -1;
    while ((m = re.exec(xml))) {
      if (m[0].charAt(1) === "/") { depth--; if (depth === 0 && start >= 0) { out.push(xml.slice(start, re.lastIndex)); start = -1; } }
      else if (m[1] === "/") { if (depth === 0) out.push(m[0]); }
      else { if (depth === 0) start = m.index; depth++; }
    }
    return out;
  }
  function paraText(p) {
    var t = "", re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<w:cr\/>/g, m;
    while ((m = re.exec(p))) {
      if (m[1] !== undefined) t += decode(m[1]);
      else if (m[0].indexOf("tab") >= 0) t += "\t";
      else t += "\n";
    }
    if (/<w:numPr>/.test(p) && t.trim() && !/^\s*[•·\-\d]/.test(t)) t = "• " + t;
    return t;
  }
  function cellText(tc) {
    // 去掉嵌套表格，避免重复
    var inner = tc.replace(/<w:tbl>[\s\S]*<\/w:tbl>/g, "");
    return blocks(inner, "w:p").map(paraText).join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function tableRows(tbl) {
    var rows = [], prev = null;
    blocks(tbl, "w:tr").forEach(function (tr) {
      var g = 0, cells = [];
      blocks(tr, "w:tc").forEach(function (tc) {
        var pr = (tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [""])[0];
        var span = +((pr.match(/<w:gridSpan w:val="(\d+)"/) || [])[1] || 1);
        var vm = /<w:vMerge(?![^>]*w:val="restart")[^>]*\/?>/.test(pr) ? "cont" : null;
        var text = cellText(tc);
        if (vm === "cont" && prev) {
          var above = prev.find(function (c) { return c.g === g; });
          if (above) text = above.text;
        }
        cells.push({ g: g, span: span, text: text });
        g += span;
      });
      rows.push(cells); prev = cells;
    });
    return rows;
  }
  var ROLE = [
    ["week", /^(周次|周|教学周|週次|week|weeks?no\.?)$/i],
    ["date", /^(日期|时间|起止日期|授课日期|date)$/i],
    ["hours", /^(课时|学时|课时数|学时数|hours?|periods?)$/i]
  ];
  function norm(s) { return String(s || "").replace(/[\s　]+/g, ""); }
  function roleOf(label) {
    var n = norm(label);
    for (var i = 0; i < ROLE.length; i++) if (ROLE[i][1].test(n)) return ROLE[i][0];
    return null;
  }
  function isHeader(cells) {
    var t = cells.map(function (c) { return norm(c.text); });
    var hasWeek = t.some(function (x) { return roleOf(x) === "week"; });
    var hasContent = t.some(function (x) { return /内容|content|topic/i.test(x); });
    return hasWeek && hasContent;
  }
  function parsePlanXml(xml) {
    var body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [0, xml])[1];
    var tbls = blocks(body, "w:tbl");
    var outside = body;
    tbls.forEach(function (t) { outside = outside.replace(t, ""); });
    var paras = blocks(outside, "w:p").map(paraText).map(function (s) { return s.trim(); }).filter(Boolean);
    var head = paras.join("\n");
    var plan = { title: "", course: "", classes: "", teacher: "", labels: [], rows: [] };
    var m = head.match(/《([^》]+)》/); if (m) plan.course = m[1].trim();
    plan.title = (paras[0] || "").trim();
    m = head.match(/适用班级[:：]\s*([^\s]+)/); if (m) plan.classes = m[1];
    m = head.match(/任课教师[:：]\s*([^\s]+)/); if (m) plan.teacher = m[1];

    var map = null; // [{g, label, role}]
    tbls.forEach(function (tbl) {
      tableRows(tbl).forEach(function (cells) {
        if (!plan.course) {
          var ci = cells.findIndex(function (c) { return /^课程名称$/.test(norm(c.text)); });
          if (ci >= 0 && cells[ci + 1] && norm(cells[ci + 1].text) && !/^课程名称$/.test(norm(cells[ci + 1].text))) plan.course = cells[ci + 1].text.trim();
        }
        if (isHeader(cells)) {
          if (!map) {
            map = cells.filter(function (c) { return norm(c.text); }).map(function (c) { return { g: c.g, label: norm(c.text), role: roleOf(c.text) }; });
            plan.labels = map.filter(function (x) { return !x.role; }).map(function (x) { return x.label; });
          }
          return; // 重复的表头行
        }
        if (!map) return;
        if (cells.length === 1) return; // 整行合并的说明行（如考核说明）
        var r = { w: 0, d: "", h: "", f: [] };
        map.forEach(function (col) {
          var c = cells.find(function (x) { return x.g === col.g; }) || cells.find(function (x) { return x.g < col.g && x.g + x.span > col.g; });
          var v = c ? c.text : "";
          if (col.role === "week") r.w = +((norm(v).match(/\d+/) || [0])[0]);
          else if (col.role === "date") r.d = norm(v);
          else if (col.role === "hours") r.h = norm(v);
          else r.f.push(v);
        });
        if (!r.w && !r.d && !r.f.some(Boolean)) return;
        plan.rows.push(r);
      });
    });
    return plan;
  }
  function parsePlanDocx(arrayBuffer, XLSX) {
    var z = XLSX.CFB.read(new Uint8Array(arrayBuffer), { type: "array" });
    var i = z.FullPaths.findIndex(function (p) { return /word\/document\.xml$/.test(p); });
    if (i < 0) throw new Error("不是有效的 Word(.docx) 文件");
    var bytes = z.FileIndex[i].content;
    var xml = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8").decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) : Buffer.from(bytes).toString("utf8");
    return parsePlanXml(xml);
  }
  root.PlanParser = { parsePlanXml: parsePlanXml, parsePlanDocx: parsePlanDocx };
})(typeof window !== "undefined" ? window : globalThis);
