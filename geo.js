/* 排得开 · 定位模块（独立文件）
   自己创建 DOM 和样式，主站只需要一行 <script src="geo.js" defer>。
   任何地方出错都不会影响主应用。 */
(function () {
  'use strict';

  var LAT = 30.3199, LNG = 120.3527;   // 杭电下沙校区
  var DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180;
    var y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    var x = Math.cos(lat1 * r) * Math.sin(lat2 * r) -
            Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  function dirText(deg) {
    return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  }

  var CSS = [
    '.zbs-fab{position:fixed;right:16px;z-index:60;width:54px;height:54px;border-radius:50%;',
    'display:grid;place-items:center;cursor:pointer;font-size:12px;font-weight:800;',
    'box-shadow:0 12px 28px -14px rgba(19,24,41,.55);transition:transform .16s ease}',
    '.zbs-fab:hover{transform:translateY(-2px)}',
    '.zbs-geo{background:linear-gradient(140deg,#4f46e5,#06b6d4);color:#fff;border:0}',
    '.zbs-c3d{background:#fff;color:#4f46e5;border:1px solid #e0e4ee;text-decoration:none;font-size:13px;font-weight:900}',
    '@media(max-width:640px){.zbs-geo{bottom:calc(84px + env(safe-area-inset-bottom))}',
    '.zbs-c3d{bottom:calc(146px + env(safe-area-inset-bottom))}}',
    '@media(min-width:641px){.zbs-geo{bottom:28px}.zbs-c3d{bottom:90px}}',
    '.zbs-geo-modal{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:16px}',
    '.zbs-geo-modal[hidden]{display:none}',
    '.zbs-mask{position:absolute;inset:0;background:rgba(17,21,34,.55)}',
    '.zbs-card{position:relative;width:min(420px,100%);background:#fff;border:1px solid #e0e4ee;',
    'border-radius:18px;padding:20px;box-shadow:0 24px 60px -30px rgba(19,24,41,.6);color:#131829;',
    'font-family:inherit;text-align:left}',
    '.zbs-k{margin:0;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8b94a8}',
    '.zbs-card h3{margin:2px 0 0;font-size:19px;font-weight:800}',
    '.zbs-addr{margin:12px 0 2px;font-size:12px;color:#454e63;line-height:1.6}',
    '.zbs-note{margin:0;font-size:10.5px;color:#8b94a8}',
    '.zbs-body{margin:14px 0;padding:14px;border-radius:12px;background:#f3f5fa;border:1px solid #e0e4ee}',
    '.zbs-hint{margin:0;font-size:12px;color:#8b94a8;line-height:1.7}',
    '.zbs-num{font-size:28px;font-weight:900;letter-spacing:-.03em}',
    '.zbs-num small{font-size:13px;font-weight:700;margin-left:3px;color:#8b94a8}',
    '.zbs-dir{margin-top:4px;font-size:12px;color:#3b34c4;font-weight:700}',
    '.zbs-acts{display:flex;gap:8px;flex-wrap:wrap}',
    '.zbs-btn{padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;',
    'text-decoration:none;display:inline-block}',
    '.zbs-ok{background:#4f46e5;color:#fff;border:0}',
    '.zbs-ghost{background:#f3f5fa;color:#3b34c4;border:1px solid #e0e4ee}',
    '.zbs-x{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:8px;',
    'border:1px solid #e0e4ee;background:#f3f5fa;cursor:pointer;font-size:13px;color:#454e63}'
  ].join('');

  function boot() {
    if (document.getElementById('zbsGeoCss')) return;

    var style = el('style', '', CSS);
    style.id = 'zbsGeoCss';
    document.head.appendChild(style);

    var geoBtn = el('button', 'zbs-fab zbs-geo', '定位');
    geoBtn.type = 'button';
    geoBtn.title = '定位 · 算到校区的距离';
    document.body.appendChild(geoBtn);

    var c3d = el('a', 'zbs-fab zbs-c3d', '3D');
    c3d.href = 'campus.html';
    c3d.title = '3D 校园地图';
    document.body.appendChild(c3d);

    var modal = el('div', 'zbs-geo-modal');
    modal.hidden = true;
    modal.appendChild(el('div', 'zbs-mask'));
    var card = el('div', 'zbs-card');
    card.innerHTML =
      '<button class="zbs-x" type="button" aria-label="关闭">✕</button>' +
      '<p class="zbs-k">Live location</p>' +
      '<h3>我的位置</h3>' +
      '<p class="zbs-addr">杭州电子科技大学 · 下沙校区 · 学源街 1158 号</p>' +
      '<p class="zbs-note">只在本机计算，不上传</p>' +
      '<div class="zbs-body"><p class="zbs-hint">点下面按钮，浏览器会问你要不要授权定位。</p></div>' +
      '<div class="zbs-acts">' +
        '<button class="zbs-btn zbs-ok" type="button">允许定位</button>' +
        '<a class="zbs-btn zbs-ghost" target="_blank" rel="noopener" ' +
          'href="https://uri.amap.com/marker?position=120.3527,30.3199&name=杭州电子科技大学下沙校区">在高德打开</a>' +
      '</div>';
    modal.appendChild(card);
    document.body.appendChild(modal);

    var body = card.querySelector('.zbs-body');
    var ok = card.querySelector('.zbs-ok');
    var x = card.querySelector('.zbs-x');

    function close() { modal.hidden = true; }
    x.addEventListener('click', close);
    modal.querySelector('.zbs-mask').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    geoBtn.addEventListener('click', function () { modal.hidden = false; });

    ok.addEventListener('click', function () {
      if (!navigator.geolocation) {
        body.innerHTML = '<p class="zbs-hint">这个浏览器不支持定位。</p>';
        return;
      }
      body.innerHTML = '<p class="zbs-hint">正在定位…</p>';
      navigator.geolocation.getCurrentPosition(function (p) {
        var m = haversine(p.coords.latitude, p.coords.longitude, LAT, LNG);
        var b = bearing(p.coords.latitude, p.coords.longitude, LAT, LNG);
        var txt = m < 1000 ? Math.round(m) + '<small>米</small>'
                           : (m / 1000).toFixed(1) + '<small>公里</small>';
        body.innerHTML =
          '<div class="zbs-num">' + txt + '</div>' +
          '<div class="zbs-dir">校区在你 ' + dirText(b) + ' 方向 · 方位角 ' + Math.round(b) + '°</div>' +
          '<p class="zbs-hint" style="margin-top:8px">定位精度约 ' + Math.round(p.coords.accuracy || 0) + ' 米</p>';
        ok.textContent = '重新定位';
      }, function () {
        body.innerHTML = '<p class="zbs-hint">定位被拒绝或失败 —— 可以点「在高德打开」手动看路线。</p>';
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
