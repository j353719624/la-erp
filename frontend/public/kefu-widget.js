/*!
 * kefu-widget.js — 客户通(客服通) 内嵌客服浮窗共享组件 v1.1.3
 * ---------------------------------------------------------------------------
 * 来源：由 la-biz 智家业务通 app.js 的客服浮窗实现（v1.7.20~v1.7.24：内嵌 iframe /
 *       可拖动 / 可完全移出视口 / 最小化 / 机器码携带 / postMessage 新消息提醒 /
 *       边缘恢复浮标）抽取通用化而成，行为与 la-biz 一致。
 * 用途：任何业务系统（la-biz / Lpsi / LA-ERP / 其他）只需引入本文件并调用
 *       KefuWidget.init(...) 即可获得与 la-biz 完全一致的客服浮窗体验，
 *       无需各自重复实现。
 *
 * 功能清单：
 *   1. 内嵌 iframe 客服浮窗（不弹新窗口），从侧边栏"联系客服"入口处展开
 *   2. 关闭/最小化仅隐藏浮窗，iframe 保留后台轮询（客服回复仍能到达）
 *   3. 客服回复时（客户通 embed 模式 postMessage）→ 浮窗内提醒条 + 自动亮起 / 头部闪烁
 *   4. 浮窗可拖动（鼠标+触摸），允许完全移出视口（彻底让出工作区）
 *   5. 完全移出视口 → 显示「💬客服」边缘恢复浮标；点恢复浮标回默认位置并打开
 *   6. 位置记忆（localStorage，可配置 key），移动端全宽自适应
 *   7. 懒加载：首次打开才加载客服页（携带 source + embed=1 + 机器码）
 *   8. 机器码携带：可配置 machineUrl 免登录接口自动获取，或直接传 machine 字符串
 *   9. 昵称记忆（v1.1.0）：监听客服端(客户通 customer.php)上行 kefu_nickname → 本地 localStorage 记住
 *  10. 自动直达（v1.1.0）：再次打开自动携带 ?nickname= → 客户通 entry 端免输入昵称直接进入聊天
 *  11. 身份昵称防死锁（v1.1.3）：仅"用户主动改名"写入本地并置 manual 标记；服务端身份昵称
 *      （init nickname，如 公司名-登录用户名）优先于历史自动写入的旧昵称——修复客服端永远显示
 *      旧名（系统管理员/访客xxxx）、配了公司名也不更新、清缓存/重启无效的死锁。
 *      ⚠️ 配套客户通 v1.2.56+（customer.php 仅在用户主动改名时 postMessage 上报）
 *
 * 依赖：无（原生 JS，ES5 兼容，不依赖任何框架/jQuery）
 * 兼容：Chrome/Edge/Firefox/Safari + 移动端触摸；HTTP 页面嵌入 HTTPS 客服 iframe 允许
 *
 * 使用（3 步接入，详见同目录 README.md）：
 *   <script src="kefu-widget.js"></script>
 *   <script>
 *     KefuWidget.init({ source: 'lpsi', trigger: '#contact-service', machineUrl: '/api/machine-code' });
 *   </script>
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /* ================= 默认配置 ================= */
  var DEFAULTS = {
    baseUrl: 'https://kf.laxijin.top:18885', // 客服系统地址（客户通）
    source: '',                              // 来源标识：la-biz / lpsi / erp / 自定义（客服后台显示 [来源]）
    machine: '',                             // 机器码（可选）：直接指定字符串
    machineUrl: '',                          // 机器码接口（可选，优先于 machine）：GET 返回 JSON 含 machine_code 或 machine
    uid: '',                                 // 业务系统登录用户标识(如登录用户名)——集中部署/同机多人时会话按 uid 隔离, 防串台
    trigger: null,                           // 触发入口：CSS 选择器字符串 / 元素 / 元素数组（点击切换浮窗）
    sidebarSelector: '.sidebar, #sidebar',   // 侧边栏选择器（用于定位默认展开位置）
    positionKey: 'kf_fab_pos',               // 拖动位置记忆 localStorage key
    nickname: '',                            // 可选：业务系统身份昵称（如登录用户名，服务端来源，作为无自设记忆时的默认身份）
    nicknameKey: 'kefu_nickname',            // 本地昵称记忆 localStorage key（用户客服端【主动改名】后保存）
    manualKey: 'kefu_nickname_manual',       // 用户自设名标记 key（v1.1.3）：仅用户主动改名才置 1——
                                             //   防止客服端历史自动上报把旧名(系统管理员/访客xxxx)写回本地并永久锁死服务端身份
    onNickname: null,                        // 可选回调：客服端上报昵称时调用 fn(nickname)
    title: '联系客服',                       // 浮窗标题
    onMessage: null,                         // 可选回调：收到客服新消息时调用 fn(body)
    flashMs: 2000                            // 收到新消息时头部闪烁时长(ms)
  };

  var o = null;        // 合并后的配置
  var kw = null;       // 浮窗根元素
  var kwFrame = null;  // iframe
  var kwToast = null;  // 提醒条
  var kwRecover = null;// 边缘恢复浮标
  var kwVisible = false;
  var kwMoved = false; // 是否被拖动过（拖动后 resize 不重置位置）
  var kwLoaded = false;// iframe 是否已加载
  var kwToastTimer = null;

  /* ================= 工具 ================= */
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = (s === null || s === undefined) ? '' : String(s);
    return d.innerHTML;
  }
  function hostOf(url) {
    try { return new URL(url, location.href).host; } catch (e) { return ''; }
  }
  function el(id) { return document.getElementById(id); }

  /* ============ 昵称记忆（v1.1.0，客户通 2026-09-03 协议） ============ */
  // 清洗对齐客户通 entry.php 白名单：去 < > ' " 并截 30 字
  function sanitizeNick(s) {
    return String(s === null || s === undefined ? '' : s).trim().replace(/[<>'"]/g, '').slice(0, 30);
  }
  // 昵称优先级（v1.1.3）：
  //   1) 用户【主动自设/改名】的记忆（localStorage + manual 标记）——尊重用户选择，跨会话稳定
  //   2) init 传入的 nickname——业务系统服务端身份（如 公司名-登录用户名），服务端来源天然抗清理/抗旧缓存；
  //      优先于"历史自动写入"的旧昵称：早期客服端会把线程默认名(系统管理员/访客xxxx)反复写回本地，
  //      若本地一律优先会把服务端身份永久锁死（配了公司名也不更新）——故非用户自设的旧值不再压过服务端身份
  //   3) 本地遗留值——无服务端身份时的兜底（匿名/老宿主）
  //   4) 空——首次且无系统身份，显示客服端输入页
  function getNickname() {
    var manual = false;
    try { manual = localStorage.getItem(o.manualKey) === '1'; } catch (e) {}
    if (manual) {
      try { var v = localStorage.getItem(o.nicknameKey); if (v) return sanitizeNick(v); } catch (e) {}
    }
    if (o && o.nickname) return sanitizeNick(o.nickname);
    try { var v2 = localStorage.getItem(o.nicknameKey); if (v2) return sanitizeNick(v2); } catch (e) {}
    return '';
  }
  // manual=true：用户主动改名（客服端 doRename 上报 / 宿主显式 setNickname）→ 置标记，永久优先
  // manual=false：历史自动写入 → 不置标记（可被服务端身份覆盖）
  function setNickname(n, manual) {
    n = sanitizeNick(n);
    if (!n) return;
    try {
      localStorage.setItem(o.nicknameKey, n);
      if (manual) { localStorage.setItem(o.manualKey, '1'); }
      else { localStorage.removeItem(o.manualKey); }
    } catch (e) {}
  }

  /* ================= 样式注入（仅一次） ================= */
  function ensureStyle() {
    if (el('kw-style')) return;
    var st = document.createElement('style');
    st.id = 'kw-style';
    st.textContent = '' +
      '#kw-fab{position:fixed;z-index:9999;display:none;flex-direction:column;width:420px;max-width:calc(100vw - 240px);height:640px;max-height:calc(100vh - 20px);background:#fff;border-radius:10px 10px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '#kw-fab .kw-head{display:flex;align-items:center;justify-content:space-between;background:#2c3e50;color:#fff;padding:10px 14px;user-select:none;flex-shrink:0;cursor:move}' +
      '#kw-fab .kw-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}' +
      '#kw-fab .kw-actions{display:flex;gap:4px}' +
      '#kw-fab .kw-btn{background:transparent;border:none;color:rgba(255,255,255,.8);font-size:14px;padding:4px 8px;cursor:pointer;border-radius:4px;line-height:1}' +
      '#kw-fab .kw-btn:hover{background:rgba(255,255,255,.15);color:#fff}' +
      '#kw-fab .kw-body{flex:1;min-height:0;position:relative}' +
      '#kw-fab .kw-body iframe{width:100%;height:100%;border:0;display:block}' +
      '#kw-fab .kw-toast{position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(44,62,80,.95);color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;max-width:90%;box-shadow:0 2px 10px rgba(0,0,0,.3);z-index:10;line-height:1.4}' +
      '#kw-fab.kw-flash .kw-head{animation:kwFlash .6s ease 3}' +
      '@keyframes kwFlash{0%,100%{background:#2c3e50}50%{background:#e67e22}}' +
      '#kw-recover{position:fixed;right:16px;top:50%;transform:translateY(-50%);z-index:9998;background:#2c3e50;color:#fff;border:none;border-radius:20px;padding:10px 14px;font-size:13px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.25);display:none;font-family:inherit}' +
      '@media (max-width:768px){#kw-fab{left:8px !important;right:8px;width:auto;height:480px;max-width:none}}';
    document.head.appendChild(st);
  }

  /* ================= DOM 构建 ================= */
  function ensureDom() {
    if (kw) return;
    ensureStyle();
    var fab = document.createElement('div');
    fab.id = 'kw-fab';
    fab.innerHTML = '' +
      '<div class="kw-head">' +
      '  <span class="kw-title">💬 ' + esc(o.title) + '</span>' +
      '  <div class="kw-actions">' +
      '    <button type="button" class="kw-btn" id="kw-min" title="最小化(后台继续接收客服回复)">－</button>' +
      '    <button type="button" class="kw-btn" id="kw-close" title="关闭(后台继续接收客服回复)">✕</button>' +
      '  </div>' +
      '</div>' +
      '<div class="kw-body">' +
      '  <iframe id="kw-frame" title="' + esc(o.title) + '" src="about:blank" allow="microphone;camera"></iframe>' +
      '  <div class="kw-toast" id="kw-toast" style="display:none"></div>' +
      '</div>';
    document.body.appendChild(fab);
    kw = fab;
    kwFrame = fab.querySelector('#kw-frame');
    kwToast = fab.querySelector('#kw-toast');
    kwVisible = false;

    // 关闭：仅隐藏浮窗（iframe 保留 → 后台轮询继续）
    fab.querySelector('#kw-close').onclick = function (e) { e.stopPropagation(); hide(); };
    // 最小化：隐藏 + 显示「💬客服」恢复浮标（后台轮询继续）
    fab.querySelector('#kw-min').onclick = function (e) { e.stopPropagation(); hide(); showRecover(); };

    // 默认定位：从侧边栏右侧展开（左侧=侧边栏宽度, 底部=0）；拖动过则 resize 不重置
    var layout = function () {
      if (kwMoved) return;
      var sb = document.querySelector(o.sidebarSelector);
      var sbW = sb ? sb.offsetWidth : 210;
      fab.style.left = (sbW + 8) + 'px';
      fab.style.bottom = '0px';
      fab.style.top = 'auto';
    };
    layout();
    window.addEventListener('resize', layout);

    // 恢复上次拖动位置
    try {
      var pos = JSON.parse(localStorage.getItem(o.positionKey) || 'null');
      if (pos && pos.left) {
        kwMoved = true;
        fab.style.left = pos.left;
        if (pos.top) { fab.style.top = pos.top; fab.style.bottom = 'auto'; }
      }
    } catch (e) {}

    initDrag(fab);

    // 监听客服 iframe 新消息（客户通 embed 模式 postMessage 通知）
    window.addEventListener('message', onMessage);
  }

  /* ================= 拖动（鼠标 + 触摸，允许移出视口） ================= */
  function initDrag(fab) {
    var head = fab.querySelector('.kw-head');
    var drag = null;
    function start(cx, cy) {
      var r = fab.getBoundingClientRect();
      drag = { dx: cx - r.left, dy: cy - r.top };
      if (kwFrame) kwFrame.style.pointerEvents = 'none'; // 拖动时禁用 iframe 交互，防鼠标进入 iframe 丢事件
      document.body.style.userSelect = 'none';
      try { document.body.style.cursor = 'grabbing'; } catch (e) {}
    }
    function move(cx, cy) {
      if (!drag) return;
      // 允许完全移出当前窗口视口（彻底让出工作区）；移出后通过边缘浮标找回
      fab.style.left = (cx - drag.dx) + 'px';
      fab.style.top = (cy - drag.dy) + 'px';
      fab.style.bottom = 'auto';
    }
    function end() {
      if (!drag) return;
      drag = null;
      kwMoved = true;
      if (kwFrame) kwFrame.style.pointerEvents = '';
      document.body.style.userSelect = '';
      try { document.body.style.cursor = ''; } catch (e) {}
      try {
        localStorage.setItem(o.positionKey, JSON.stringify({ left: fab.style.left, top: fab.style.top }));
      } catch (e) {}
      // 完全移出视口 → 显示边缘恢复浮标
      var r = fab.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) {
        showRecover();
      } else {
        hideRecover();
      }
    }
    head.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return; // 不拦截按钮点击
      e.preventDefault();
      start(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    document.addEventListener('mouseup', end);
    head.addEventListener('touchstart', function (e) {
      if (e.target.closest('button')) return;
      var t = e.touches[0]; start(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchmove', function (e) {
      if (!drag) return;
      e.preventDefault();
      var t = e.touches[0]; move(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchend', end);
  }

  /* ================= 边缘恢复浮标 ================= */
  function ensureRecover() {
    if (kwRecover) return;
    var rec = document.createElement('button');
    rec.id = 'kw-recover';
    rec.type = 'button';
    rec.textContent = '💬 客服';
    rec.onclick = function () {
      kwMoved = false;
      try { localStorage.removeItem(o.positionKey); } catch (e) {}
      var sb = document.querySelector(o.sidebarSelector);
      kw.style.left = ((sb ? sb.offsetWidth : 210) + 8) + 'px';
      kw.style.bottom = '0px';
      kw.style.top = 'auto';
      show();
    };
    document.body.appendChild(rec);
    kwRecover = rec;
  }
  function showRecover() { ensureRecover(); if (kwRecover) kwRecover.style.display = 'block'; }
  function hideRecover() { if (kwRecover) kwRecover.style.display = 'none'; }

  /* ================= 打开/隐藏 ================= */
  // 若浮窗完全在视口外（拖出后点入口/恢复），自动回到默认位置
  function resetIfOffscreen() {
    var r = kw.getBoundingClientRect();
    if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) {
      kwMoved = false;
      var sb = document.querySelector(o.sidebarSelector);
      kw.style.left = ((sb ? sb.offsetWidth : 210) + 8) + 'px';
      kw.style.bottom = '0px';
      kw.style.top = 'auto';
      try { localStorage.removeItem(o.positionKey); } catch (e) {}
    }
  }
  function show() {
    if (!kw) ensureDom();
    resetIfOffscreen();
    hideRecover();
    kwVisible = true;
    kw.style.display = 'flex';
    // 懒加载：首次打开才加载客服页（携带 source + embed=1 + 机器码）
    if (!kwLoaded) {
      kwLoaded = true;
      loadKf();
    }
  }
  function hide() {
    kwVisible = false;
    if (kw) kw.style.display = 'none';
    // iframe 不销毁, JS 持续运行 → 后台轮询继续, 客服回复仍能到达
  }
  function toggle() { if (kwVisible) { hide(); } else { show(); } }

  // 携带本地记忆的昵称 → 客户通入口(entry)端自动开始直达聊天（2026-09-03 协议）；
  // 昵称清洗后入 URL，服务端会再次白名单过滤
  function withNick(u) {
    var nn = getNickname();
    if (nn) { u += '&nickname=' + encodeURIComponent(nn); }
    return u;
  }
  // 携带业务系统登录用户标识 uid(v1.1.2)——客户通按 machine+source+uid 隔离会话(集中部署/同机多人防串台)
  function withUid(u) {
    var u2 = o.uid ? String(o.uid).trim() : '';
    u2 = u2.replace(/[^A-Za-z0-9\-_.@]/g, '').slice(0, 64);
    if (u2) { u += '&uid=' + encodeURIComponent(u2); }
    return u;
  }

  // 打开客服时自动携带机器码（免登录机器码接口 / 直接指定）
  // 好处: 客服端可查该机器历史对话 / 直接复制机器码用于激活, 客户无需手动发送
  function loadKf() {
    var url = o.baseUrl + '/?source=' + encodeURIComponent(o.source) + '&embed=1';
    if (o.machine) {
      kwFrame.src = withUid(withNick(url + '&machine=' + encodeURIComponent(o.machine)));
      return;
    }
    if (o.machineUrl) {
      // URL.searchParams 是只读 getter 不可赋值；new URL() 自带空 URLSearchParams，无需防御
      var p = new URL(o.machineUrl, location.href);
      fetch(p.toString(), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          // 兼容两种返回格式：裸 {machine_code}/{machine}（la-biz 约定），或业务响应包装 {code,message,data:{machine_code}}（如 LA-ERP response.OK）
          var d0 = d || {};
          var mc = d0.machine_code || d0.machine || (d0.data && (d0.data.machine_code || d0.data.machine)) || '';
          kwFrame.src = withUid(withNick(url + (mc ? '&machine=' + encodeURIComponent(mc) : '')));
        })
        .catch(function () { kwFrame.src = withUid(withNick(url)); }); // 获取失败也照常打开（不带机器码）
      return;
    }
    kwFrame.src = withUid(withNick(url));
  }

  /* ================= 客服新消息（来自客户通 iframe postMessage） ================= */
  function onMessage(e) {
    if (!e || typeof e.origin !== 'string' || e.origin.indexOf(hostOf(o.baseUrl)) === -1) return;
    var d = e.data || {};
    // 客服端上报昵称（v1.2.56 起仅【用户主动改名】时 postMessage 上行）→ 视为用户自设名，本地记忆+置标记
    if (d.type === 'kefu_nickname') {
      setNickname(d.nickname, true);
      if (typeof o.onNickname === 'function') { try { o.onNickname(sanitizeNick(d.nickname)); } catch (err) {} }
      return;
    }
    if (d.type !== 'kefu_new_msg') return;
    // 提醒条
    showToast(d.body || '客服回复了');
    if (typeof o.onMessage === 'function') { try { o.onMessage(d.body || ''); } catch (err) {} }
    // 浮窗未打开 → 自动亮起; 已打开 → 头部闪烁提醒
    if (!kwVisible) {
      show();
    } else if (kw) {
      kw.classList.add('kw-flash');
      setTimeout(function () { if (kw) kw.classList.remove('kw-flash'); }, o.flashMs);
    }
  }

  function showToast(text) {
    if (!kwToast) return;
    kwToast.textContent = '💬 客服回复：' + text;
    kwToast.style.display = 'block';
    clearTimeout(kwToastTimer);
    kwToastTimer = setTimeout(function () { if (kwToast) kwToast.style.display = 'none'; }, 5000);
  }

  /* ================= 触发入口绑定 ================= */
  function bindTriggers() {
    if (!o.trigger) return;
    var list = [];
    if (typeof o.trigger === 'string') {
      try { list = Array.prototype.slice.call(document.querySelectorAll(o.trigger)); } catch (e) { list = []; }
    } else if (o.trigger instanceof Element) {
      list = [o.trigger];
    } else if (o.trigger.length) {
      list = Array.prototype.slice.call(o.trigger);
    }
    list.forEach(function (node) {
      node.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      });
    });
  }

  /* ================= 对外 API ================= */
  var KefuWidget = {
    version: '1.1.3',
    init: function (opts) {
      o = {};
      for (var k in DEFAULTS) { if (DEFAULTS.hasOwnProperty(k)) o[k] = DEFAULTS[k]; }
      if (opts) { for (var k2 in opts) { if (opts.hasOwnProperty(k2) && opts[k2] !== undefined) o[k2] = opts[k2]; } }
      if (!o.baseUrl) o.baseUrl = DEFAULTS.baseUrl;
      ensureDom();
      bindTriggers();
      return KefuWidget;
    },
    open: function () { if (!kw) ensureDom(); show(); },
    close: function () { hide(); },
    toggle: function () { if (!kw) ensureDom(); toggle(); },
    isOpen: function () { return kwVisible; },
    // 运行时更新机器码（如需在打开前异步获取后设置）
    setMachine: function (mc) { o.machine = mc || ''; },
    // 设置/清除本地昵称（宿主显式调用=用户身份设定 → 置 manual 标记；清除则回退到 init 身份昵称）
    setNickname: function (n) {
      if (n === null || n === undefined || String(n).trim() === '') {
        o.nickname = '';
        try { localStorage.removeItem(o.nicknameKey); } catch (e) {}
        try { localStorage.removeItem(o.manualKey); } catch (e) {}
        return KefuWidget;
      }
      setNickname(n, true);
      return KefuWidget;
    },
    getNickname: function () { return getNickname(); },
    getConfig: function () { return o; }
  };

  global.KefuWidget = KefuWidget;
})(window);
