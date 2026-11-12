/* 导出 Excel：考勤（按学校成绩册格式，每个班一张表）+ 课堂记事 + 学生统计 + 考勤日期对照。
   自带一个小的 xlsx 生成器，带边框、宋体、合并单元格，打印出来和学校模板一致。 */
(function (root) {
  "use strict";
  function colName(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xesc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
  // 样式表：0 默认 / 1 标题 / 2 信息行(左) / 3 表头(框+居中+换行) / 4 正文左(框) / 5 正文中(框) / 6 记事表头(粗+底色+框) / 7 记事正文(框+换行+顶对齐) / 8 信息行居中靠上
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="@"/></numFmts>' +
    '<fonts count="3"><font><sz val="10.5"/><name val="宋体"/><charset val="134"/></font><font><sz val="16"/><name val="宋体"/><charset val="134"/></font><font><b/><sz val="10.5"/><name val="宋体"/><charset val="134"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /* sheet: {name, cells: {"r,c": {v, s}}, merges: ["A1:X1"], cols: [w...], heights: {row: h}, landscape, freeze: "A2"} 行列都从 0 开始 */
  function sheetXml(sh) {
    var maxR = 0, maxC = 0, byRow = {};
    Object.keys(sh.cells).forEach(function (k) {
      var p = k.split(","), r = +p[0], c = +p[1];
      (byRow[r] = byRow[r] || []).push(c); if (r > maxR) maxR = r; if (c > maxC) maxC = c;
    });
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    x += '<dimension ref="A1:' + colName(maxC) + (maxR + 1) + '"/>';
    x += '<sheetViews><sheetView workbookViewId="0"' + (sh.tabSelected ? ' tabSelected="1"' : "") + '>' +
      (sh.freeze ? '<pane ySplit="' + sh.freeze + '" topLeftCell="A' + (sh.freeze + 1) + '" activePane="bottomLeft" state="frozen"/>' : "") + '</sheetView></sheetViews>';
    x += '<sheetFormatPr defaultRowHeight="13.5"/>';
    if (sh.cols && sh.cols.length) x += '<cols>' + sh.cols.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("") + '</cols>';
    x += '<sheetData>';
    Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
      var ht = sh.heights && sh.heights[r];
      x += '<row r="' + (r + 1) + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : "") + '>';
      byRow[r].sort(function (a, b) { return a - b; }).forEach(function (c) {
        var cell = sh.cells[r + "," + c], ref = colName(c) + (r + 1), s = cell.s ? ' s="' + cell.s + '"' : "";
        if (cell.v === undefined || cell.v === null || cell.v === "") x += '<c r="' + ref + '"' + s + '/>';
        else if (typeof cell.v === "number") x += '<c r="' + ref + '"' + s + '><v>' + cell.v + '</v></c>';
        else x += '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(cell.v) + '</t></is></c>';
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (sh.merges && sh.merges.length) x += '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join("") + '</mergeCells>';
    x += '<pageMargins left="' + (sh.margins ? sh.margins[0] : 0.157) + '" right="' + (sh.margins ? sh.margins[1] : 0.197) + '" top="0.354" bottom="0.787" header="0.3" footer="0.3"/>';
    x += '<pageSetup paperSize="9" orientation="' + (sh.landscape ? "landscape" : "portrait") + '"' + (sh.fitWidth ? ' fitToWidth="1" fitToHeight="0"' : "") + '/>';
    x += '</worksheet>';
    if (sh.fitWidth) x = x.replace("<dimension", '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
    return x;
  }
  function safeSheetName(n, used) {
    var s = String(n).replace(/[\[\]:*?\/\\]/g, "").slice(0, 31) || "Sheet", base = s, i = 2;
    while (used[s]) { s = base.slice(0, 28) + "(" + i++ + ")"; }
    used[s] = 1; return s;
  }
  function buildXlsx(sheets, XLSX) {
    var used = {}; sheets.forEach(function (s) { s.name = safeSheetName(s.name, used); });
    var enc = new TextEncoder(), cfb = XLSX.CFB.utils.cfb_new();
    function add(p, str) { XLSX.CFB.utils.cfb_add(cfb, p, enc.encode(str)); }
    add("/[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + '</Types>');
    add("/_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    add("/xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      sheets.map(function (s, i) { return '<sheet name="' + xesc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + '</sheets></workbook>');
    add("/xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    add("/xl/styles.xml", STYLES);
    sheets.forEach(function (s, i) { if (i === 0) s.tabSelected = true; add("/xl/worksheets/sheet" + (i + 1) + ".xml", sheetXml(s)); });
    var out = XLSX.CFB.write(cfb, { type: "array", fileType: "zip" });
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  }

  /* 一张学校格式的考勤表。info: {term, teacher, cls, course, students:[{id,name,marks:[...]}], n} */
  function attendanceSheet(name, info) {
    var N = Math.max(18, info.n), F = 5, X = F + N; // F 列开始的到课情况；X 为最后一列（与模板一致多一列）
    var cells = {}, merges = [], heights = {};
    function put(r, c, v, s) { cells[r + "," + c] = { v: v, s: s }; }
    function box(r1, c1, r2, c2, s) { for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) if (!cells[r + "," + c]) put(r, c, "", s); }
    function merge(r1, c1, r2, c2) { merges.push(colName(c1) + (r1 + 1) + ":" + colName(c2) + (r2 + 1)); }
    put(0, 0, "河南经贸职业学院班级学生成绩册", 1); merge(0, 0, 0, X); heights[0] = 20.25;
    put(1, 0, info.term, 8); merge(1, 0, 1, X); heights[1] = 13.15;
    put(2, 0, "任课老师：", 2); put(2, 1, info.teacher || "", 2);
    put(2, 2, "班级：", 2); put(2, 3, info.cls, 2); merge(2, 3, 2, 8);
    put(2, 9, "课程：", 2); put(2, 11, info.course, 2); merge(2, 11, 2, X - 4);
    put(2, X - 3, "人数：", 2); merge(2, X - 3, 2, X - 1); put(2, X, info.students.length, 2);
    heights[2] = 13.15;
    var hdr = ["学号", "姓名", "学期\n总评", "期末\n考核\n（  %）", "日常考核\n（ %）"];
    hdr.forEach(function (t, c) { put(3, c, t, 3); merge(3, c, 5, c); });
    put(3, F, "到课情况统计", 3); merge(3, F, 3, X);
    for (var i = 0; i < N; i++) { put(4, F + i, i + 1, 3); merge(4, F + i, 5, F + i); }
    box(3, 0, 5, X, 3);
    heights[3] = 20; heights[4] = heights[5] = 24; // 表头留够高度，“期末考核（%）”等四行字不被压扁
    info.students.forEach(function (st, k) {
      var r = 6 + k;
      put(r, 0, String(st.id), 4); put(r, 1, st.name, 4);
      for (var c = 2; c < F; c++) put(r, c, "", 5);
      for (i = 0; i < N; i++) put(r, F + i, st.marks[i] || "", 5);
      put(r, X, "", 5);
      heights[r] = 22.05;
    });
    var lr = 6 + info.students.length;
    [["出勤：", "√"], ["请假：", "△"], ["出勤：", "○"], ["缺勤：", "×"]].forEach(function (x, j) { put(lr + j, 0, x[0], 2); put(lr + j, 1, x[1], 2); heights[lr + j] = 21.95; });
    var cols = [13.1, 7.7, 5.9, 6.4, 5.1]; for (i = 0; i < N; i++) cols.push(3.4); cols.push(9);
    return { name: name, cells: cells, merges: merges, cols: cols, heights: heights, margins: [0.157, 0.197], fitWidth: true };
  }
  /* 普通表格：第一行表头 */
  function tableSheet(name, header, rows, widths, opt) {
    var cells = {}, heights = {};
    header.forEach(function (h, c) { cells["0," + c] = { v: h, s: 6 }; });
    heights[0] = 24;
    rows.forEach(function (row, r) { row.forEach(function (v, c) { cells[(r + 1) + "," + c] = { v: v, s: typeof v === "number" ? 5 : ((opt && opt.center && opt.center.indexOf(c) >= 0) ? 5 : 7) }; }); });
    return { name: name, cells: cells, merges: [], cols: widths, heights: heights, landscape: true, fitWidth: true, freeze: 1 };
  }
  root.XlsxExport = { buildXlsx: buildXlsx, attendanceSheet: attendanceSheet, tableSheet: tableSheet };
})(typeof window !== "undefined" ? window : globalThis);
