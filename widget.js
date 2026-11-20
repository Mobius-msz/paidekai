/* 排得开 · 桌面挂件
   与主站同源，直接读 localStorage；只读展示，改动仍在主站里做。*/
(function () {
  'use strict';

  var KEY = 'paidekai.v1';
  var THEME_KEY = 'paidekai.theme';

  function readStore() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function toMin(hhmm) {
    var p = String(hhmm || '0:0').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 「今天」/「明天」/「周三」
  function dayLabel(dateStr) {
    if (!dateStr) return '';
    var today = ymd(new Date());
    if (dateStr === today) return '今天';
    var t = new Date(dateStr + 'T00:00:00');
    if (isNaN(t.getTime())) return '';
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var diff = Math.round((t - d0) / 86400000);
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    return '周' + '日一二三四五六'.charAt(t.getDay());
  }

  function dueInfo(t) {
    if (!t.due) return { kind: 'none', label: '没写截止' };
    var ms = t.due - Date.now();
    var h = ms / 3600000;
    if (ms < 0) {
      var od = Math.abs(h);
      return { kind: 'overdue', label: od < 24 ? '晚了 ' + Math.max(1, Math.round(od)) + ' 小时'
                                              : '晚了 ' + Math.round(od / 24) + ' 天' };
    }
    if (h < 24) return { kind: 'urgent', label: Math.max(1, Math.round(h)) + ' 小时后' };
    if (h < 72) return { kind: 'soon', label: Math.ceil(h / 24) + ' 天后' };
    var d = new Date(t.due);
    return { kind: 'normal', label: (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) };
  }

  function weekOf(startIso) {
    if (!startIso) return 0;
    var start = new Date(startIso + 'T00:00:00');
    if (isNaN(start.getTime())) return 0;
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var diff = Math.floor((now - start) / 86400000);
    return diff < 0 ? 0 : Math.floor(diff / 7) + 1;
  }

  function render() {
    var app = document.getElementById('app');
    if (!app) return;

    var store = readStore();
    if (!store || !store.users || !store.users.length) {
      app.innerHTML =
        '<div class="wg-empty">还没有档案。<br>先去主站建一个，这里就有东西了。<br><br>' +
        '<a href="index.html" target="_blank">打开排得开 →</a></div>';
      return;
    }

    var uid = store.current || store.users[0].id;
    var user = null;
    store.users.forEach(function (u) { if (u.id === uid) user = u; });
    var d = (store.data || {})[uid] || {};

    var term = d.term && d.term.start;
    var week = weekOf(term);

    // 今天的日程
    var today = ymd(new Date());
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    var todays = (d.events || []).filter(function (e) { return e.date === today; })
      .sort(function (a, b) { return toMin(a.start) - toMin(b.start); });

    var next = null;
    for (var i = 0; i < todays.length; i++) {
      if (toMin(todays[i].end) >= nowMin) { next = todays[i]; break; }
    }
    var live = next && toMin(next.start) <= nowMin;

    // 待办：收藏优先，其次按截止
    var tasks = (d.tasks || []).filter(function (t) { return !t.done; });
    tasks.forEach(function (t) { t._due = t.due ? new Date(t.due) : null; });
    tasks.sort(function (p, q) {
      if (!!q.fav !== !!p.fav) return q.fav ? 1 : -1;
      if (!p._due) return 1;
      if (!q._due) return -1;
      return p._due - q._due;
    });
    var top = tasks.slice(0, 4);

    var pend = (d.records || []).filter(function (r) { return r.status === 'pending'; }).length;

    var html = '';

    // 头部
    html += '<div class="wg-head">' +
              '<span class="wg-mark"></span>' +
              '<span class="wg-name">' + esc(user ? user.name : '排得开') + '</span>' +
              (week ? '<span class="wg-week">第 ' + week + ' 周</span>' : '') +
            '</div>';

    // 下一件
    html += '<div class="wg-next">';
    if (next) {
      html += '<div class="wg-next-lab">' + (live ? '正在进行' : '接下来') + '</div>' +
              '<div class="wg-next-time"><b>' + esc(next.start) + '</b> – ' + esc(next.end) + '</div>' +
              '<div class="wg-next-title">' + esc(next.title) + '</div>' +
              (next.place && !next.runKm ? '<div class="wg-next-meta">' + esc(next.place) + '</div>' : '');
    } else if (todays.length) {
      html += '<div class="wg-next-lab">今天</div>' +
              '<div class="wg-next-empty">今天的安排都结束了</div>';
    } else {
      html += '<div class="wg-next-lab">今天</div>' +
              '<div class="wg-next-empty">今天没有安排</div>';
    }
    html += '</div>';

    // 待办
    html += '<div class="wg-todo-head"><span>待办 ' + tasks.length + '</span>' +
            '<a href="index.html" target="_blank">全部 →</a></div>';
    if (top.length) {
      html += '<div class="wg-todo">' + top.map(function (t) {
        var info = dueInfo(t);
        return '<div class="wg-item' + (t.fav ? ' is-fav' : '') + '">' +
                 '<span class="wg-star' + (t.fav ? ' on' : '') + '">' + (t.fav ? '★' : '☆') + '</span>' +
                 '<span class="wg-main">' +
                   '<span class="wg-title">' + esc(t.title) + '</span>' +
                   '<span class="wg-sub">' + esc(t.course || '未归课') + '</span>' +
                 '</span>' +
                 '<span class="wg-when ' + info.kind + '">' + esc(info.label) + '</span>' +
               '</div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="wg-next-empty">清单是空的，今天可以躺平</div>';
    }

    // 底部数字
    html += '<div class="wg-stats">' +
              '<div class="wg-stat"><b>' + todays.length + '</b><span>今日安排</span></div>' +
              '<div class="wg-stat"><b>' + tasks.length + '</b><span>待办</span></div>' +
              '<div class="wg-stat"><b>' + pend + '</b><span>待结算</span></div>' +
            '</div>';

    html += '<div class="wg-foot"><span>排得开 · 桌面挂件</span>' +
            '<a href="index.html" target="_blank">打开主站 →</a></div>';

    app.innerHTML = html;
  }

  render();
  setInterval(render, 5000);                       // 每 5 秒自己刷一次
  window.addEventListener('storage', render);      // 主站改了数据，这边立刻跟上
  window.addEventListener('focus', render);
})();
