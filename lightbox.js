/* 排得开 · 图片灯箱（独立文件）
   点页面上任意大图全屏查看。主站只需要 <script src="lightbox.js" defer>。 */
(function () {
  'use strict';

  var MIN_W = 400;          // 小于这个宽度的图（图标）不放大

  function boot() {
    if (document.getElementById('zbsLbox')) return;

    var style = document.createElement('style');
    style.id = 'zbsLboxCss';
    style.textContent =
      '.zbs-lbox{position:fixed;inset:0;z-index:200;display:grid;place-items:center;' +
      'background:rgba(10,12,18,.93);padding:20px}' +
      '.zbs-lbox[hidden]{display:none}' +
      '.zbs-lbox img{max-width:94vw;max-height:86vh;border-radius:12px;' +
      'box-shadow:0 30px 80px -30px #000;display:block}' +
      '.zbs-lbox-x{position:absolute;top:18px;right:18px;width:38px;height:38px;border-radius:50%;' +
      'border:0;background:rgba(255,255,255,.14);color:#fff;font-size:15px;cursor:pointer}' +
      '.zbs-lbox-cap{position:absolute;bottom:22px;left:0;right:0;text-align:center;' +
      'font-size:11px;color:rgba(255,255,255,.55)}';
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.className = 'zbs-lbox';
    box.id = 'zbsLbox';
    box.hidden = true;
    box.innerHTML =
      '<button class="zbs-lbox-x" type="button" aria-label="关闭">✕</button>' +
      '<img alt="">' +
      '<div class="zbs-lbox-cap">点任意处关闭 · Esc</div>';
    document.body.appendChild(box);

    var img = box.querySelector('img');

    function close() { box.hidden = true; img.removeAttribute('src'); }

    box.addEventListener('click', function (e) {
      if (e.target === img) return;      // 点图片本身不关
      close();
    });
    box.querySelector('.zbs-lbox-x').addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !box.hidden) close();
    });

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (t.closest('.zbs-lbox')) return;
      if (t.closest('a')) return;        // 链接里的图不接管
      var w = t.naturalWidth || 0;
      if (w && w < MIN_W) return;
      img.src = t.currentSrc || t.src;
      box.hidden = false;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
