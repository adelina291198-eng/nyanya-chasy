/* Часики няни — всё хранится только в этом браузере (localStorage). */
(function () {
  "use strict";

  var KEY = "nyanya-chasy-v1";
  var DEFAULT_RATE = 400;

  // ---------- Данные ----------
  var data = load();
  var filter = { family: "all", month: "all" };
  var editingVisitId = null;
  var editingFamilyId = null;
  var editingMeetingId = null;
  var pendingMeetingId = null; // встреча, которую превращаем в визит
  var selDate = todayStr();
  var calMonth = selDate.slice(0, 7);

  function emptyData() { return { version: 1, families: [], visits: [], meetings: [] }; }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return emptyData();
      var d = JSON.parse(raw);
      if (!isValid(d)) return emptyData();
      if (!d.meetings) d.meetings = [];
      return d;
    } catch (e) { return emptyData(); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (e) { toast("Не получилось сохранить: браузер не даёт место"); return false; }
  }

  function isValid(d) {
    return d && Array.isArray(d.families) && Array.isArray(d.visits) &&
      d.families.every(function (f) { return f && typeof f.id === "string" && typeof f.name === "string" && isFinite(f.rate); }) &&
      d.visits.every(function (v) {
        return v && typeof v.id === "string" && typeof v.familyId === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(v.date) && /^\d{2}:\d{2}$/.test(v.from) && /^\d{2}:\d{2}$/.test(v.to) && isFinite(v.rate);
      }) &&
      (d.meetings == null || (Array.isArray(d.meetings) && d.meetings.every(function (m) {
        return m && typeof m.id === "string" && typeof m.familyId === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(m.date) && /^\d{2}:\d{2}$/.test(m.from) && /^\d{2}:\d{2}$/.test(m.to);
      })));
  }
  function meetingById(id) { return data.meetings.find(function (m) { return m.id === id; }); }
  function isDone(m) { return !!(m.visitId && data.visits.some(function (v) { return v.id === m.visitId; })); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function familyById(id) { return data.families.find(function (f) { return f.id === id; }); }

  // ---------- Расчёты ----------
  function minutes(t) { var p = t.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function hoursOf(from, to) {
    if (!from || !to) return 0;
    var diff = minutes(to) - minutes(from);
    if (diff <= 0) diff += 24 * 60; // визит через полночь
    return Math.round(diff / 60 * 100) / 100;
  }
  function sumOf(v) { return Math.round(hoursOf(v.from, v.to) * v.rate); }

  var fmtNum = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  function rub(n) { return fmtNum.format(Math.round(n)) + " ₽"; }
  function hrs(n) { return fmtNum.format(n) + " ч"; }

  function parseDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function monthLabel(ym) {
    var p = ym.split("-");
    var s = new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    return s.replace(" г.", "").replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function dayLabel(s) {
    var d = parseDate(s);
    var t = todayStr();
    var label = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    if (s === t) label = "Сегодня, " + label;
    return label.replace(/^./, function (c) { return c.toUpperCase(); });
  }

  // ---------- Помощники DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function option(value, text) { var o = el("option", null, text); o.value = value; return o; }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function ask(title, text, yesLabel) {
    return new Promise(function (resolve) {
      var dlg = $("dlg-confirm");
      $("confirm-title").textContent = title;
      $("confirm-text").textContent = text || "";
      $("confirm-yes").textContent = yesLabel || "Удалить";
      dlg.returnValue = "no";
      dlg.addEventListener("close", function h() {
        dlg.removeEventListener("close", h);
        resolve(dlg.returnValue === "yes");
      });
      dlg.showModal();
    });
  }

  // ---------- Экран «История» ----------
  function renderOwed() {
    var byFamily = {};
    var total = 0;
    data.visits.forEach(function (v) {
      if (v.paid) return;
      var s = sumOf(v);
      byFamily[v.familyId] = (byFamily[v.familyId] || 0) + s;
      total += s;
    });
    $("owed-sum").textContent = rub(total);
    $("owed-sum").closest(".owed").classList.toggle("is-zero", total === 0);
    var list = $("owed-list");
    list.innerHTML = "";
    data.families.forEach(function (f) {
      var li = el("li");
      li.appendChild(el("span", null, f.name));
      li.appendChild(el("b", null, rub(byFamily[f.id] || 0)));
      list.appendChild(li);
    });
  }

  function renderFilters() {
    var fs = $("f-family");
    fs.innerHTML = "";
    fs.appendChild(option("all", "Все семьи"));
    data.families.forEach(function (f) { fs.appendChild(option(f.id, f.name)); });
    if (filter.family !== "all" && !familyById(filter.family)) filter.family = "all";
    fs.value = filter.family;

    // месяцы: последние 12 + все, где есть визиты
    var months = {};
    var d = new Date();
    for (var i = 0; i < 12; i++) {
      var m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months[m.getFullYear() + "-" + pad(m.getMonth() + 1)] = true;
    }
    data.visits.forEach(function (v) { months[v.date.slice(0, 7)] = true; });
    var ms = $("f-month");
    ms.innerHTML = "";
    ms.appendChild(option("all", "Все месяцы"));
    Object.keys(months).sort().reverse().forEach(function (ym) { ms.appendChild(option(ym, monthLabel(ym))); });
    ms.value = filter.month;
  }

  function filteredVisits() {
    return data.visits.filter(function (v) {
      return (filter.family === "all" || v.familyId === filter.family) &&
        (filter.month === "all" || v.date.slice(0, 7) === filter.month);
    }).sort(function (a, b) {
      return (b.date + b.from).localeCompare(a.date + a.from);
    });
  }

  function renderVisits() {
    var list = $("visits");
    var empty = $("empty");
    list.innerHTML = "";
    var items = filteredVisits();
    var totalH = 0, totalM = 0;

    $("filters").hidden = data.visits.length === 0;

    if (data.families.length === 0) {
      showEmpty("Начните с семьи", "Добавьте семью и её ставку за час — потом сможете отмечать визиты.", "+ Семья", function () { openFamily(null); });
    } else if (data.visits.length === 0) {
      showEmpty("Визитов пока нет", "Нажмите «+ Визит», выберите семью и время — часы и сумма посчитаются сами.", "+ Визит", function () { openVisit(null); });
    } else if (items.length === 0) {
      showEmpty("За этот выбор визитов нет", "Поменяйте семью или месяц в фильтре выше.", "Показать все", function () {
        filter = { family: "all", month: "all" }; render();
      });
    } else {
      empty.hidden = true;
    }

    var lastDay = null;
    items.forEach(function (v) {
      var h = hoursOf(v.from, v.to), s = sumOf(v);
      totalH += h; totalM += s;
      if (v.date !== lastDay) {
        list.appendChild(el("li", "day", dayLabel(v.date)));
        lastDay = v.date;
      }
      var f = familyById(v.familyId);
      var li = el("li", "visit" + (v.paid ? " is-paid" : ""));
      li.dataset.id = v.id;

      var top = el("div", "visit-top");
      top.appendChild(el("span", "visit-family", f ? f.name : "Семья удалена"));
      top.appendChild(el("span", "visit-sum", rub(s)));
      li.appendChild(top);
      li.appendChild(el("p", "visit-meta", v.from + "–" + v.to + " · " + hrs(h) + " × " + rub(v.rate)));
      if (v.note) li.appendChild(el("p", "visit-note", v.note));

      var act = el("div", "visit-actions");
      var pay = el("button", "pay", v.paid ? "Оплачено ✓" : "Не оплачено");
      pay.type = "button";
      pay.setAttribute("aria-pressed", v.paid ? "true" : "false");
      pay.setAttribute("aria-label", v.paid ? "Оплачено. Нажмите, чтобы снять отметку" : "Не оплачено. Нажмите, чтобы отметить оплату");
      pay.addEventListener("click", function () { togglePaid(v.id); });
      var edit = el("button", "small-btn", "Изменить");
      edit.type = "button";
      edit.addEventListener("click", function () { openVisit(v.id); });
      var del = el("button", "small-btn danger", "Удалить");
      del.type = "button";
      del.addEventListener("click", function () { deleteVisit(v.id); });
      act.appendChild(pay); act.appendChild(edit); act.appendChild(del);
      li.appendChild(act);
      list.appendChild(li);
    });

    $("t-hours").textContent = "Итого: " + hrs(Math.round(totalH * 100) / 100);
    $("t-money").textContent = rub(totalM);
  }

  function showEmpty(title, text, btnLabel, onClick) {
    var empty = $("empty");
    empty.innerHTML = "";
    empty.appendChild(el("h2", null, title));
    empty.appendChild(el("p", null, text));
    var b = el("button", "btn btn-primary", btnLabel);
    b.type = "button";
    b.addEventListener("click", onClick);
    empty.appendChild(b);
    empty.hidden = false;
  }

  function togglePaid(id) {
    var v = data.visits.find(function (x) { return x.id === id; });
    if (!v) return;
    v.paid = !v.paid;
    save(); render();
    toast(v.paid ? "Отмечено: оплачено" : "Отметка об оплате снята");
  }

  function deleteVisit(id) {
    var v = data.visits.find(function (x) { return x.id === id; });
    if (!v) return;
    var f = familyById(v.familyId);
    ask("Точно удалить?", "Визит " + (f ? f.name : "") + ", " + dayLabel(v.date).toLowerCase() + ", " + v.from + "–" + v.to + ".")
      .then(function (yes) {
        if (!yes) return;
        data.visits = data.visits.filter(function (x) { return x.id !== id; });
        save(); render(); toast("Визит удалён");
      });
  }

  // ---------- Календарь ----------
  function plural(n, one, few, many) {
    var a = n % 10, b = n % 100;
    return n + " " + (a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many);
  }
  function dateStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function meetingsOn(date) {
    return data.meetings.filter(function (m) { return m.date === date; })
      .sort(function (a, b) { return a.from.localeCompare(b.from); });
  }
  // визиты, внесённые сразу в историю (не из встречи) — их тоже видно в календаре
  function visitsOnlyOn(date) {
    return data.visits.filter(function (v) {
      return v.date === date && !data.meetings.some(function (m) { return m.visitId === v.id; });
    });
  }
  // всё за день: встречи и такие визиты, по времени
  function dayItems(date) {
    var items = meetingsOn(date).map(function (m) { return { kind: "m", x: m }; })
      .concat(visitsOnlyOn(date).map(function (v) { return { kind: "v", x: v }; }));
    return items.sort(function (a, b) { return a.x.from.localeCompare(b.x.from); });
  }
  function meetingSum(m) {
    var f = familyById(m.familyId);
    return f ? Math.round(hoursOf(m.from, m.to) * f.rate) : 0;
  }

  function renderCalendar() {
    var p = calMonth.split("-");
    var first = new Date(+p[0], +p[1] - 1, 1);
    $("cal-title").textContent = monthLabel(calMonth);
    var grid = $("cal-grid");
    grid.innerHTML = "";
    var shift = (first.getDay() + 6) % 7; // понедельник — первый
    var start = new Date(first.getFullYear(), first.getMonth(), 1 - shift);
    var today = todayStr();
    var weeks = Math.ceil((shift + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    for (var i = 0; i < weeks * 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var ds = dateStr(d);
      var b = el("button", "cal-day");
      b.type = "button";
      b.dataset.date = ds;
      if (ds.slice(0, 7) !== calMonth) b.classList.add("is-out");
      if (ds === today) b.classList.add("is-today");
      if (ds === selDate) { b.classList.add("is-selected"); b.setAttribute("aria-current", "date"); }
      b.appendChild(el("span", null, String(d.getDate())));
      var ms = dayItems(ds);
      var dots = el("span", "dots");
      ms.slice(0, 3).forEach(function (it) { dots.appendChild(el("span", "dot" + (it.kind === "v" || isDone(it.x) ? " done" : ""))); });
      b.appendChild(dots);
      b.setAttribute("aria-label", dayLabel(ds) + (ms.length ? ", " + plural(ms.length, "запись", "записи", "записей") : ""));
      b.addEventListener("click", (function (date) {
        return function () { selDate = date; calMonth = date.slice(0, 7); renderCalendar(); };
      })(ds));
      grid.appendChild(b);
    }
    renderDay();
  }

  function renderDay() {
    var list = $("meetings");
    var all = dayItems(selDate);
    var ms = all.filter(function (it) { return it.kind === "m"; }).map(function (it) { return it.x; });
    list.innerHTML = "";
    $("day-title").textContent = dayLabel(selDate);
    var short = parseDate(selDate).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
    $("cal-day-short").textContent = short.replace(/^./, function (c) { return c.toUpperCase(); });
    var total = all.reduce(function (s, it) { return s + (it.kind === "v" ? sumOf(it.x) : meetingSum(it.x)); }, 0);
    $("cal-day-short").textContent += all.length ? " · " + plural(all.length, "запись", "записи", "записей") : "";
    $("cal-day-sum").textContent = all.length ? rub(total) : "Нет встреч";

    if (data.families.length === 0) {
      showEmptyIn("day-empty", "Начните с семьи", "Добавьте семью и её ставку — потом сможете планировать встречи.", "+ Семья", function () { openFamily(null); });
    } else if (all.length === 0) {
      showEmptyIn("day-empty", "На этот день встреч нет", "Нажмите «+ Встреча» — дата подставится сама.", "+ Встреча", function () { openMeeting(null); });
    } else {
      $("day-empty").hidden = true;
    }

    all.forEach(function (it) {
      if (it.kind === "v") { list.appendChild(visitCard(it.x)); return; }
      var m = it.x;
      var f = familyById(m.familyId);
      var done = isDone(m);
      var li = el("li", "meeting" + (done ? " is-done" : ""));
      li.dataset.id = m.id;
      var t = el("div", "meeting-time", m.from);
      t.appendChild(el("small", null, "до " + m.to));
      li.appendChild(t);
      li.appendChild(el("div", "meeting-family", f ? f.name : "Семья удалена"));
      var info = hrs(hoursOf(m.from, m.to)) + " · " + rub(meetingSum(m)) + (m.note ? " · " + m.note : "");
      li.appendChild(el("div", "meeting-info", info));

      var act = el("div", "visit-actions");
      var doneBtn = el("button", "done-btn", done ? "Была ✓" : "Состоялась");
      doneBtn.type = "button";
      doneBtn.setAttribute("aria-label", done ? "Встреча уже в истории визитов" : "Встреча состоялась — перенести в историю");
      doneBtn.addEventListener("click", function () {
        if (isDone(m)) { toast("Эта встреча уже в истории"); return; }
        openVisit(null, m);
      });
      var edit = el("button", "small-btn", "Изменить");
      edit.type = "button";
      edit.addEventListener("click", function () { openMeeting(m.id); });
      var del = el("button", "small-btn danger", "Удалить");
      del.type = "button";
      del.addEventListener("click", function () { deleteMeeting(m.id); });
      act.appendChild(doneBtn); act.appendChild(edit); act.appendChild(del);
      li.appendChild(act);
      list.appendChild(li);
    });
  }

  // карточка визита в календаре (зелёная — визит уже был)
  function visitCard(v) {
    var f = familyById(v.familyId);
    var li = el("li", "meeting is-done");
    li.dataset.id = v.id;
    var t = el("div", "meeting-time", v.from);
    t.appendChild(el("small", null, "до " + v.to));
    li.appendChild(t);
    li.appendChild(el("div", "meeting-family", f ? f.name : "Семья удалена"));
    var info = hrs(hoursOf(v.from, v.to)) + " · " + rub(sumOf(v)) + " · " + (v.paid ? "оплачено ✓" : "не оплачено") + (v.note ? " · " + v.note : "");
    li.appendChild(el("div", "meeting-info", info));
    var act = el("div", "visit-actions");
    var tag = el("button", "done-btn", "Визит ✓");
    tag.type = "button";
    tag.addEventListener("click", function () { toast("Этот визит уже в истории"); });
    var edit = el("button", "small-btn", "Изменить");
    edit.type = "button";
    edit.addEventListener("click", function () { openVisit(v.id); });
    var del = el("button", "small-btn danger", "Удалить");
    del.type = "button";
    del.addEventListener("click", function () { deleteVisit(v.id); });
    act.appendChild(tag); act.appendChild(edit); act.appendChild(del);
    li.appendChild(act);
    return li;
  }

  function showEmptyIn(id, title, text, btnLabel, onClick) {
    var box = $(id);
    box.innerHTML = "";
    box.appendChild(el("h2", null, title));
    box.appendChild(el("p", null, text));
    var b = el("button", "btn btn-primary", btnLabel);
    b.type = "button";
    b.addEventListener("click", onClick);
    box.appendChild(b);
    box.hidden = false;
  }

  function moveMonth(step) {
    var p = calMonth.split("-");
    var d = new Date(+p[0], +p[1] - 1 + step, 1);
    calMonth = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    renderCalendar();
  }

  // ---------- Окно «Встреча» ----------
  function openMeeting(id) {
    if (data.families.length === 0) { toast("Сначала добавьте семью"); openFamily(null); return; }
    editingMeetingId = id;
    var m = id ? meetingById(id) : null;
    $("meeting-title").textContent = m ? "Изменить встречу" : "Новая встреча";
    var sel = $("m-family");
    sel.innerHTML = "";
    data.families.forEach(function (f) { sel.appendChild(option(f.id, f.name)); });
    sel.value = m ? m.familyId : data.families[0].id;
    $("m-date").value = m ? m.date : selDate;
    $("m-from").value = m ? m.from : "";
    $("m-to").value = m ? m.to : "";
    $("m-note").value = m ? (m.note || "") : "";
    $("m-error").textContent = "";
    updateMeetingCalc();
    $("dlg-meeting").showModal();
  }

  function updateMeetingCalc() {
    var from = $("m-from").value, to = $("m-to").value, f = familyById($("m-family").value);
    if (!from || !to || !f) { $("m-calc").textContent = "Укажите время «с» и «до»"; return; }
    var h = hoursOf(from, to);
    var txt = hrs(h) + " × " + rub(f.rate) + " = " + rub(h * f.rate);
    if (minutes(to) <= minutes(from)) txt += " (через полночь)";
    $("m-calc").textContent = txt;
  }

  function saveMeeting(e) {
    e.preventDefault();
    var familyId = $("m-family").value, date = $("m-date").value,
      from = $("m-from").value, to = $("m-to").value, note = $("m-note").value.trim();
    var err = !familyId ? "Выберите семью" : !date ? "Укажите дату" : !from || !to ? "Укажите время «с» и «до»" :
      from === to ? "Время «с» и «до» совпадает" : "";
    if (err) { $("m-error").textContent = err; return; }
    var isNew = !editingMeetingId;
    if (isNew) data.meetings.push({ id: uid(), familyId: familyId, date: date, from: from, to: to, note: note });
    else Object.assign(meetingById(editingMeetingId), { familyId: familyId, date: date, from: from, to: to, note: note });
    if (save()) {
      $("dlg-meeting").close();
      selDate = date; calMonth = date.slice(0, 7);
      render();
      toast(isNew ? "Встреча запланирована" : "Встреча изменена");
    }
  }

  function deleteMeeting(id) {
    var m = meetingById(id);
    if (!m) return;
    var f = familyById(m.familyId);
    var extra = isDone(m) ? " Визит в истории останется." : "";
    ask("Точно удалить?", "Встреча " + (f ? f.name : "") + ", " + dayLabel(m.date).toLowerCase() + ", " + m.from + "–" + m.to + "." + extra)
      .then(function (yes) {
        if (!yes) return;
        data.meetings = data.meetings.filter(function (x) { return x.id !== id; });
        save(); render(); toast("Встреча удалена");
      });
  }

  // ---------- Окно «Визит» ----------
  function openVisit(id, fromMeeting) {
    if (data.families.length === 0) { toast("Сначала добавьте семью"); openFamily(null); return; }
    editingVisitId = id;
    pendingMeetingId = fromMeeting ? fromMeeting.id : null;
    var v = id ? data.visits.find(function (x) { return x.id === id; }) : null;
    $("visit-title").textContent = v ? "Изменить визит" : fromMeeting ? "Встреча состоялась" : "Новый визит";
    var sel = $("v-family");
    sel.innerHTML = "";
    data.families.forEach(function (f) { sel.appendChild(option(f.id, f.name)); });
    if (v) {
      sel.value = v.familyId;
      $("v-date").value = v.date; $("v-from").value = v.from; $("v-to").value = v.to;
      $("v-rate").value = v.rate; $("v-note").value = v.note || "";
    } else if (fromMeeting) {
      var mf = familyById(fromMeeting.familyId);
      sel.value = mf ? mf.id : data.families[0].id;
      $("v-date").value = fromMeeting.date; $("v-from").value = fromMeeting.from; $("v-to").value = fromMeeting.to;
      $("v-rate").value = familyById(sel.value).rate; $("v-note").value = fromMeeting.note || "";
    } else {
      sel.value = filter.family !== "all" ? filter.family : data.families[0].id;
      $("v-date").value = todayStr(); $("v-from").value = ""; $("v-to").value = "";
      $("v-rate").value = familyById(sel.value).rate; $("v-note").value = "";
    }
    $("v-error").textContent = "";
    updateCalc();
    $("dlg-visit").showModal();
  }

  function updateCalc() {
    var from = $("v-from").value, to = $("v-to").value, rate = parseFloat($("v-rate").value);
    if (!from || !to || !isFinite(rate)) { $("v-calc").textContent = "Укажите время «с» и «до»"; return; }
    var h = hoursOf(from, to);
    var txt = hrs(h) + " × " + rub(rate) + " = " + rub(h * rate);
    if (minutes(to) <= minutes(from)) txt += " (через полночь)";
    $("v-calc").textContent = txt;
  }

  function saveVisit(e) {
    e.preventDefault();
    var familyId = $("v-family").value, date = $("v-date").value,
      from = $("v-from").value, to = $("v-to").value,
      rate = parseFloat($("v-rate").value), note = $("v-note").value.trim();
    var err = !familyId ? "Выберите семью" : !date ? "Укажите дату" : !from || !to ? "Укажите время «с» и «до»" :
      from === to ? "Время «с» и «до» совпадает" : !isFinite(rate) || rate < 0 ? "Укажите ставку числом" : "";
    if (err) { $("v-error").textContent = err; return; }

    if (editingVisitId) {
      var v = data.visits.find(function (x) { return x.id === editingVisitId; });
      Object.assign(v, { familyId: familyId, date: date, from: from, to: to, rate: rate, note: note });
    } else {
      var newId = uid();
      data.visits.push({ id: newId, familyId: familyId, date: date, from: from, to: to, rate: rate, note: note, paid: false });
      var pm = pendingMeetingId && meetingById(pendingMeetingId);
      if (pm) pm.visitId = newId;
    }
    if (save()) {
      $("dlg-visit").close();
      render();
      toast(editingVisitId ? "Визит изменён" : pendingMeetingId ? "Встреча перенесена в историю" : "Визит сохранён");
      pendingMeetingId = null;
    }
  }

  // ---------- Настройки: семьи ----------
  function renderFamilies() {
    var list = $("families");
    list.innerHTML = "";
    if (data.families.length === 0) {
      var li = el("li", "empty");
      li.appendChild(el("h2", null, "Семей пока нет"));
      li.appendChild(el("p", null, "Нажмите «+ Семья». Назовите её как удобно, например «Семья А», — без настоящих имён и адресов."));
      list.appendChild(li);
      return;
    }
    data.families.forEach(function (f) {
      var li = el("li", "family");
      var info = el("div", "family-info");
      info.appendChild(el("div", "family-name", f.name));
      var count = data.visits.filter(function (v) { return v.familyId === f.id; }).length;
      info.appendChild(el("div", "family-rate", rub(f.rate) + " в час · визитов: " + count));
      li.appendChild(info);
      var edit = el("button", "small-btn", "Изменить");
      edit.type = "button";
      edit.addEventListener("click", function () { openFamily(f.id); });
      var del = el("button", "small-btn danger", "Удалить");
      del.type = "button";
      del.addEventListener("click", function () { deleteFamily(f.id); });
      li.appendChild(edit); li.appendChild(del);
      list.appendChild(li);
    });
  }

  function openFamily(id) {
    editingFamilyId = id;
    var f = id ? familyById(id) : null;
    $("family-title").textContent = f ? "Изменить семью" : "Новая семья";
    $("fm-name").value = f ? f.name : "";
    $("fm-rate").value = f ? f.rate : DEFAULT_RATE;
    $("fm-error").textContent = "";
    $("dlg-family").showModal();
  }

  function saveFamily(e) {
    e.preventDefault();
    var name = $("fm-name").value.trim(), rate = parseFloat($("fm-rate").value);
    var dup = data.families.some(function (f) { return f.id !== editingFamilyId && f.name.toLowerCase() === name.toLowerCase(); });
    var err = !name ? "Напишите название" : dup ? "Такая семья уже есть" : !isFinite(rate) || rate < 0 ? "Укажите ставку числом" : "";
    if (err) { $("fm-error").textContent = err; return; }
    var isNew = !editingFamilyId;
    if (isNew) data.families.push({ id: uid(), name: name, rate: rate });
    else Object.assign(familyById(editingFamilyId), { name: name, rate: rate });
    if (save()) {
      $("dlg-family").close();
      render();
      toast(isNew ? "Семья добавлена" : "Семья изменена" + (isNew ? "" : ". Старые визиты — по прежней ставке"));
    }
  }

  function deleteFamily(id) {
    var f = familyById(id);
    var count = data.visits.filter(function (v) { return v.familyId === id; }).length;
    var mcount = data.meetings.filter(function (m) { return m.familyId === id; }).length;
    var p = count || mcount
      ? ask("У семьи есть записи", "У «" + f.name + "» визитов: " + count + ", встреч: " + mcount + ". Удалить семью вместе с ними? Вернуть будет нельзя.", "Удалить всё")
      : ask("Точно удалить?", "Семья «" + f.name + "».");
    p.then(function (yes) {
      if (!yes) return;
      data.families = data.families.filter(function (x) { return x.id !== id; });
      data.visits = data.visits.filter(function (v) { return v.familyId !== id; });
      data.meetings = data.meetings.filter(function (m) { return m.familyId !== id; });
      save(); render(); toast("Семья удалена");
    });
  }

  // ---------- Копия данных ----------
  function exportData() {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chasiki-kopiya-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Копия скачана");
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var d;
      try { d = JSON.parse(reader.result); } catch (e) { d = null; }
      if (!isValid(d)) { toast("Это не файл копии «Часиков»"); return; }
      var dm = d.meetings || [];
      ask("Загрузить копию?", "В копии семей: " + d.families.length + ", визитов: " + d.visits.length +
        ", встреч: " + dm.length + ". Данные, которые сейчас в приложении, заменятся.", "Загрузить")
        .then(function (yes) {
          if (!yes) return;
          data = { version: 1, families: d.families, visits: d.visits, meetings: dm };
          filter = { family: "all", month: "all" };
          save(); render(); toast("Копия загружена");
        });
    };
    reader.readAsText(file);
  }

  // ---------- Экраны ----------
  function showView() {
    var view = location.hash === "#settings" ? "settings" : location.hash === "#calendar" ? "calendar" : "history";
    var settings = view === "settings";
    $("view-history").hidden = view !== "history";
    $("view-calendar").hidden = view !== "calendar";
    $("view-settings").hidden = !settings;
    $("bottombar").hidden = view !== "history";
    $("calbar").hidden = view !== "calendar";
    $("tabbar").hidden = settings;
    $("tab-history").classList.toggle("is-active", view === "history");
    $("tab-calendar").classList.toggle("is-active", view === "calendar");
    $("tab-history").setAttribute("aria-current", view === "history" ? "page" : "false");
    $("tab-calendar").setAttribute("aria-current", view === "calendar" ? "page" : "false");
    $("btn-settings").hidden = settings;
    $("btn-back").hidden = !settings;
    $("page-title").textContent = settings ? "Семьи и ставки" : view === "calendar" ? "Календарь" : "Часики няни ✨";
    document.body.classList.toggle("no-bars", settings);
    window.scrollTo(0, 0);
  }

  function render() {
    renderOwed(); renderFilters(); renderVisits(); renderFamilies(); renderCalendar();
  }

  // ---------- События ----------
  $("btn-settings").addEventListener("click", function () { location.hash = "settings"; });
  var lastMain = "";
  $("btn-back").addEventListener("click", function () { location.hash = lastMain; });
  window.addEventListener("hashchange", function () {
    if (location.hash !== "#settings") lastMain = location.hash === "#calendar" ? "calendar" : "";
  });
  $("tab-history").addEventListener("click", function (e) { e.preventDefault(); location.hash = ""; });
  $("btn-add-meeting").addEventListener("click", function () { openMeeting(null); });
  $("form-meeting").addEventListener("submit", saveMeeting);
  ["m-from", "m-to", "m-family"].forEach(function (id) { $(id).addEventListener("input", updateMeetingCalc); });
  document.querySelectorAll("dialog form").forEach(function (f) {
    f.addEventListener("input", function () { // ошибка пропадает, как только начали исправлять
      var er = f.querySelector(".form-error"); if (er) er.textContent = "";
    });
  });
  $("m-family").addEventListener("change", updateMeetingCalc);
  $("cal-prev").addEventListener("click", function () { moveMonth(-1); });
  $("cal-next").addEventListener("click", function () { moveMonth(1); });
  $("cal-today").addEventListener("click", function () {
    selDate = todayStr(); calMonth = selDate.slice(0, 7); renderCalendar();
  });
  window.addEventListener("hashchange", showView);

  $("btn-add").addEventListener("click", function () { openVisit(null); });
  $("btn-add-family").addEventListener("click", function () { openFamily(null); });
  $("f-family").addEventListener("change", function (e) { filter.family = e.target.value; renderVisits(); });
  $("f-month").addEventListener("change", function (e) { filter.month = e.target.value; renderVisits(); });

  $("form-visit").addEventListener("submit", saveVisit);
  $("form-family").addEventListener("submit", saveFamily);
  ["v-from", "v-to", "v-rate"].forEach(function (id) { $(id).addEventListener("input", updateCalc); });
  $("v-family").addEventListener("change", function (e) {
    var f = familyById(e.target.value);
    if (f) { $("v-rate").value = f.rate; updateCalc(); }
  });
  document.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", function () { b.closest("dialog").close(); });
  });
  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); }); // нажатие мимо окна
  });

  $("btn-export").addEventListener("click", exportData);
  $("btn-import").addEventListener("click", function () { $("file-import").click(); });
  $("file-import").addEventListener("change", function (e) {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });

  // iPhone: клавиатура закрывает низ экрана. Считаем её высоту и поднимаем окно над ней.
  function fitKeyboard() {
    var vv = window.visualViewport; if (!vv) return;
    var kb = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    document.documentElement.style.setProperty("--kb", kb + "px");
    document.documentElement.style.setProperty("--vvh", vv.height + "px");
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", fitKeyboard);
    window.visualViewport.addEventListener("scroll", fitKeyboard);
    fitKeyboard();
  }
  // поле, в котором печатаем, всегда видно внутри окна
  document.querySelectorAll("dialog form").forEach(function (f) {
    f.addEventListener("focusin", function (e) {
      var t = e.target;
      if (!/INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      setTimeout(function () { fitKeyboard(); t.scrollIntoView({ block: "center" }); }, 300);
    });
  });

  // ---------- Карточка «Прогулка»: погода из data.json (обновляется сама 3 раза в день) ----------
  var WALK_DAYS = ["Сегодня", "Завтра", "Послезавтра"];
  function renderWalk(w) {
    var box = $("walk");
    box.textContent = "";
    var today = todayStr();
    var days = (w.days || []).filter(function (d) { return d.date >= today; });
    if (!days.length) {
      box.appendChild(el("p", "walk-msg", "Прогноз устарел — ждём свежий. Обновлено: " + (w.updated_text || "?")));
      return;
    }
    var d = days[0];
    box.className = "walk walk-" + d.walk;
    var head = el("div", "walk-head");
    head.appendChild(el("span", "walk-ico", d.icon));
    var main = el("div", "walk-main");
    main.appendChild(el("p", "walk-title", (d.date === today ? "" : dayLabel(d.date) + ": ") + d.walk_title));
    main.appendChild(el("p", "walk-why", d.walk_why));
    head.appendChild(main);
    head.appendChild(el("span", "walk-temp", (d.t_max > 0 ? "+" : "") + d.t_max + "°"));
    box.appendChild(head);

    var facts = el("ul", "walk-facts");
    [
      d.text + ", от " + d.t_min + "° до " + d.t_max + "° (ощущается " + d.feels_min + "°…" + d.feels_max + "°)",
      "👕 " + d.clothes,
      "🌅 светло с " + d.sunrise + " до " + d.sunset,
      "💨 ветер до " + d.wind + " м/с" + (d.rain_chance ? " · осадки " + d.rain_chance + "%" : ""),
      d.air_text ? "🍃 воздух: " + d.air_text : null
    ].forEach(function (t) { if (t) facts.appendChild(el("li", null, t)); });
    box.appendChild(facts);

    if (days.length > 1) {
      var next = el("div", "walk-next");
      days.slice(1, 3).forEach(function (n) {
        var i = Math.round((parseDate(n.date) - parseDate(today)) / 864e5);
        var c = el("div", "walk-day walk-" + n.walk);
        c.appendChild(el("b", null, (WALK_DAYS[i] || dayLabel(n.date)) + " " + n.icon));
        c.appendChild(el("span", null, n.t_min + "°…" + n.t_max + "° · " + n.walk_title));
        next.appendChild(c);
      });
      box.appendChild(next);
    }
    box.appendChild(el("p", "walk-upd", "Обновлено " + w.updated_text + " · " + w.city + " · " + w.source));
  }
  function loadWalk() {
    fetch("data.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(renderWalk)
      .catch(function () {
        var box = $("walk");
        box.className = "walk";
        box.textContent = "";
        box.appendChild(el("p", "walk-msg", "🌤️ Погоду сейчас загрузить не получилось. Проверьте интернет — остальное приложение работает как обычно."));
      });
  }

  lastMain = location.hash === "#calendar" ? "calendar" : "";
  showView();
  render();
  loadWalk();
})();
