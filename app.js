/* ============================================================
   排得开 · 校园活动智能排程器
   纯前端原型：无构建、无依赖、无后端。
   ============================================================ */
(function () {
  'use strict';

  /* ---- 构建一致性检查：HTML 缓存比脚本旧时，自动重载一次 ---- */
  var BUILD = '20261128d2';
  (function () {
    try {
      var stamp = document.body && document.body.getAttribute('data-build');
      if (stamp && stamp !== BUILD) {
        // HTML 是缓存的旧版：带上新参数重新取一次，绕过 10 分钟缓存
        if (!sessionStorage.getItem('zbs.reloaded.' + BUILD)) {
          sessionStorage.setItem('zbs.reloaded.' + BUILD, '1');
          location.replace(location.pathname + '?_b=' + BUILD);
        }
      } else if (stamp) {
        // 版本对上了，清掉标记
        try { sessionStorage.removeItem('zbs.reloaded.' + BUILD); } catch (e) {}
      }
    } catch (e) { /* 忽略 */ }
  })();

  /* ---------------- 常量 ---------------- */

  var WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  var TYPES = {
    lecture:     { label: '讲座', color: '#4C5CE0', bg: '#EEF1FE', colorDark: '#8A96FF', bgDark: '#1B2039' },
    practice:    { label: '实践', color: '#7C5CFF', bg: '#F3F0FF', colorDark: '#A996FF', bgDark: '#231D3B' },
    volunteer:   { label: '志愿', color: '#0E9C82', bg: '#E7F7F3', colorDark: '#3AD0AE', bgDark: '#122C27' },
    sports:      { label: '体育', color: '#D9821A', bg: '#FFF4E4', colorDark: '#F0A64A', bgDark: '#2E2413' },
    competition: { label: '竞赛', color: '#D6503E', bg: '#FDEDEA', colorDark: '#FF7C68', bgDark: '#2F1A18' },
    art:         { label: '文体', color: '#C84589', bg: '#FDEBF4', colorDark: '#F07AB8', bgDark: '#2E1626' },
    career:      { label: '职发', color: '#1C86C4', bg: '#E8F5FD', colorDark: '#4FB4E8', bgDark: '#132A38' }
  };

  // 当前主题下该用哪一档配色
  function typeColor(t) {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? (t.colorDark || t.color) : t.color;
  }
  function typeBg(t) {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? (t.bgDark || t.bg) : t.bg;
  }

  // 课程时段（分钟）
  var SLOTS = {
    am:  [480, 720],   // 08:00 - 12:00
    pm:  [840, 1080],  // 14:00 - 18:00
    eve: [1140, 1320]  // 19:00 - 22:00
  };
  var SLOT_LABEL = { am: '上午', pm: '下午', eve: '晚上' };

  var START_H = 8;
  var END_H = 22;
  var PPM = 0.78;                       // 每分钟像素
  var BOARD_H = (END_H - START_H) * 60 * PPM;   // 655.2
  var HR_PX = 60 * PPM;                 // 46.8

  var INTERESTS = ['技术编程', '学术讲座', '志愿服务', '文体艺术', '创新创业', '职业发展', '体育运动'];

  var REASON_TEXT = {
    noroom: '这天已经排满了',
    deadline: '报名已截止',
    full: '名额已满',
    busy: '与你的课程冲突',
    time: '时间重叠',
    travel: '转场来不及',
    dense: '当天排太满'
  };

  /* ---------------- 工具函数 ---------------- */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function toMin(hhmm) {
    var p = String(hhmm).split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  function nextMonday(base) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    var wd = d.getDay();                 // 0 = 周日
    var todayIso = wd === 0 ? 7 : wd;    // 1..7
    return addDays(d, 8 - todayIso);     // 总是取「下一个周一」
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtGap(m) {
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' 小时 ' + r + ' 分' : h + ' 小时';
  }

  /* ---------------- 地点区域与转场耗时 ---------------- */

  function placeZone(p) {
    if (!p) return 2;
    if (/田径|体育馆|球场|操场|健身房/.test(p)) return 3;
    if (/社区|宿舍|食堂|生活区/.test(p)) return 4;
    if (/校外|奥体|拱墅|西湖|市区|少年宫|敬老院/.test(p)) return 5;
    if (/一教|二教|三教|四教|教学楼|实验楼|科技馆/.test(p)) return 1;
    return 2;                            // 图书馆 / 活动中心 / 艺术楼 / 大礼堂
  }

  function travelMin(a, b) {
    if (!a || !b) return 10;
    if (String(a).trim() === String(b).trim()) return 5;
    var d = Math.abs(placeZone(a) - placeZone(b));
    return 8 + 6 * d;                 // 同区 8 分钟，跨一次区 14，最远 32
  }

  /* ---------------- 状态 ---------------- */

  var state = {
    weekStart: nextMonday(new Date()),
    goals: { credit: 2.5, volunteer: 4, run: 2 },
    interests: ['技术编程', '志愿服务'],
    busy: [],
    maxPerDay: 3,
    events: [],
    schedule: [],
    rejected: [],
    lastIds: {},

    // 阳光乐跑学期数据（来自微信小程序「运动时间bank」的手动同步）
    run: { done: 18, target: 21, km: 27, weeksLeft: 4, len: 30 },
    history: [],          // 导入的二课 / 志愿历史记录
    mode: 'demo',         // demo = 铺样例数据；normal = 空白，全靠自己导入

    // 三个数据源的接入状态：mode 表示走的是哪种适配器
    sources: {
      run: { synced: false, at: null },
      erke: { synced: false, at: null, imported: 0 },
      dingtalk: { synced: false, at: null }
    },

    // 多模态模型配置（兼容 OpenAI /chat/completions）
    // 说明：2026 年起千问主线模型（qwen3.7-plus / qwen4-max / qwen3.8-flash）本身就支持图像输入，
    // 老的 qwen-vl-max 等型号已于 2026-07-13 下线，所以不要再用「名字里有没有 VL」来猜能力。
    vision: {
      provider: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      key: '',
      model: 'qwen3.7-plus'
    },
    visionModels: [],

    // 当前看的是哪一天
    activeDay: 0,
    page: 'home',

    // 课表里的课（带时间和名字，用来画进日程）
    courses: [],

    // 用户亲手勾选的活动 id —— 系统只推荐，去不去你说了算
    chosenIds: [],

    // 问卷得出的兴趣侧写
    profile: {
      done: false,
      tags: [],
      slots: [],
      weekend: false,
      motivation: 'fun',
      maxDuration: 120
    },

    // 作业清单
    tasks: [],

    // 已结算 / 待结算的活动记录
    records: [],

    // 从 Wallpaper Engine 导入的壁纸
    wallpapers: [],

    // 当前背景
    bg: { kind: 'default' },

    // 活动页的两种状态：edit 编辑活动 / done 已编辑
    pickMode: 'edit',

    // 学期：开学第一天的周一
    term: { start: '2026-09-07', grade: 2, semester: 1 },

    // 上次保存时间
    savedAt: 0
  };

  // 出厂默认值：新建 / 重置档案时回到这里
  var STATE_DEFAULTS = JSON.parse(JSON.stringify({
    goals: state.goals,
    interests: state.interests,
    profile: state.profile,
    maxPerDay: state.maxPerDay,
    run: state.run,
    sources: state.sources,
    term: state.term
  }));

  // 时间落在哪个时段
  function slotOf(hhmm) {
    var m = toMin(hhmm);
    if (m < 720) return 'am';
    if (m < 1080) return 'pm';
    return 'eve';
  }

  function busyKey(d, slot) { return d + '-' + slot; }
  function isBusy(d, slot) { return state.busy.indexOf(busyKey(d, slot)) !== -1; }

  /* ---------------- 作业：模型与工具 ---------------- */

  // 演示用：构造「相对今天第 n 天、某个钟点」的时间
  function seedDue(dayOffset, hh, mm) {
    var d = addDays(new Date(), dayOffset);
    d.setHours(hh, mm || 0, 0, 0);
    return d;
  }

  var TASK_SEED = [
    { title: '提交实验预习报告', course: '电路分析基础', due: function () { return seedDue(0, 8, 0); } },
    { title: '完成 AIGC 大赛项目文档初稿', course: '生成式人工智能应用基础', due: function () { return seedDue(0, 23, 59); } },
    { title: '第十章习题 3、5、7', course: '高等数学', due: function () { return seedDue(2, 18, 0); } },
    { title: '小组展示 PPT 定稿', course: '大学英语', due: function () { return seedDue(4, 23, 59); } },
    { title: '实验报告：RC 电路幅频特性', course: '电路分析基础', due: function () { return seedDue(6, 12, 0); } }
  ];

  // 默认课表：节次 a-b，照杭电助手的真表抄的
  var COURSE_SEED = [
    { d: 0, a: 1, b: 2, title: 'C语言程序设计', place: '正心楼 503' },
    { d: 1, a: 1, b: 2, title: '高等数学 A1', place: '正心楼 518' },
    { d: 2, a: 1, b: 2, title: '线性代数', place: '正心楼 503' },
    { d: 3, a: 3, b: 4, title: '大学英语 A', place: '正心楼 403' },
    { d: 4, a: 1, b: 4, title: 'Python 与算法设计实验', place: '芯越楼 209' },
    { d: 1, a: 6, b: 6, title: '大学英语 A', place: '正心楼 403' },
    { d: 2, a: 6, b: 6, title: '高等数学 A1', place: '正心楼 518' },
    { d: 3, a: 6, b: 6, title: '体育 1', place: '田径场' },
    { d: 4, a: 6, b: 6, title: '智科与人工智能学科学导论', place: '青越学生活动中心 110' }
  ];

  var taskSeq = 0;

  function addTask(title, course, due, silent) {
    var t = {
      id: 't' + (++taskSeq),
      title: String(title || '').trim(),
      course: String(course || '').trim(),
      due: due ? new Date(due) : null,
      done: false,
      fav: false
    };
    if (!t.title) return null;
    state.tasks.push(t);
    if (!silent) renderTodo();
    return t;
  }

  // "2026-11-22 23:59" / "11-22 18:00" / "11-28" / "明晚"
  function parseDue(s) {
    if (!s) return null;
    var str = String(s).trim();
    if (!str) return null;

    var y = String(state.weekStart.getFullYear());
    var m, d, hh, mm, match;

    match = str.match(/(\d{4})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})/);
    if (match) {
      m = parseInt(match[2], 10); d = parseInt(match[3], 10);
      hh = 23; mm = 59;
      var tm = str.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
      if (tm) { hh = parseInt(tm[1], 10); mm = parseInt(tm[2], 10); }
      return new Date(parseInt(match[1], 10), m - 1, d, hh, mm);
    }

    match = str.match(/(\d{1,2})\s*[-\/月]\s*(\d{1,2})/);
    if (match) {
      m = parseInt(match[1], 10); d = parseInt(match[2], 10);
      hh = 23; mm = 59;
      var tm2 = str.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
      if (tm2) { hh = parseInt(tm2[1], 10); mm = parseInt(tm2[2], 10); }
      return new Date(parseInt(y, 10), m - 1, d, hh, mm);
    }

    // 相对说法
    var now = new Date();
    if (/今晚|今天/.test(str)) { hh = 23; mm = 59; return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm); }
    if (/明晚|明天/.test(str)) return addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);

    return null;
  }

  function dueInfo(t) {
    if (!t.due) return { kind: 'none', label: '没写截止' };

    var now = Date.now();
    var ms = t.due.getTime() - now;
    var hours = ms / 3600000;

    if (ms < 0) {
      var od = Math.abs(ms) / 3600000;
      return {
        kind: 'overdue',
        label: od < 24 ? '晚了 ' + Math.max(1, Math.round(od)) + ' 小时' : '晚了 ' + Math.round(od / 24) + ' 天'
      };
    }
    if (hours < 24) {
      return { kind: 'urgent', label: Math.max(1, Math.round(hours)) + ' 小时后' };
    }
    if (hours < 72) {
      return { kind: 'soon', label: Math.ceil(hours / 24) + ' 天后' };
    }
    return {
      kind: 'normal',
      label: (t.due.getMonth() + 1) + '/' + t.due.getDate() +
             ' ' + pad2(t.due.getHours()) + ':' + pad2(t.due.getMinutes())
    };
  }

  function tasksOf(kind) {
    return state.tasks.filter(function (t) { return !t.done && dueInfo(t).kind === kind; });
  }

  /* ---------------- 活动数据（模拟） ---------------- */

  /* d: 周几(0=周一)  s/e: 起止  dlH: 报名截止距离「现在」的小时数 */
  var RAW = [
    /* 周一 */
    { d: 0, s: '14:00', e: '15:30', title: '通识讲座 · AIGC 与设计未来', type: 'lecture', place: '第一教学楼 101',
      credit: 0.2, capacity: 200, enrolled: 186, dlH: 6, tags: ['学术讲座', '技术编程'], org: '数字媒体学院' },
    { d: 0, s: '19:00', e: '19:45', title: '阳光乐跑', type: 'sports', place: '东田径场',
      runKm: 3, capacity: null, enrolled: 0, dlH: 48, tags: ['体育运动'], org: '体育教学部' },
    { d: 0, s: '19:00', e: '21:00', title: '机器人社 · 招新宣讲会', type: 'art', place: '大学生活动中心 201',
      credit: 0.2, capacity: 120, enrolled: 117, dlH: 20, tags: ['文体艺术', '技术编程'], org: '学生社团联合会' },
    { d: 0, s: '20:00', e: '21:30', title: '校园放映 ·《奥本海默》', type: 'art', place: '大学生活动中心 影厅',
      credit: 0.1, capacity: 150, enrolled: 150, dlH: 30, tags: ['文体艺术'], org: '校学生会' },

    /* 周二 */
    { d: 1, s: '10:00', e: '11:30', title: '专家报告 · 人工智能的通识化路径', type: 'lecture', place: '第三教学楼 201',
      credit: 0.2, capacity: 300, enrolled: 240, dlH: 12, tags: ['学术讲座'], org: '计算机学院' },
    { d: 1, s: '14:00', e: '15:30', title: '简历门诊 · 一对一修改', type: 'career', place: '就业指导中心 202',
      credit: 0.1, capacity: 40, enrolled: 12, dlH: 30, tags: ['职业发展'], org: '就业指导中心' },
    { d: 1, s: '19:00', e: '21:00', title: '大模型应用开发工作坊（第三期）', type: 'practice', place: '第三教学楼 305',
      credit: 0.4, capacity: 60, enrolled: 58, dlH: 4, tags: ['技术编程', '创新创业'], org: '计算机学院 · 人工智能课程组' },
    { d: 1, s: '19:30', e: '21:00', title: '保研经验分享会', type: 'lecture', place: '图书馆 报告厅',
      credit: 0.15, capacity: 180, enrolled: 95, dlH: 26, tags: ['学术讲座', '职业发展'], org: '学业发展中心' },

    /* 周三 */
    { d: 2, s: '12:30', e: '13:30', title: '「AI + 公益」志愿者培训', type: 'volunteer', place: '大学生活动中心 302',
      volunteerHours: 1, capacity: 80, enrolled: 60, dlH: 8, tags: ['志愿服务'], org: '青年志愿者协会' },
    { d: 2, s: '14:00', e: '16:00', title: '图书馆志愿服务 · 书目整理', type: 'volunteer', place: '图书馆 三层',
      volunteerHours: 2, capacity: 20, enrolled: 14, dlH: 10, tags: ['志愿服务'], org: '图书馆' },
    { d: 2, s: '18:30', e: '20:30', title: '分享会 · 无障碍设计怎么做', type: 'lecture', place: '第三教学楼 108',
      credit: 0.2, capacity: 100, enrolled: 43, dlH: 40, tags: ['学术讲座', '文体艺术'], org: '工业设计系' },
    { d: 2, s: '20:45', e: '21:30', title: '阳光乐跑', type: 'sports', place: '东田径场',
      runKm: 3, capacity: null, enrolled: 0, dlH: 48, tags: ['体育运动'], org: '体育教学部' },

    /* 周四 */
    { d: 3, s: '15:00', e: '16:30', title: '心理健康讲座 · 与情绪共处', type: 'lecture', place: '大学生活动中心 报告厅',
      credit: 0.1, capacity: 200, enrolled: 88, dlH: 30, tags: ['学术讲座'], org: '心理健康教育中心' },
    { d: 3, s: '18:30', e: '20:00', title: '「挑战杯」竞赛宣讲会', type: 'competition', place: '科技馆 报告厅',
      credit: 0.25, capacity: 150, enrolled: 132, dlH: 5, tags: ['创新创业'], org: '校团委' },
    { d: 3, s: '19:00', e: '21:00', title: 'AI 编程实战训练营', type: 'practice', place: '第三教学楼 401',
      credit: 0.3, capacity: 50, enrolled: 50, dlH: 22, tags: ['技术编程'], org: '学生科技协会' },
    { d: 3, s: '20:30', e: '21:30', title: '阳光乐跑', type: 'sports', place: '东田径场',
      runKm: 3, capacity: null, enrolled: 0, dlH: 48, tags: ['体育运动'], org: '体育教学部' },

    /* 周五 */
    { d: 4, s: '12:30', e: '13:30', title: '志愿服务 · 迎新引导岗前培训', type: 'volunteer', place: '大学生活动中心 301',
      volunteerHours: 1, capacity: 60, enrolled: 35, dlH: 16, tags: ['志愿服务'], org: '青年志愿者协会' },
    { d: 4, s: '14:00', e: '16:00', title: '数学建模协会 · 经验分享', type: 'lecture', place: '第三教学楼 210',
      credit: 0.15, capacity: 120, enrolled: 70, dlH: 44, tags: ['学术讲座', '创新创业'], org: '理学院' },
    { d: 4, s: '19:00', e: '20:30', title: '「非遗进校园」杭绣手作体验', type: 'art', place: '艺术楼 203',
      credit: 0.3, capacity: 40, enrolled: 38, dlH: 3, tags: ['文体艺术'], org: '艺术教育中心' },
    { d: 4, s: '20:00', e: '21:00', title: '阳光乐跑', type: 'sports', place: '东田径场',
      runKm: 3, capacity: null, enrolled: 0, dlH: 48, tags: ['体育运动'], org: '体育教学部' },

    /* 周六 */
    { d: 5, s: '08:30', e: '12:30', title: '大型赛事志愿服务 · 观众引导', type: 'volunteer', place: '校外 · 奥体中心',
      volunteerHours: 4, capacity: 30, enrolled: 28, dlH: 24, tags: ['志愿服务'], org: '校青年志愿者协会' },
    { d: 5, s: '14:00', e: '17:00', title: '义务维修队 · 小家电维修', type: 'volunteer', place: '学生社区 中心广场',
      volunteerHours: 3, capacity: 25, enrolled: 11, dlH: 40, tags: ['志愿服务'], org: '电子学院青协' },
    { d: 5, s: '15:00', e: '16:30', title: '「城市记忆」摄影展导览', type: 'art', place: '艺术楼 展厅',
      credit: 0.1, capacity: 60, enrolled: 22, dlH: 46, tags: ['文体艺术'], org: '摄影协会' },
    { d: 5, s: '19:00', e: '21:00', title: '校园歌手大赛 · 初赛', type: 'art', place: '大礼堂',
      credit: 0.2, capacity: 500, enrolled: 410, dlH: 28, tags: ['文体艺术'], org: '校团委' },

    /* 周日 */
    { d: 6, s: '09:00', e: '11:00', title: '敬老院陪伴志愿服务', type: 'volunteer', place: '校外 · 拱墅区福利院',
      volunteerHours: 2, capacity: 20, enrolled: 19, dlH: 18, tags: ['志愿服务'], org: '青年志愿者协会' },
    { d: 6, s: '14:00', e: '16:00', title: '创新创业训练营（第一期）', type: 'practice', place: '科技馆 创客空间',
      credit: 0.4, capacity: 80, enrolled: 45, dlH: 36, tags: ['创新创业', '技术编程'], org: '创业学院' },
    { d: 6, s: '15:00', e: '16:30', title: '简历门诊（周日场）', type: 'career', place: '就业指导中心 202',
      credit: 0.1, capacity: 40, enrolled: 9, dlH: 34, tags: ['职业发展'], org: '就业指导中心' },
    { d: 6, s: '18:00', e: '18:45', title: '阳光乐跑', type: 'sports', place: '东田径场',
      runKm: 3, capacity: null, enrolled: 0, dlH: 48, tags: ['体育运动'], org: '体育教学部' },

    /* 周二、周六也开放 —— 乐跑 7:00–21:00 每天都能跑 */
    { d: 1, s: '20:00', e: '20:45', title: '阳光乐跑', type: 'sports', place: '东田径场',
      runKm: 3, capacity: null, enrolled: 0, dlH: 48, tags: ['体育运动'], org: '体育教学部' },
    { d: 5, s: '10:00', e: '10:45', title: '阳光乐跑', type: 'sports', place: '西区副馆南侧跑道',
      runKm: 3, capacity: null, enrolled: 0, dlH: 48, tags: ['体育运动'], org: '体育教学部' }
  ];

  var uid = 0;
  var cid = 0;

  function buildEvents() {
    var now = Date.now();
    return RAW.map(function (r, i) {
      var dt = addDays(state.weekStart, r.d);
      return {
        id: 'e' + (++uid),
        d: r.d,
        date: ymd(dt),
        title: r.title,
        type: TYPES[r.type] ? r.type : 'lecture',
        place: r.place,
        start: r.s,
        end: r.e,
        credit: r.credit || 0,
        volunteerHours: r.volunteerHours || 0,
        runKm: r.runKm ? runKmOf() : 0,
        capacity: (r.capacity === null || r.capacity === undefined) ? Infinity : r.capacity,
        flex: (r.runKm || 0) > 0,
        enrolled: r.enrolled || 0,
        deadline: (r.dlH === null || r.dlH === undefined) ? null : new Date(now + r.dlH * 3600 * 1000),
        tags: r.tags || [],
        org: r.org || '',
        source: 'builtin'
      };
    });
  }

  /* ---------------- 冲突与可用性 ---------------- */

  function isOpen(e) {
    if (e.deadline && e.deadline.getTime() < Date.now()) return 'deadline';
    if (e.enrolled >= e.capacity) return 'full';
    return null;
  }

  function busyHit(e) {
    var s = toMin(e.start), en = toMin(e.end);
    var names = ['am', 'pm', 'eve'];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (!isBusy(e.d, n)) continue;
      var w = SLOTS[n];
      if (s < w[1] && w[0] < en) return n;
    }
    return null;
  }

  function overlap(a, b) {
    return toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
  }

  function gapBetween(a, b) {
    // 两场活动不重叠时，返回时间间隔（分钟）
    if (toMin(a.start) >= toMin(b.end)) return toMin(a.start) - toMin(b.end);
    if (toMin(b.start) >= toMin(a.end)) return toMin(b.start) - toMin(a.end);
    return -1;
  }

  function clash(e, list) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.d !== e.d) continue;
      if (overlap(e, o)) return { kind: 'time', other: o };
      var g = gapBetween(e, o);
      var need = travelMin(e.place, o.place);
      if (g >= 0 && g < need) return { kind: 'travel', other: o, gap: g, need: need };
    }
    return null;
  }

  /* ---------------- 打分 ---------------- */

  function produces(e, kind) {
    if (kind === 'credit') return e.credit > 0;
    if (kind === 'volunteer') return e.volunteerHours > 0;
    if (kind === 'run') return e.runKm > 0;
    return false;
  }

  // 问卷侧写：一个人偏什么，就往上加多少
  function profileScore(e) {
    var p = state.profile;
    if (!p.done) return 0.5;                       // 没做过问卷，一律中性

    var s = 0;

    var tagHit = 0;
    for (var i = 0; i < e.tags.length; i++) {
      if (p.tags.indexOf(e.tags[i]) !== -1) tagHit++;
    }
    if (tagHit) s += 0.55;

    if (p.weekend && e.d >= 5) s += 0.25;
    else if (p.slots.indexOf(slotOf(e.start)) !== -1) s += 0.25;

    if (toMin(e.end) - toMin(e.start) <= p.maxDuration) s += 0.10;

    var tagStr = e.tags.join(',');
    if (p.motivation === 'credit' && e.credit > 0) s += 0.10;
    if (p.motivation === 'skill' && /技术编程|创新创业/.test(tagStr)) s += 0.10;
    if (p.motivation === 'resume' && /职业发展|创新创业/.test(tagStr)) s += 0.10;
    if (p.motivation === 'fun' && /文体艺术/.test(tagStr)) s += 0.10;
    if (p.motivation === 'help' && /志愿服务/.test(tagStr)) s += 0.10;

    return clamp(s, 0, 1);
  }

  function scoreOf(e, need, typeCount) {
    var parts = {};

    // ① 缺口匹配：这场活动能补掉剩余缺口的多少
    var gap = 0;
    if (need.credit > 0.001 && e.credit > 0) gap = Math.max(gap, e.credit / need.credit);
    if (need.volunteer > 0.001 && e.volunteerHours > 0) gap = Math.max(gap, e.volunteerHours / need.volunteer);
    if (need.run > 0.001 && e.runKm > 0) gap = Math.max(gap, 1 / need.run);
    parts.gap = clamp(gap, 0, 1);

    // ② 兴趣命中
    var hits = 0, k;
    for (k = 0; k < e.tags.length; k++) if (state.interests.indexOf(e.tags[k]) !== -1) hits++;
    parts.interest = Math.min(1, hits * 0.6);

    // ③ 问卷侧写命中（权重最高的一档，因为这是用户亲口说的）
    parts.profile = profileScore(e);

    // ④ 稀缺度
    var fill = isFinite(e.capacity) ? e.enrolled / e.capacity : 0.3;
    var scarce = fill >= 0.9 ? 1 : fill >= 0.7 ? 0.72 : fill >= 0.4 ? 0.45 : 0.25;
    if (e.deadline) {
      var hLeft = (e.deadline.getTime() - Date.now()) / 3600000;
      if (hLeft <= 8) scarce = Math.min(1, scarce + 0.18);
    }
    parts.scarce = scarce;

    // ⑤ 时段友好度
    var s = toMin(e.start), en = toMin(e.end);
    var t = 1;
    if (s >= 690 && s < 810) t -= 0.45;   // 11:30 - 13:30 饭点
    if (s < 510) t -= 0.30;               // 8:30 之前
    if (en > 1290) t -= 0.20;             // 21:30 之后结束
    if (e.d >= 5 && s < 570) t -= 0.25;   // 周末太早
    parts.time = clamp(t, 0.2, 1);

    // ⑥ 类型多样性
    var c = typeCount[e.type] || 0;
    parts.fresh = clamp(1 - c * 0.4, 0.2, 1);

    // ⑦ 稳定性
    parts.kept = state.chosenIds.indexOf(e.id) !== -1 ? 1 : 0;

    var total = parts.gap * 0.24 + parts.interest * 0.16 + parts.profile * 0.22 +
                parts.scarce * 0.12 + parts.time * 0.12 + parts.fresh * 0.08 + parts.kept * 0.06;
    return { total: Math.round(total * 100), parts: parts };
  }

  /* ---------------- 排程 ---------------- */

  /* ---------------- 历史进度（导入的二课 / 志愿） ---------------- */
  function histSum(kind) {
    var sum = 0;
    (state.history || []).forEach(function (x) {
      sum += (kind === 'credit') ? (Number(x.credit) || 0) : (Number(x.hours) || 0);
    });
    return sum;
  }

  function computeNeed() {
    // 目标减掉已经导入的历史，就只剩真正要补的缺口
    return {
      credit: Math.max(0, state.goals.credit - histSum('credit')),
      volunteer: Math.max(0, state.goals.volunteer - histSum('volunteer')),
      run: state.goals.run
    };
  }

  // 系统推荐：只算「如果让我挑会挑哪些」，不直接写进日程
  function recommend() {
    var need = computeNeed();
    var selected = [];
    var typeCount = {};
    var seen = {};

    var usable = [];

    state.events.forEach(function (e) {
      if (isOpen(e) || busyHit(e)) { seen[e.id] = 1; return; }
      usable.push(e);
    });

    function tryAdd(e) {
      var c = clash(e, selected);
      if (c) return { ok: false };

      var sameDay = selected.filter(function (x) { return x.d === e.d; });
      if (sameDay.length >= state.maxPerDay) return { ok: false };
      var usedMin = sameDay.reduce(function (sum, x) {
        return sum + (toMin(x.end) - toMin(x.start));
      }, 0);
      if (usedMin + (toMin(e.end) - toMin(e.start)) > 360) return { ok: false };

      return { ok: true };
    }

    function accept(e) {
      selected.push(e);
      typeCount[e.type] = (typeCount[e.type] || 0) + 1;
    }

    var UNIT_HINT = { credit: 0.5, volunteer: 3, run: 2 };
    var order = ['credit', 'volunteer', 'run'].sort(function (a, b) {
      return (need[b] / UNIT_HINT[b]) - (need[a] / UNIT_HINT[a]);
    });

    order.forEach(function (kind) {
      var guard = 0;
      while (need[kind] > 0.001 && guard++ < 12) {
        var cands = usable.filter(function (e) {
          return produces(e, kind) && selected.indexOf(e) === -1;
        });
        if (!cands.length) break;

        cands.sort(function (a, b) {
          return scoreOf(b, need, typeCount).total - scoreOf(a, need, typeCount).total;
        });

        var added = false;
        for (var i = 0; i < cands.length; i++) {
          var e = cands[i];
          if (tryAdd(e).ok) {
            accept(e);
            need.credit = Math.max(0, need.credit - e.credit);
            need.volunteer = Math.max(0, need.volunteer - e.volunteerHours);
            need.run = Math.max(0, need.run - (e.runKm > 0 ? 1 : 0));
            added = true;
            break;
          }
          seen[e.id] = 1;
        }
        if (!added) break;
      }
    });

    usable
      .filter(function (e) { return selected.indexOf(e) === -1; })
      .sort(function (a, b) {
        return scoreOf(b, need, typeCount).total - scoreOf(a, need, typeCount).total;
      })
      .forEach(function (e) {
        if (tryAdd(e).ok) accept(e);
      });

    return { ids: selected.map(function (e) { return e.id; }) };
  }

  // 弹性活动（阳光乐跑）在 07:00–21:00 里找一个空档塞进去
  var FLEX_FROM = 420;    // 07:00
  var FLEX_TO = 1260;     // 21:00

  // 每次乐跑占多久，用户自己定（含路上时间），默认 30 分钟
  function runLen() {
    var n = state.run && state.run.len;
    return (n >= 15 && n <= 120) ? n : 30;
  }

  function freeSlot(d, selected, dur) {
    var blocks = [];
    activeCourses().forEach(function (c) {
      if (c.d === d) blocks.push([toMin(c.start), toMin(c.end)]);
    });
    selected.forEach(function (x) {
      if (x.d === d) blocks.push([toMin(x.start), toMin(x.end)]);
    });
    blocks.sort(function (p, q) { return p[0] - q[0]; });

    var cur = FLEX_FROM;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b[0] - cur >= dur) return [cur, cur + dur];
      if (b[1] > cur) cur = b[1];
      if (cur > FLEX_TO) break;
    }
    if (FLEX_TO - cur >= dur) return [cur, cur + dur];
    return null;
  }

  function copyEvent(e, slot) {
    return {
      id: e.id, d: e.d, date: e.date, title: e.title, type: e.type, place: e.place,
      start: minsToHHMM(slot[0]), end: minsToHHMM(slot[1]),
      credit: e.credit, volunteerHours: e.volunteerHours, runKm: e.runKm,
      capacity: e.capacity, enrolled: e.enrolled, deadline: e.deadline,
      tags: e.tags, org: e.org, flex: true, _placed: true
    };
  }

  // 真正决定日程的是「用户勾了什么」——
  // 这里只做校验：撞课的、排不下的，进「没排进去」并说明原因。
  function rebuild() {
    var selected = [];
    var rejected = [];

    var chosen = state.events.filter(function (e) {
      return state.chosenIds.indexOf(e.id) !== -1;
    });

    chosen.sort(function (a, b) {
      return a.d - b.d || toMin(a.start) - toMin(b.start);
    });

    chosen.forEach(function (e) {
      var why = isOpen(e);
      if (why) { rejected.push({ e: e, why: why }); return; }

      // 阳光乐跑：07:00–21:00 之间找空档，不占用固定时间
      if (e.flex) {
        var slot = freeSlot(e.d, selected, runLen());
        if (!slot) { rejected.push({ e: e, why: 'noroom' }); return; }
        selected.push(copyEvent(e, slot));
        return;
      }

      if (busyHit(e)) { rejected.push({ e: e, why: 'busy' }); return; }

      var c = clash(e, selected);
      if (c) { rejected.push({ e: e, why: c.kind, other: c.other, gap: c.gap, need: c.need }); return; }

      var sameDay = selected.filter(function (x) { return x.d === e.d; });
      if (sameDay.length >= state.maxPerDay) { rejected.push({ e: e, why: 'dense' }); return; }

      var usedMin = sameDay.reduce(function (sum, x) {
        return sum + (toMin(x.end) - toMin(x.start));
      }, 0);
      if (usedMin + (toMin(e.end) - toMin(e.start)) > 360) { rejected.push({ e: e, why: 'dense' }); return; }

      selected.push(e);
    });

    state.schedule = selected;
    state.rejected = rejected;
  }

  // 给所有活动算一遍分，列表展示用
  function scoreAll() {
    var need = computeNeed();
    state.schedule.forEach(function (e) {
      need.credit = Math.max(0, need.credit - e.credit);
      need.volunteer = Math.max(0, need.volunteer - e.volunteerHours);
      need.run = Math.max(0, need.run - (e.runKm > 0 ? 1 : 0));
    });
    var tc = {};
    state.events.forEach(function (e) {
      e._score = scoreOf(e, need, tc);
    });
  }

  // 某个活动如果现在勾上，会是什么状态
  function pickStatus(e) {
    var closed = isOpen(e);
    if (closed) return { kind: closed };

    // 阳光乐跑是弹性的：只要 07:00–21:00 还塞得下就行
    if (e.flex) {
      return freeSlot(e.d, state.schedule, runLen()) ? null : { kind: 'dense' };
    }

    if (busyHit(e)) return { kind: 'busy' };

    var others = state.schedule.filter(function (x) { return x.id !== e.id; });
    var c = clash(e, others);
    if (c) return c;

    var sameDay = others.filter(function (x) { return x.d === e.d; });
    if (sameDay.length >= state.maxPerDay) return { kind: 'dense' };
    var usedMin = sameDay.reduce(function (sum, x) {
      return sum + (toMin(x.end) - toMin(x.start));
    }, 0);
    if (usedMin + (toMin(e.end) - toMin(e.start)) > 360) return { kind: 'dense' };

    return null;
  }
  /* ---------------- 渲染：目标条 ---------------- */

  var RING_R = 18;
  var RING_C = 2 * Math.PI * RING_R;   // ≈113.1

  function renderGoals() {
    // 已得 = 导入的历史 + 本周已排
    var got = { credit: histSum('credit'), volunteer: histSum('volunteer'), run: 0 };
    state.schedule.forEach(function (e) {
      got.credit += e.credit;
      got.volunteer += e.volunteerHours;
      if (e.runKm > 0) got.run += 1;
    });

    var defs = [
      { key: 'credit', name: '第二课堂学分', unit: '分', fmt: fmt1 },
      { key: 'volunteer', name: '志愿时长', unit: '小时', fmt: fmt0 },
      { key: 'run', name: '本周计划跑', unit: '天', fmt: fmt0 }
    ];

    var html = defs.map(function (d) {
      var target = state.goals[d.key];
      var cur = got[d.key];
      var ratio = target > 0 ? clamp(cur / target, 0, 1) : (cur > 0 ? 1 : 0);
      var done = target > 0 && cur >= target - 1e-6;
      var off = (RING_C * (1 - ratio)).toFixed(1);

      var foot;
      if (target <= 0) foot = '未设置目标';
      else if (done) foot = '已达成' + (cur > target ? '，超出 ' + d.fmt(cur - target) + ' ' + d.unit : '');
      else foot = '还差 ' + d.fmt(target - cur) + ' ' + d.unit;
      if (d.key === 'run') foot += done ? '（一天多跑只算 1 天）' : '（一天多跑只算 1 天）';

      return '<div class="goal' + (done ? ' is-done' : '') + '">' +
        '<div class="ring">' +
          '<svg viewBox="0 0 44 44" aria-hidden="true">' +
            '<circle class="rb" cx="22" cy="22" r="' + RING_R + '"/>' +
            '<circle class="rf" cx="22" cy="22" r="' + RING_R + '" ' +
              'stroke-dasharray="' + RING_C.toFixed(1) + '" stroke-dashoffset="' + off + '"/>' +
          '</svg>' +
          '<span class="rv">' + (done ? '✓' : Math.round(ratio * 100) + '<i>%</i>') + '</span>' +
        '</div>' +
        '<div class="gbody">' +
          '<span class="goal-name">' + d.name + '</span>' +
          '<span class="goal-val' + (done ? ' done' : '') + '">' + d.fmt(cur) +
            '<s> / ' + d.fmt(target) + ' ' + d.unit + '</s></span>' +
          '<span class="goal-foot">' + foot + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    document.getElementById('goals').innerHTML = html;
  }

  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function fmt0(n) { return String(Math.round(n)); }

  /* ---------------- 渲染：图例 ---------------- */

  function renderLegend() {
    var html = Object.keys(TYPES).map(function (k) {
      var t = TYPES[k];
      return '<span class="lg"><i style="background:' + typeColor(t) + '"></i>' + t.label + '</span>';
    }).join('');
    document.getElementById('legend').innerHTML = html;
  }

  /* ---------------- 渲染：日期条 + 单日议程 ---------------- */

  function minsToHHMM(m) {
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  // 一天里要显示的东西：课 + 活动，按时间排
  function dayEntries(d) {
    var out = [];
    var covered = [];

    activeCourses().forEach(function (c) {
      if (c.d !== d) return;
      out.push({ kind: 'course', start: c.start, end: c.end, title: c.title, place: c.place });
      covered.push([toMin(c.start), toMin(c.end)]);
    });

    // 只勾了时段、没有具体课程记录的，补一条占位，保证「有课」看得见
    ['am', 'pm', 'eve'].forEach(function (slot) {
      if (!isBusy(d, slot)) return;
      var w = SLOTS[slot];
      var hit = covered.some(function (r) { return r[0] < w[1] && w[0] < r[1]; });
      if (hit) return;
      out.push({
        kind: 'course',
        start: minsToHHMM(w[0]),
        end: minsToHHMM(w[1]),
        title: SLOT_LABEL[slot] + '有课',
        place: ''
      });
    });

    state.schedule.forEach(function (e) {
      if (e.d !== d) return;
      out.push({ kind: 'activity', e: e, start: e.start, end: e.end });
    });

    out.sort(function (a, b) {
      var diff = toMin(a.start) - toMin(b.start);
      if (diff) return diff;
      return a.kind === 'course' ? -1 : 1;
    });

    return out;
  }

  function renderDayStrip() {
    var el = document.getElementById('daystrip');
    if (!el) return;

    var a = state.weekStart;
    var b = addDays(a, 6);
    var rangeEl = document.getElementById('weekRange');
    if (rangeEl) {
      rangeEl.textContent = (a.getMonth() + 1) + '/' + a.getDate() + ' – ' + (b.getMonth() + 1) + '/' + b.getDate();
    }

    var todayStr = ymd(new Date());
    var html = '';

    for (var i = 0; i < 7; i++) {
      var dt = addDays(a, i);
      var n = dayEntries(i).length;
      var cls = 'dchip';
      if (i === state.activeDay) cls += ' active';
      if (i >= 5) cls += ' weekend';
      if (ymd(dt) === todayStr) cls += ' today';

      html += '<button type="button" class="' + cls + '" data-d="' + i + '">' +
                '<span class="dw">' + WD[i] + '</span>' +
                '<b class="dd">' + dt.getDate() + '</b>' +
                '<i class="dc">' + (n || '·') + '</i>' +
              '</button>';
    }

    el.innerHTML = html;
  }

  function renderAgenda() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var el = document.getElementById('agenda');
    if (!el) return;

    var d = state.activeDay;
    var entries = dayEntries(d);

    if (!entries.length) {
      var dt0 = addDays(state.weekStart, d);
      var quips = ['这天空着，正好歇会儿', '没有任何安排，很难得', '空白页 —— 去干点别的吧'];
      var qi = (d + dt0.getDate()) % quips.length;
      el.innerHTML = '<div class="ag-empty"><b>☁</b>' +
        WD[d] + ' ' + (dt0.getMonth() + 1) + '/' + dt0.getDate() + ' · ' + quips[qi] +
        '</div>';
      return;
    }

    var prevAct = null;
    var html = '';

    entries.forEach(function (item) {
      if (item.kind === 'course') {
        html += '<div class="ag course" style="--c:' + (dark ? '#7C869C' : '#9AA3B6') +
                     ';--bgc:' + (dark ? '#191E28' : '#F3F5FA') + '">' +
                  '<div class="ag-time"><b>' + esc(item.start) + '</b><span>' + esc(item.end) + '</span></div>' +
                  '<div class="ag-line"><i></i></div>' +
                  '<div class="ag-body">' +
                    '<div class="ag-top">' +
                      '<span class="ag-tag">课</span>' +
                      '<span class="ag-dur">' + fmtGap(toMin(item.end) - toMin(item.start)) + '</span>' +
                    '</div>' +
                    '<div class="ag-title">' + esc(item.title) + '</div>' +
                    (item.place ? '<div class="ag-meta">' + esc(item.place) + '</div>' : '') +
                  '</div>' +
                '</div>';
        return;
      }

      var e = item.e;
      var t = TYPES[e.type];
      var rs = reasonsFor(e, prevAct);
      var isFlex = !!e.flex || e.runKm > 0;
      var bits = [];
      if (!isFlex && e.place) bits.push(esc(e.place));
      if (isFlex) bits.push('07:00–21:00 之间随时可跑');
      if (e.credit > 0) bits.push('二课 <b>' + fmt1(e.credit) + '</b> 分');
      if (e.volunteerHours > 0) bits.push('志愿 <b>' + fmt0(e.volunteerHours) + '</b> 小时');
      if (e.runKm > 0) bits.push('跑 <b>' + fmt1(e.runKm) + '</b> km');
      if (!isFlex && isFinite(e.capacity)) bits.push('余 <b>' + (e.capacity - e.enrolled) + '</b>/' + e.capacity);

      html += '<div class="ag activity" style="--c:' + typeColor(t) + ';--bgc:' + typeBg(t) + '">' +
                '<div class="ag-time"><b>' + esc(e.start) + '</b><span>' + esc(e.end) + '</span></div>' +
                '<div class="ag-line"><i></i></div>' +
                '<div class="ag-body">' +
                  '<div class="ag-top">' +
                    '<span class="ag-tag">' + t.label + '</span>' +
                    (isFlex ? '<span class="ag-tag ag-flex">随时</span>' : '') +
                    '<span class="ag-dur">' + fmtGap(toMin(e.end) - toMin(e.start)) + '</span>' +
                  '</div>' +
                  '<div class="ag-title">' + esc(e.title) + '</div>' +
                  '<div class="ag-meta">' + bits.join(' · ') + '</div>' +
                  (rs.length ? '<div class="ag-why">' + rs.map(function (x) {
                    return '<span>' + x + '</span>';
                  }).join('') + '</div>' : '') +
                  scoreBars(e) +
                  '<div class="ag-more"><button type="button" class="btn-score">打分依据 ▾</button></div>' +
                '</div>' +
              '</div>';

      prevAct = e;
    });

    el.innerHTML = html;
  }

  /* ---------------- 渲染：推荐理由 ---------------- */

  function reasonsFor(e, prev) {
    var rs = [];

    if (e.credit > 0) rs.push('补二课学分 <b>' + fmt1(e.credit) + '</b>');
    if (e.volunteerHours > 0) rs.push('补志愿时长 <b>' + fmt0(e.volunteerHours) + 'h</b>');
    if (e.runKm > 0) rs.push('计入阳光乐跑 <b>' + fmt1(e.runKm) + 'km</b>');

    var hits = e.tags.filter(function (t) { return state.interests.indexOf(t) !== -1; });
    if (hits.length) rs.push('命中兴趣「<b>' + hits.join('、') + '</b>」');

    if (isFinite(e.capacity)) {
      var fill = e.enrolled / e.capacity;
      var left = e.capacity - e.enrolled;
      if (fill >= 0.9) rs.push('<b>仅剩 ' + left + ' 席</b>');
      else if (fill < 0.4) rs.push('名额宽松，无需抢');
    }

    if (prev) {
      var g = gapBetween(e, prev);
      // 只有间隔在 2 小时内，"转场来得及"才是一条有价值的信息
      if (g >= 0 && g <= 120) {
        rs.push('与上一场间隔 <b>' + g + ' 分钟</b>，步行约 ' + travelMin(e.place, prev.place) + ' 分钟');
      }
    }

    return rs;
  }

  var SCORE_LABEL = {
    gap: '缺口匹配',
    interest: '兴趣命中',
    scarce: '稀缺度',
    time: '时段友好',
    fresh: '类型多样',
    kept: '保持稳定'
  };

  function scoreBars(e) {
    if (!e._score) return '';
    var p = e._score.parts;
    var rows = Object.keys(SCORE_LABEL).map(function (k) {
      var v = Math.round(p[k] * 100);
      return '<div class="sc"><span>' + SCORE_LABEL[k] + '</span>' +
             '<span class="sb"><i style="width:' + v + '%"></i></span>' +
             '<span class="sv">' + v + '</span></div>';
    }).join('');
    return '<div class="scores hide">' + rows + '</div>';
  }

  /* ---------------- 渲染：未采纳 ---------------- */

  function renderRejected() {
    var list = state.rejected.slice();
    var countEl = document.getElementById('rejectCount');

    // 排序：先按天，再按时间
    list.sort(function (x, y) {
      return x.e.d - y.e.d || toMin(x.e.start) - toMin(y.e.start);
    });

    if (countEl) countEl.textContent = list.length ? list.length + ' 条' : '';

    if (!list.length) {
      document.getElementById('rejected').innerHTML =
        '<div class="ag-empty">所有活动都排得下 —— 这周挺闲。</div>';
      return;
    }

    var html = list.map(function (r) {
      var e = r.e;
      var when = WD[e.d] + ' ' + e.start;
      var why = REASON_TEXT[r.why] || r.why;
      var extra = '';
      if (r.other) extra = '（' + esc(r.other.title) + '）';
      if (r.why === 'travel' && r.need) extra = '（间隔 ' + r.gap + ' 分钟 / 需 ' + r.need + ' 分钟，与「' + esc(r.other.title) + '」）';

      return '<div class="rej">' +
               '<span class="rej-time">' + when + '</span>' +
               '<span class="rej-title">' + esc(e.title) + '</span>' +
               '<span class="rej-why why-' + r.why + '">' + why + extra + '</span>' +
             '</div>';
    }).join('');

    document.getElementById('rejected').innerHTML = html;
  }

  /* ---------------- 渲染：面板 ---------------- */

  function renderPanel() {
    document.getElementById('interestChips').innerHTML = INTERESTS.map(function (t) {
      var on = state.interests.indexOf(t) !== -1;
      return '<button type="button" class="chip" data-interest="' + esc(t) + '" aria-pressed="' + on + '">' + esc(t) + '</button>';
    }).join('');

    var html = '<div class="bg-corner"></div>';
    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (x) {
      html += '<div class="bg-hd">' + x + '</div>';
    });
    [['am', '上午'], ['pm', '下午'], ['eve', '晚上']].forEach(function (row) {
      html += '<div class="bg-rt">' + row[1] + '</div>';
      for (var d = 0; d < 7; d++) {
        html += '<button type="button" class="cell" data-d="' + d + '" data-slot="' + row[0] + '"' +
                ' aria-pressed="' + isBusy(d, row[0]) + '" aria-label="周' + (d + 1) + ' ' + row[1] + '"></button>';
      }
    });
    document.getElementById('busyGrid').innerHTML = html;

    var mp = document.getElementById('maxPerDay');
    if (mp) mp.value = state.maxPerDay;
    var mpv = document.getElementById('maxPerDayVal');
    if (mpv) mpv.textContent = state.maxPerDay;
    document.getElementById('goalCredit').value = state.goals.credit;
    document.getElementById('goalVolunteer').value = state.goals.volunteer;
    document.getElementById('goalRun').value = state.goals.run;
  }

  /* ---------------- 总渲染 ---------------- */

  /* ---------------- 周次：单双周 / 自定义区间 ---------------- */

  function courseWeeks(c) {
    var w = c.weeks || {};
    var from = parseInt(w.from, 10), to = parseInt(w.to, 10);
    if (!(from >= 1)) from = 1;
    if (!(to >= from)) to = 30;
    return { from: from, to: to, parity: (w.parity === 'odd' || w.parity === 'even') ? w.parity : 'all' };
  }

  // 这门课在第 week 周上不上
  function courseActive(c, week) {
    if (!week) week = termWeek();
    if (!week) return true;                       // 没设开学日，就当全都要上
    var w = courseWeeks(c);
    if (week < w.from || week > w.to) return false;
    if (w.parity === 'odd' && week % 2 === 0) return false;
    if (w.parity === 'even' && week % 2 === 1) return false;
    return true;
  }

  function activeCourses() {
    var wk = termWeek();
    return state.courses.filter(function (c) { return courseActive(c, wk); });
  }

  function courseWeekText(c) {
    var w = courseWeeks(c);
    var p = w.parity === 'odd' ? '单周' : (w.parity === 'even' ? '双周' : '');
    if (w.from === 1 && w.to === 30 && !p) return '每周';
    if (w.from === 1 && w.to === 16 && !p) return '1-16 周';
    return (p ? p + ' ' : '') + w.from + '-' + w.to + ' 周';
  }

  // 「1-16」「1-8,10-16」「1-16 单周」都能读
  function parseWeeks(str, parityHint) {
    var s = String(str || '').trim();
    var parity = 'all';
    if (parityHint === 'odd' || parityHint === 'even') parity = parityHint;
    if (/单/.test(s)) parity = 'odd';
    else if (/双/.test(s)) parity = 'even';

    var nums = (s.match(/\d+/g) || []).map(function (x) { return parseInt(x, 10); });
    var from = 1, to = 16;
    if (nums.length >= 2) { from = Math.min.apply(null, nums); to = Math.max.apply(null, nums); }
    else if (nums.length === 1) { from = 1; to = nums[0]; }
    if (!(from >= 1)) from = 1;
    if (to > 30) to = 30;
    if (to < from) to = from;
    return { from: from, to: to, parity: parity };
  }

  /* ---------------- 课程表编辑器 ---------------- */

  var editingCourse = null;

  function openCourseEditor() {
    editingCourse = null;
    fillCourseForm(null);
    renderCourseList();
    document.getElementById('modalCourse').hidden = false;
  }

  function fillCourseForm(c) {
    document.getElementById('cfTitle').value = c ? c.title : '';
    document.getElementById('cfDay').value = String(c ? c.d : 0);
    document.getElementById('cfStart').value = c ? c.start : '08:40';
    document.getElementById('cfEnd').value = c ? c.end : '10:15';
    document.getElementById('cfPlace').value = c ? (c.place || '') : '';
    var w = courseWeeks(c || {});
    document.getElementById('cfFrom').value = c ? w.from : 1;
    document.getElementById('cfTo').value = c ? w.to : 16;
    document.getElementById('cfParity').value = c ? w.parity : 'all';
    document.getElementById('cfSave').textContent = c ? '保存修改' : '加入';
    document.getElementById('cfCancel').hidden = !c;
    editingCourse = c ? c.id : null;
  }

  function renderCourseList() {
    var el = document.getElementById('courseList');
    var hint = document.getElementById('courseHint');
    if (!el) return;

    var wk = termWeek();
    var rows = state.courses.slice().sort(function (p, q) {
      if (p.d !== q.d) return p.d - q.d;
      return toMin(p.start) - toMin(q.start);
    });

    if (!rows.length) {
      el.innerHTML = '<div class="cempty">还没有课程。上面填一门，或者在「数据」页导入课表。</div>';
    } else {
      el.innerHTML = rows.map(function (c) {
        var on = courseActive(c, wk);
        return '<div class="crow' + (on ? '' : ' is-off') + '">' +
                 '<span class="cday">' + WD[c.d] + '</span>' +
                 '<span class="ctime">' + c.start + '–' + c.end + '</span>' +
                 '<span class="cname">' + esc(c.title) + '</span>' +
                 '<span class="cweek">' + courseWeekText(c) + '</span>' +
                 '<span class="cplace">' + esc(c.place || '') + '</span>' +
                 '<button class="link-btn cedit" type="button" data-cedit="' + c.id + '">改</button>' +
                 '<button class="link-btn cdel" type="button" data-cdel="' + c.id + '">删</button>' +
               '</div>';
      }).join('');
    }

    if (hint) {
      hint.textContent = rows.length
        ? '共 ' + rows.length + ' 门 · 灰色的这周不上（单双周或不在周次范围里）'
        : '';
    }
  }

  function saveCourseFromForm() {
    var title = document.getElementById('cfTitle').value.trim();
    if (!title) { toast('先填课程名'); return; }
    var start = document.getElementById('cfStart').value || '08:40';
    var end = document.getElementById('cfEnd').value || '10:15';
    if (toMin(end) <= toMin(start)) { toast('下课时间要晚于上课时间'); return; }

    var data = {
      d: parseInt(document.getElementById('cfDay').value, 10) || 0,
      start: start,
      end: end,
      title: title.slice(0, 24),
      place: document.getElementById('cfPlace').value.trim().slice(0, 20),
      weeks: {
        from: parseInt(document.getElementById('cfFrom').value, 10) || 1,
        to: parseInt(document.getElementById('cfTo').value, 10) || 16,
        parity: document.getElementById('cfParity').value
      }
    };
    if (data.weeks.from < 1) data.weeks.from = 1;
    if (data.weeks.to < data.weeks.from) data.weeks.to = data.weeks.from;

    if (editingCourse) {
      state.courses.forEach(function (c) {
        if (c.id === editingCourse) {
          c.d = data.d; c.start = data.start; c.end = data.end;
          c.title = data.title; c.place = data.place; c.weeks = data.weeks;
        }
      });
      toast('改好了');
    } else {
      data.id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 100);
      state.courses.push(data);
      toast('加了一门课');
    }

    // 课表变了，时段格子也要跟着变
    syncBusyFromCourses();
    fillCourseForm(null);
    renderCourseList();
    regenerate();
    persist();
  }

  function removeCourse(id) {
    state.courses = state.courses.filter(function (c) { return c.id !== id; });
    if (editingCourse === id) fillCourseForm(null);
    syncBusyFromCourses();
    renderCourseList();
    regenerate();
    persist();
    toast('删掉了');
  }

  // 依据课程重算「我有事」格子
  function syncBusyFromCourses() {
    state.busy = [];
    state.courses.forEach(function (c) {
      var a0 = toMin(c.start), b0 = toMin(c.end);
      Object.keys(SLOTS).forEach(function (k) {
        var w = SLOTS[k];
        if (a0 < w[1] && w[0] < b0) {
          var key = busyKey(c.d, k);
          if (state.busy.indexOf(key) === -1) state.busy.push(key);
        }
      });
    });
  }

  function renderAll() {
    // 每块单独兜住：一个渲染器出错，不能把整页拖空
    var steps = [
      ['renderGoals', function () { renderGoals(); }],
      ['renderLegend', function () { renderLegend(); }],
      ['renderSources', function () { renderSources(); }],
      ['renderDayStrip', function () { renderDayStrip(); }],
      ['renderAgenda', function () { renderAgenda(); }],
      ['renderTodo', function () { renderTodo(); }],
      ['renderRejected', function () { renderRejected(); }],
      ['renderProfile', function () { renderProfile(); }],
      ['renderPick:course', function () { renderPick('course'); }],
      ['renderPick:volunteer', function () { renderPick('volunteer'); }],
      ['renderPick:run', function () { renderPick('run'); }],
      ['renderSettle', function () { renderSettle(); }],
      ['renderHistory:course', function () { renderHistory('course'); }],
      ['renderHistory:volunteer', function () { renderHistory('volunteer'); }],
      ['renderStats', function () { renderStats(); }],
      ['renderBg', function () { renderBg(); }],
      ['renderAccount', function () { renderAccount(); }],
      ['renderThemeSeg', function () { renderThemeSeg(); }],
      ['renderHero', function () { renderHero(); }],
      ['renderFeatureGrid', function () { renderFeatureGrid(); }],
      ['renderMarquee', function () { renderMarquee(); }],
      ['renderHomeTodo', function () { renderHomeTodo(); }],
      ['renderPosts', function () { renderPosts(); }],
      ['renderTerm', function () { renderTerm(); }],
      ['renderDayNote', function () { renderDayNote(); }],
      ['renderHistSum', function () { renderHistSum(); }],
      ['renderMode', function () { renderMode(); }]
    ];

    for (var i = 0; i < steps.length; i++) {
      try {
        steps[i][1]();
      } catch (err) {
        if (window.console && console.error) {
          console.error('[排得开] ' + steps[i][0] + ' 渲染失败：', err);
        }
      }
    }
  }

  function regenerate() {
    rebuild();
    scoreAll();
    renderAll();
    saveSoon();
  }

  // 勾上一批活动（导入后默认帮你勾好，省得再点一遍）
  function adopt(events) {
    (events || []).forEach(function (e) {
      if (state.chosenIds.indexOf(e.id) === -1) state.chosenIds.push(e.id);
    });
  }

  /* ---------------- Toast ---------------- */

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------------- 通知解析（规则引擎） ---------------- */

  var TYPE_RULES = [
    { type: 'volunteer', re: /志愿|义工|公益|支教|引导|陪伴|服务/ },
    { type: 'sports', re: /跑步|田径|健身|球场|运动会|体测|夜跑/ },
    { type: 'competition', re: /大赛|竞赛|挑战杯|互联网\+|选拔赛|创新创业/ },
    { type: 'career', re: /招聘|简历|就业|实习|职业|面试|宣讲会（企业）/ },
    { type: 'art', re: /演出|音乐会|展览|非遗|歌手|摄影|戏剧|电影|放映|社团/ },
    { type: 'practice', re: /工作坊|训练营|实战|实训|workshop|集训|培训/i },
    { type: 'lecture', re: /讲座|报告|论坛|沙龙|分享会|讲坛/ }
  ];

  var TAG_RULES = [
    { tag: '技术编程', re: /AI|人工智能|大模型|编程|代码|算法|开发|RAG|智能体|计算机/i },
    { tag: '学术讲座', re: /讲座|报告|论坛|沙龙|分享会|讲坛|学术/ },
    { tag: '志愿服务', re: /志愿|义工|公益|服务|引导|陪伴/ },
    { tag: '文体艺术', re: /演出|音乐会|展览|非遗|歌手|摄影|戏剧|电影|书画|合唱|文体/ },
    { tag: '创新创业', re: /创业|创新|大赛|竞赛|挑战杯|项目|孵化/ },
    { tag: '职业发展', re: /招聘|简历|就业|实习|职业|面试|保研|考研/ },
    { tag: '体育运动', re: /跑步|田径|健身|球|运动|体测/ }
  ];

  function detectType(text) {
    for (var i = 0; i < TYPE_RULES.length; i++) {
      if (TYPE_RULES[i].re.test(text)) return TYPE_RULES[i].type;
    }
    return 'lecture';
  }

  function detectTags(text) {
    var tags = [];
    TAG_RULES.forEach(function (r) {
      if (r.re.test(text) && tags.indexOf(r.tag) === -1) tags.push(r.tag);
    });
    return tags;
  }

  function pickTitle(lines) {
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (/^【[^】]*】/.test(L)) return L.replace(/^【[^】]*】\s*/, '').trim() || L;
      if (/《[^》]+》/.test(L)) return L;
    }
    for (var j = 0; j < lines.length; j++) {
      if (/时间|地点|学分|名额|报名/.test(lines[j])) continue;
      if (lines[j].length >= 4 && lines[j].length <= 40) return lines[j];
    }
    return lines[0] || '未命名活动';
  }

  function parseNotice(text) {
    var clean = String(text || '').replace(/\u3000/g, ' ').replace(/\r/g, '');
    var lines = clean.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var res = {
      title: '',
      type: 'lecture',
      d: 1,
      start: '19:00',
      end: '21:00',
      place: '',
      credit: 0,
      volunteerHours: 0,
      runKm: 0,
      capacity: null,
      enrolled: 0,
      tags: [],
      hasTime: false,
      warn: ''
    };

    res.title = pickTitle(lines);
    res.type = detectType(clean);

    // 日期
    var dateHit = null;
    var m = clean.match(/(\d{4})\s*[-\/年]\s*(\d{1,2})\s*[-\/月]\s*(\d{1,2})/);
    if (m) {
      dateHit = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    } else if ((m = clean.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/))) {
      dateHit = new Date(state.weekStart.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }

    var wdHit = clean.match(/周([一二三四五六日天])/);
    var wdIndex = -1;
    if (wdHit) {
      var map = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6 };
      wdIndex = map[wdHit[1]];
    }

    function inWeek(dt) {
      var t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
      var a = state.weekStart.getTime();
      var b = addDays(state.weekStart, 6).getTime();
      return t >= a && t <= b;
    }

    if (dateHit) {
      if (inWeek(dateHit)) {
        res.d = Math.round((new Date(dateHit.getFullYear(), dateHit.getMonth(), dateHit.getDate()).getTime() - state.weekStart.getTime()) / 86400000);
      } else if (wdIndex >= 0) {
        res.d = wdIndex;
        res.warn = '通知里的日期（' + (dateHit.getMonth() + 1) + '/' + dateHit.getDate() + '）不在当前排程周内，已按「周' + wdHit[1] + '」归入本周。';
      } else {
        res.d = wdIndex >= 0 ? wdIndex : 1;
        res.warn = '通知里的日期不在当前排程周内，暂按「周' + '一二三四五六日'[res.d] + '」放入本周，可在下方手动调整。';
      }
    } else if (wdIndex >= 0) {
      res.d = wdIndex;
    }

    // 时间区间 19:00-21:00 / 19:00—21:00 / 19点至21点
    var tm = clean.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-–—~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (tm) {
      res.start = pad2(parseInt(tm[1], 10)) + ':' + tm[2];
      res.end = pad2(parseInt(tm[3], 10)) + ':' + tm[4];
      res.hasTime = true;
    } else {
      var tm2 = clean.match(/(\d{1,2})\s*[点时]\s*(?:(\d{1,2})\s*分)?\s*[-–—~～至到]\s*(\d{1,2})\s*[点时]/);
      if (tm2) {
        res.start = pad2(parseInt(tm2[1], 10)) + ':' + pad2(parseInt(tm2[2] || '0', 10));
        res.end = pad2(parseInt(tm2[3], 10)) + ':00';
        res.hasTime = true;
      }
    }

    // 地点
    var pm = clean.match(/地\s*点\s*[:：]\s*([^\n]+)/) ||
             clean.match(/在\s*([^\n，。；]{2,24}?)\s*(?:举办|举行|开展|召开)/);
    if (pm) res.place = pm[1].replace(/[【】]/g, '').trim();

    // 学分
    var cm = clean.match(/(?:二课|素拓|第二课堂|课外|通识)[^\d\n]{0,10}?(\d+(?:\.\d+)?)\s*分/) ||
             clean.match(/(\d+(?:\.\d+)?)\s*个?\s*学分/);
    if (cm) res.credit = parseFloat(cm[1]);

    // 志愿时长
    if (res.type === 'volunteer') {
      var vm = clean.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|h\b|H\b)/);
      if (vm) res.volunteerHours = parseFloat(vm[1]);
      if (!res.volunteerHours) res.volunteerHours = 2;
    }

    // 跑步公里
    var km = clean.match(/(\d+(?:\.\d+)?)\s*(?:公里|千米|km|KM)/);
    if (km && res.type === 'sports') res.runKm = parseFloat(km[1]);

    // 名额
    var cap = clean.match(/(?:名额|限)\s*(\d+)\s*人/) || clean.match(/(\d+)\s*人\s*(?:名额)?[，,。]/);
    if (cap) res.capacity = parseInt(cap[1], 10);
    var enr = clean.match(/已(?:报|报名|录取|加入)\s*(\d+)\s*人/);
    if (enr) res.enrolled = parseInt(enr[1], 10);

    res.tags = detectTags(clean);
    if (!res.tags.length) res.tags = ['学术讲座'];

    return res;
  }

  /* ---------------- 弹窗交互 ---------------- */

  function closeAllModals() {
    confirmCb = null;
    document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; });

    ['batchResult', 'tableResult', 'taskResult'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = true;
      el.innerHTML = '';
    });

    var bt = document.getElementById('batchText');
    if (bt) bt.value = '';
    var tt = document.getElementById('tableText');
    if (tt) tt.value = '';
    var kt = document.getElementById('taskText');
    if (kt) kt.value = '';
  }


  /* ---------------- 复制日程 ---------------- */

  function copySchedule() {
    if (!state.schedule.length) { toast('当前没有可复制的日程'); return; }

    var a = state.weekStart, b = addDays(a, 6);
    var out = ['排得开 · 我的活动日程（' + (a.getMonth() + 1) + '/' + a.getDate() + ' – ' +
               (b.getMonth() + 1) + '/' + b.getDate() + '）', ''];

    for (var d = 0; d < 7; d++) {
      var list = state.schedule.filter(function (x) { return x.d === d; });
      if (!list.length) continue;
      var dt = addDays(a, d);
      out.push(WD[d] + ' ' + (dt.getMonth() + 1) + '/' + dt.getDate());
      list.forEach(function (e) {
        var extra = [];
        if (e.credit > 0) extra.push('二课 ' + fmt1(e.credit) + ' 分');
        if (e.volunteerHours > 0) extra.push('志愿 ' + fmt0(e.volunteerHours) + ' 小时');
        if (e.runKm > 0) extra.push('跑步 ' + fmt1(e.runKm) + 'km');
        out.push('  ' + e.start + '-' + e.end + '  ' + e.title + '  @' + e.place +
                 (extra.length ? '  [' + extra.join(' / ') + ']' : ''));
      });
      out.push('');
    }

    var text = out.join('\n');

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('日程已复制到剪贴板'); }
      catch (err) { toast('复制失败，请手动截图'); }
      document.body.removeChild(ta);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('日程已复制到剪贴板');
      }).catch(fallback);
    } else {
      fallback();
    }
  }

  /* ---------------- 数据接入：三个适配器 ---------------- */

  /* ---------------- 阳光乐跑：官方标准 ----------------
     来源：杭电体联《体育1》课程学生乐跑时间通知（2026-10-25）
     得分   0   60 70 80 90 100 +1 +2 +3 +4 +5
     天数  <14  14 16 18 20 21  22 24 25 26 27
     少于 10 天，体育课平时分也为 0 */
  var RUN_STEPS = [
    [27, 105], [26, 104], [25, 103], [24, 102], [22, 101],
    [21, 100], [20, 90], [18, 80], [16, 70], [14, 60]
  ];

  function runScore(days) {
    var n = Number(days) || 0;
    if (n < 14) return 0;
    for (var i = 0; i < RUN_STEPS.length; i++) {
      if (n >= RUN_STEPS[i][0]) return RUN_STEPS[i][1];
    }
    return 0;
  }

  // 下一档要跑几天
  function runNextStep(days) {
    var n = Number(days) || 0;
    var steps = [14, 16, 18, 20, 21, 22, 24, 25, 26, 27];
    for (var i = 0; i < steps.length; i++) {
      if (n < steps[i]) return steps[i];
    }
    return null;
  }

  // 单次距离：男生 2.0 km，女生 1.5 km
  function runKmOf() {
    var u = currentUser();
    return (u && u.gender === 'f') ? 1.5 : 2.0;
  }

  function runScoreText(days) {
    var sc = runScore(days);
    var nx = runNextStep(days);
    if (nx === null) return '<b>' + sc + '</b> 分（已封顶）';
    var nxScore = runScore(nx);
    return '<b>' + sc + '</b> 分 · 再 ' + (nx - days) + ' 天到 <b>' + nxScore + '</b> 分';
  }

  function runLeft() { return Math.max(0, state.run.target - state.run.done); }

  function runPerWeek() {
    var left = runLeft();
    if (left <= 0) return 0;
    return left / Math.max(1, state.run.weeksLeft);
  }

  function hhmmNow(d) {
    if (!d) return '';
    return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' +
           pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // 候选活动与「当前状态」的全量冲突：课程占用 / 已排活动 / 转场 / 当日强度
  // 报名前就把这四类都算出来，才是这个产品真正值钱的地方。
  function conflictOf(e) {
    var b = busyHit(e);
    if (b) return { kind: 'busy', slot: b };

    var n = 0, mins = 0;

    for (var i = 0; i < state.schedule.length; i++) {
      var o = state.schedule[i];
      if (o.d !== e.d) continue;
      n++;
      mins += toMin(o.end) - toMin(o.start);

      if (overlap(e, o)) return { kind: 'time', other: o };

      var g = gapBetween(e, o);
      if (g >= 0 && g < travelMin(e.place, o.place)) {
        return { kind: 'travel', other: o, gap: g, need: travelMin(e.place, o.place) };
      }
    }

    if (n >= state.maxPerDay) return { kind: 'dense' };
    if (mins + (toMin(e.end) - toMin(e.start)) > 360) return { kind: 'dense' };

    return null;
  }

  function srcCard(o) {
    return '<div class="src' + (o.synced ? ' is-synced' : '') + '">' +
        '<div class="src-head"><span class="src-dot"></span><b>' + esc(o.name) + '</b>' +
          '<em>' + esc(o.sub) + '</em></div>' +
        '<div class="src-metric"><b>' + o.value + '</b><s>' + esc(o.unit) + '</s></div>' +
        '<div class="src-bar"><i class="' + (o.full ? 'full' : '') + '" style="width:' +
          o.bar.toFixed(1) + '%"></i></div>' +
        '<div class="src-foot">' + o.foot + '</div>' +
        '<div class="src-actions"><span class="tag-src' + (o.synced ? ' ok' : '') + '">' +
          esc(o.tag) + '</span>' + o.buttons + '</div>' +
      '</div>';
  }

  function renderSources() {
    var el = document.getElementById('sources');
    if (!el) return;

    /* ① 阳光乐跑 */
    var left = runLeft();
    var runPct = state.run.target > 0 ? clamp(state.run.done / state.run.target * 100, 0, 100) : 0;
    var perWeek = runPerWeek();
    var runFoot = runScoreText(state.run.done) +
      ' · 剩 ' + state.run.weeksLeft + ' 周（单次 ' + fmt1(runKmOf()) + ' km）';

    /* ② 二课 */
    var open = 0, fit = 0;
    state.events.forEach(function (e) {
      if (isOpen(e)) return;
      open++;
      if (!conflictOf(e)) fit++;
    });

    var fitFoot;
    var doneN = state.schedule.length;
    if (open === 0) {
      fitFoot = '活动池共 <b>' + state.events.length + '</b> 场，暂无可报名';
    } else if (fit === 0) {
      fitFoot = '已为你排入 <b>' + doneN + '</b> 场 · 剩余可报名活动本周暂无空位';
    } else {
      fitFoot = '已为你排入 <b>' + doneN + '</b> 场 · 另有 <b>' + fit + '</b> 场能插入空档';
    }

    /* ③ 钉钉课表 */
    var busyN = state.busy.length;
    var busyPct = clamp(busyN / 21 * 100, 0, 100);

    var html = '';

    html += srcCard({
      name: '阳光乐跑', sub: '运动时间bank',
      value: state.run.done, unit: '/ ' + state.run.target + ' 次',
      bar: runPct, full: left <= 0,
      foot: runFoot,
      synced: state.sources.run.synced,
      tag: state.sources.run.synced ? ('已同步 ' + hhmmNow(state.sources.run.at)) : '手动同步',
      buttons: '<button class="btn ghost" type="button" data-act="run">录入</button>' +
               '<button class="btn ghost" type="button" data-act="run-apply">同步到本周目标</button>'
    });

    html += srcCard({
      name: '二课活动', sub: 'erke.hdu.edu.cn',
      value: open, unit: '场可报名',
      bar: state.events.length ? clamp(open / state.events.length * 100, 0, 100) : 0,
      foot: fitFoot,
      synced: state.sources.erke.synced,
      tag: state.sources.erke.synced ? ('已导入 ' + state.sources.erke.imported + ' 条') : '批量粘贴',
      buttons: '<button class="btn ghost" type="button" data-act="batch">批量导入</button>'
    });

    html += srcCard({
      name: '课表', sub: '钉钉 · 杭电',
      value: busyN, unit: '/ 21 时段',
      bar: busyPct,
      foot: state.courses.length
        ? '已排 <b>' + state.courses.length + '</b> 门课 · 会显示在「日程」里，排班也一定避开'
        : '点亮的格子会显示在日程里，排班时也会避开',
      synced: state.sources.dingtalk.synced,
      tag: state.courses.length ? ('已排 ' + state.courses.length + ' 门') : '待导入',
      buttons: '<button class="btn ghost" type="button" data-act="table">导入课表</button>' +
               '<button class="btn ghost" type="button" data-act="export">导出课表</button>'
    });

    el.innerHTML = html;
  }

  /* ---------------- 阳光乐跑：同步与联动 ---------------- */

  function renderRunPreview() {
    var done = parseInt(document.getElementById('runDone').value, 10) || 0;
    var target = parseInt(document.getElementById('runTarget').value, 10) || 1;
    var weeks = parseInt(document.getElementById('runWeeks').value, 10) || 1;
    var km = parseFloat(document.getElementById('runKm').value) || 0;

    var left = Math.max(0, target - done);
    var perWeek = left > 0 ? left / weeks : 0;
    var box = document.getElementById('runPreview');

    if (left <= 0) {
      box.innerHTML = '本学期 <b>' + done + '</b> 天 = <b>' + runScore(done) + '</b> 分' +
      '（100 分需 21 天，27 天 = +5），累计 <b>' + km +
        '</b> km。<span class="good">不用再安排跑步了。</span>';
    } else {
      box.innerHTML =
        '还差 <span class="warn">' + left + ' 天</span> · 剩余 ' + weeks + ' 周 · ' +
        '每周至少要跑 <b>' + (Math.round(perWeek * 10) / 10) + '</b> 次<br>' +
        '累计里程 <b>' + km + '</b> km。点击下方按钮会把「本周计划跑」设成 <b>' +
        Math.ceil(perWeek) + '</b> 次，排程会自动给你留出跑步时间。';
    }
  }

  function openRun() {
    document.getElementById('runDone').value = state.run.done;
    document.getElementById('runTarget').value = state.run.target;
    document.getElementById('runKm').value = state.run.km;
    document.getElementById('runWeeks').value = state.run.weeksLeft;
    renderRunPreview();
    document.getElementById('modalRun').hidden = false;
  }

  function applyRun() {
    state.run.done = Math.max(0, parseInt(document.getElementById('runDone').value, 10) || 0);
    state.run.target = Math.max(1, parseInt(document.getElementById('runTarget').value, 10) || 1);
    state.run.km = Math.max(0, parseFloat(document.getElementById('runKm').value) || 0);
    state.run.weeksLeft = Math.max(1, parseInt(document.getElementById('runWeeks').value, 10) || 1);
    state.sources.run.synced = true;
    state.sources.run.at = new Date();

    var perWeek = runPerWeek();
    state.goals.run = Math.ceil(perWeek);
    document.getElementById('goalRun').value = state.goals.run;

    document.getElementById('modalRun').hidden = true;
    regenerate();
    toast(runLeft() <= 0 ? '已达标，跑步目标清零' : '已同步，本周需跑 ' + state.goals.run + ' 次');
  }

  /* ---------------- 二课：批量导入 ---------------- */

  var batchDrafts = [];

  function splitActivities(text) {
    var t = String(text || '').replace(/\r/g, '').replace(/\u3000/g, ' ').trim();
    if (!t) return [];

    var blocks = [];
    // 形态一：多条通知，每条以【类型】开头
    if ((t.match(/【/g) || []).length >= 2) {
      blocks = t.split(/(?=【)/).map(function (s) { return s.trim(); });
    }
    // 形态二：空行分隔
    if (blocks.length <= 1) {
      blocks = t.split(/\n\s*\n+/).map(function (s) { return s.trim(); });
    }
    // 形态三：编号列表 1、 / 1. / (1)
    if (blocks.length <= 1) {
      blocks = t.split(/\n(?=\s*(?:\d{1,2}[、.．)）]|[（(]\d{1,2}[）)]))/)
               .map(function (s) { return s.trim(); });
    }

    return blocks
      .filter(function (s) { return s.length >= 6; })
      .map(function (s) { return s.replace(/^\s*\d{1,2}\s*[、.．)）]\s*/, ''); })
      .slice(0, 30);
  }

  function batchSampleText() {
    function d(i) {
      var x = addDays(state.weekStart, i);
      return (x.getMonth() + 1) + '月' + x.getDate() + '日';
    }
    return '【实践】AIGC 创作大赛 · 赛前培训\n时间：' + d(2) + ' 18:30-20:00\n' +
           '地点：第三教学楼 305\n二课学分：0.3\n名额 100 人，已报名 47 人\n\n' +
           '【讲座】开源硬件与嵌入式入门\n时间：' + d(1) + ' 10:00-11:30\n' +
           '地点：第三教学楼 201\n二课学分：0.2\n名额 120 人，已报名 96 人\n\n' +
           '【文体】非遗剪纸体验工坊\n时间：' + d(5) + ' 09:30-11:30\n' +
           '地点：艺术楼 203\n二课学分：0.3\n名额 40 人，已报名 35 人\n\n' +
           '【志愿】社区图书整理协助\n时间：' + d(4) + ' 15:00-17:00\n' +
           '地点：图书馆 三层\n志愿时长：2 小时\n名额 20 人，已报名 8 人';
  }

  function renderBatch() {
    var list = batchDrafts;
    var box = document.getElementById('batchResult');

    if (!list.length) {
      box.innerHTML = '<div class="pr-warn">没识别出活动条目。请确保每条包含「时间：X月X日 HH:MM-HH:MM」这样的时间信息，条目之间用空行分隔。</div>';
      box.hidden = false;
      return;
    }

    var rows = list.map(function (it, i) {
      var e = it.ev;
      var flag, cls, checked;

      if (!it.ok) {
        flag = '时间待补充'; cls = 'flag-bad'; checked = '';
      } else if (it.clash) {
        var c = it.clash;
        if (c.kind === 'busy') flag = '与你的课程冲突';
        else if (c.kind === 'time') flag = '与「' + c.other.title + '」时间冲突';
        else if (c.kind === 'travel') flag = '转场来不及';
        else flag = '当天排太满';
        cls = 'flag-clash'; checked = '';
      } else {
        flag = '可加入'; cls = 'flag-ok'; checked = ' checked';
      }

      var time = it.ok ? (WD[e.d] + ' ' + e.start + '–' + e.end) : '未识别';
      var gain = [];
      if (e.credit > 0) gain.push('二课 ' + fmt1(e.credit) + ' 分');
      if (e.volunteerHours > 0) gain.push('志愿 ' + fmt0(e.volunteerHours) + 'h');
      if (e.runKm > 0) gain.push('跑步 ' + fmt1(e.runKm) + 'km');

      return '<label class="brow' + (it.clash || !it.ok ? ' bad' : '') + '">' +
               '<input type="checkbox" data-i="' + i + '"' + checked + (it.ok ? '' : ' disabled') + '>' +
               '<span><span class="brow-t">' + esc(e.title) + '</span>' +
                 '<span class="brow-m">' + esc(time) + ' · ' + esc(e.place || '地点待定') +
                 (gain.length ? ' · ' + gain.join(' · ') : '') + '</span></span>' +
               '<span class="brow-flag ' + cls + '">' + esc(flag) + '</span>' +
             '</label>';
    }).join('');

    var okN = list.filter(function (it) { return it.ok && !it.clash; }).length;

    box.innerHTML =
      '<div class="batch-list">' + rows + '</div>' +
      '<div class="batch-foot">' +
        '<button class="btn primary" type="button" id="btnBatchAdd">加入勾选的活动</button>' +
        '<span class="hint">识别 ' + list.length + ' 条，其中 <b>' + okN + '</b> 条可直接排入；' +
          '冲突条目默认不勾选，可手动改时间后再加</span>' +
      '</div>';
    box.hidden = false;

    document.getElementById('btnBatchAdd').addEventListener('click', addBatch);
  }

  // AI 返回的 JSON → 一段段「通知」文本，交给原来的解析器
  function jsonToBlocks(text) {
    var s = String(text || '').trim();
    if (!s) return null;
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
    var i0 = s.indexOf('{'), i1 = s.lastIndexOf('}');
    if (i0 < 0 || i1 <= i0) return null;

    var obj;
    try { obj = JSON.parse(s.slice(i0, i1 + 1)); } catch (e) { return null; }

    var arr = obj.items || obj.activities || obj.list || obj.events;
    if (!Array.isArray(arr) || !arr.length) return null;

    return arr.map(function (it) {
      var title = it.title || it.name || it['名称'] || it['活动'] || '未命名活动';
      var hours = Number(it.hours || it['时长'] || 0) || 0;
      var credit = Number(it.credit || it['学分'] || 0) || 0;
      var kind = hours > 0 ? '志愿' : '讲座';

      var lines = ['【' + kind + '】' + title];
      var day = it.day || it['日期'] || it.date || '';
      var st = it.start || it['开始'] || '';
      var en = it.end || it['结束'] || '';
      if (day || st) lines.push('时间：' + [day, st + (en ? '-' + en : '')].filter(Boolean).join(' ').trim());
      var place = it.place || it['地点'] || '';
      if (place) lines.push('地点：' + place);
      if (credit) lines.push('二课学分：' + credit);
      if (hours) lines.push('志愿时长：' + hours + ' 小时');
      return lines.join('\n');
    });
  }

  function parseBatch() {
    var txt = document.getElementById('batchText').value;
    // 优先按 AI 返回的 JSON 解析，失败再退回文本切分
    var blocks = jsonToBlocks(txt) || splitActivities(txt);

    batchDrafts = blocks.map(function (b) {
      var r = parseNotice(b);
      var ev = {
        id: 'b' + (++uid),
        d: r.d,
        date: ymd(addDays(state.weekStart, r.d)),
        title: r.title,
        type: r.type,
        place: r.place || '待定',
        start: r.start,
        end: r.end,
        credit: r.credit || 0,
        volunteerHours: r.volunteerHours || 0,
        runKm: r.runKm || 0,
        capacity: r.capacity == null ? Infinity : r.capacity,
        enrolled: r.enrolled || 0,
        deadline: null,
        tags: r.tags,
        org: '二课导入',
        source: 'erke'
      };
      return {
        ev: ev,
        ok: !!r.hasTime,
        clash: r.hasTime ? conflictOf(ev) : null
      };
    });

    renderBatch();
  }

  function addBatch() {
    var boxes = document.querySelectorAll('#batchResult input[type="checkbox"]');
    var added = 0;
    var fresh = [];

    boxes.forEach(function (cb) {
      if (!cb.checked) return;
      var it = batchDrafts[parseInt(cb.getAttribute('data-i'), 10)];
      if (!it || !it.ok) return;
      it.ev.custom = true;
      state.events.push(it.ev);
      fresh.push(it.ev);
      added++;
    });

    if (!added) { toast('没有勾选任何活动'); return; }

    adopt(fresh);

    state.sources.erke.synced = true;
    state.sources.erke.at = new Date();
    state.sources.erke.imported = added;

    closeAllModals();
    regenerate();
    toast('导入了 ' + added + ' 条，已经帮你勾上');
  }

  /* ---------------- 课表：粘贴导入 ---------------- */

  // 节次对应的钟点（杭电作息），用来把课画进日程
  var PERIOD_TIME = {
    1: ['08:40', '09:25'], 2: ['09:30', '10:15'],
    3: ['10:25', '11:10'], 4: ['11:15', '12:00'],
    5: ['12:05', '12:50'], 6: ['13:30', '14:15'],
    7: ['14:20', '15:05'], 8: ['15:15', '16:00'],
    9: ['18:30', '19:15'], 10: ['19:20', '20:05'],
    11: ['20:10', '20:55'], 12: ['21:00', '21:45']
  };

  function slotsForSpan(a, b) {
    var slots = [];
    if (a <= 4 && b >= 1) slots.push('am');
    if (a <= 8 && b >= 5) slots.push('pm');
    if (a <= 12 && b >= 9) slots.push('eve');
    if (!slots.length) slots.push('am');
    return slots;
  }

  // 文字里的课表： 周一 第1-2节 高等数学 三教201
  function parseTimetable(text) {
    var map = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6 };
    var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var hits = [];
    var miss = [];

    lines.forEach(function (L) {
      var m = L.match(/(?:周|星期)\s*([一二三四五六日天])\s*[，,、]?\s*第?\s*(\d{1,2})\s*(?:[-–—~～至到]\s*(\d{1,2}))?\s*节/);
      if (!m) { miss.push(L); return; }

      var d = map[m[1]];
      var a = parseInt(m[2], 10);
      var b = m[3] ? parseInt(m[3], 10) : a;
      if (b < a) { var t = a; a = b; b = t; }

      var s0 = PERIOD_TIME[a] || PERIOD_TIME[1];
      var s1 = PERIOD_TIME[b] || PERIOD_TIME[12];

      var name = L.slice(m.index + m[0].length).replace(/^[\s\-—:：]+/, '').trim();
      // 名字后面通常还跟着教室：名字 教室
      var parts = name.split(/\s+/);
      var place = '';
      if (parts.length > 1) { place = parts.pop(); }
      name = parts.join(' ');

      hits.push({
        d: d,
        slots: slotsForSpan(a, b),
        title: name || '课程',
        place: place,
        start: s0[0],
        end: s1[1],
        raw: L
      });
    });

    return { hits: hits, miss: miss };
  }

  // AI 返回的 JSON：{"courses":[{title, day, start, end, place}]}
  function parseCoursesJson(text) {
    var json = parseJsonLoose(text);
    if (!json) return null;

    var arr = json.courses || json.items || json.lessons || (Array.isArray(json) ? json : null);
    if (!arr || !arr.length) return null;

    var hits = [];
    arr.forEach(function (it) {
      if (typeof it === 'string') return;
      var d = dayIndex(it.day || it.weekday || '');
      var st = normTime(it.start || it.begin || '');
      var en = normTime(it.end || it.finish || '');
      if (d < 0 || !st || !en) return;

      hits.push({
        d: d,
        slots: slotsOf(st, en),
        title: String(it.title || it.name || it.course || '课程').trim(),
        place: String(it.place || it.room || it.location || '').trim(),
        start: st,
        end: en,
        weeks: parseWeeks(it.weeks || it.week || '', it.parity || ''),
        raw: ''
      });
    });

    return hits.length ? { hits: hits, miss: [] } : null;
  }

  function applyTimetable() {
    var raw = document.getElementById('tableText').value;
    var box = document.getElementById('tableResult');

    var res = parseCoursesJson(raw) || parseTimetable(raw);

    if (!res.hits.length) {
      box.innerHTML = '<div class="pr-warn">没有识别到课表。支持两种写法：<br>' +
                      '· 文字：<code>周一 第1-2节 高等数学 三教201</code><br>' +
                      '· 或者 AI 返回的 JSON</div>';
      box.hidden = false;
      return;
    }

    state.busy = [];
    state.courses = [];

    res.hits.forEach(function (h) {
      h.slots.forEach(function (s) {
        var k = busyKey(h.d, s);
        if (state.busy.indexOf(k) === -1) state.busy.push(k);
      });
      state.courses.push({
        id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000) + state.courses.length,
        d: h.d, start: h.start, end: h.end,
        title: h.title, place: h.place,
        weeks: h.weeks || { from: 1, to: 16, parity: 'all' }
      });
    });

    state.sources.dingtalk.synced = true;
    state.sources.dingtalk.at = new Date();

    renderPanel();
    regenerate();
    closeAllModals();

    toast('导入了 ' + res.hits.length + ' 门课');
    if (res.miss.length) {
      toast('导入了 ' + res.hits.length + ' 门课，' + res.miss.length + ' 行没看懂');
    }
  }

  /* ---------------- 导出课表：图片 / PDF / 日历 ---------------- */

  function exportStamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  function fmtMD(d) {
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // 触发下载：链接留在 DOM 里一个 tick 再删，某些浏览器删太快会取消下载
  function downloadUrl(url, name) {
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 1200);
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    downloadUrl(url, name);
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  // dataURL -> Uint8Array
  function dataUrlToBytes(dataUrl) {
    var i = dataUrl.indexOf(',');
    var bin = atob(dataUrl.slice(i + 1));
    var out = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  }

  // 把一周的课表画成一张图（固定浅色，方便打印和贴进 PPT）
  function drawScheduleCanvas() {
    var S = 2;                       // 2 倍，导出更清楚
    var W = 1600, H = 1060;
    var cv = document.createElement('canvas');
    cv.width = W * S / 2;
    cv.height = H * S / 2;
    var g = cv.getContext('2d');
    g.scale(S / 2, S / 2);

    var PAD = 56, GUT = 112, HEAD = 200, FOOT = 62;
    var bodyTop = HEAD;
    var bodyH = H - HEAD - FOOT;
    var colW = (W - PAD * 2 - GUT) / 7;
    var T0 = 420, T1 = 1320;         // 07:00 – 22:00（阳光乐跑最早 7 点）

    function yOf(t) { return bodyTop + (t - T0) / (T1 - T0) * bodyH; }

    // 背景
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, W, H);

    // 顶部标题
    g.fillStyle = '#131829';
    g.font = '800 42px "Microsoft YaHei", "PingFang SC", sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillText('排得开 · 本周课表', PAD, 82);

    g.fillStyle = '#8B94A8';
    g.font = '600 21px "Microsoft YaHei", sans-serif';
    var wk = weekOf(state.weekStart);
    var d0 = state.weekStart, d1 = addDays(state.weekStart, 6);
    g.fillText((wk ? '第 ' + wk + ' 周 · ' : '') + fmtMD(d0) + ' – ' + fmtMD(d1) +
               ' · 共 ' + state.schedule.length + ' 场活动 / ' + state.courses.length + ' 门课', PAD, 118);

    g.textAlign = 'right';
    g.fillStyle = '#B9C1D2';
    g.font = '600 17px "Microsoft YaHei", sans-serif';
    g.fillText('mobius-msz.github.io/paidekai', W - PAD, 118);
    g.textAlign = 'left';

    // 列头
    var names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    for (var i = 0; i < 7; i++) {
      var cx = PAD + GUT + i * colW + colW / 2;
      g.textAlign = 'center';
      g.fillStyle = (i >= 5) ? '#C2643C' : '#343C52';
      g.font = '800 21px "Microsoft YaHei", sans-serif';
      g.fillText(names[i], cx, HEAD - 46);
      g.fillStyle = '#A9B2C4';
      g.font = '600 16px "Microsoft YaHei", sans-serif';
      g.fillText(fmtMD(addDays(state.weekStart, i)), cx, HEAD - 20);
      g.textAlign = 'left';
    }

    // 横向时间线
    for (var t = T0; t <= T1; t += 120) {
      var y = yOf(t);
      g.strokeStyle = (t % 240 === 0) ? '#E7EAF3' : '#F3F5FA';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(PAD + GUT, y);
      g.lineTo(W - PAD, y);
      g.stroke();

      g.fillStyle = '#A9B2C4';
      g.font = '600 16px "Microsoft YaHei", sans-serif';
      g.textAlign = 'right';
      g.fillText(pad2(Math.floor(t / 60)) + ':00', PAD + GUT - 16, y + 6);
      g.textAlign = 'left';
    }

    // 周末浅底
    g.fillStyle = 'rgba(246, 247, 251, .8)';
    g.fillRect(PAD + GUT + 5 * colW, bodyTop, colW * 2, bodyH);

    // 竖分隔
    for (var j = 0; j <= 7; j++) {
      var x = PAD + GUT + j * colW;
      g.strokeStyle = '#EDF0F7';
      g.beginPath();
      g.moveTo(x, bodyTop);
      g.lineTo(x, bodyTop + bodyH);
      g.stroke();
    }

    function roundRect(x, y, w, hh, r) {
      var rr = Math.min(r, w / 2, hh / 2);
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + hh, rr);
      g.arcTo(x + w, y + hh, x, y + hh, rr);
      g.arcTo(x, y + hh, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
    }

    function textFit(str, maxW) {
      if (g.measureText(str).width <= maxW) return str;
      var s = str;
      while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      return s + '…';
    }

    // 方块
    function block(day, start, end, title, sub, fill, bar, ink) {
      var x = PAD + GUT + day * colW + 5;
      var w = colW - 10;
      var top = yOf(toMin(start));
      var bh = Math.max(24, yOf(toMin(end)) - top);

      roundRect(x, top + 1, w, bh - 2, 8);
      g.fillStyle = fill;
      g.fill();

      g.fillStyle = bar;
      g.fillRect(x, top + 1, 5, bh - 2);

      g.fillStyle = ink;
      g.font = '700 15px "Microsoft YaHei", sans-serif';
      g.fillText(textFit(title, w - 20), x + 13, top + 24);

      if (bh > 46) {
        g.fillStyle = 'rgba(90, 100, 124, .82)';
        g.font = '600 12.5px "Microsoft YaHei", sans-serif';
        g.fillText(start + '–' + end, x + 13, top + 44);
      }
      if (bh > 74 && sub) {
        g.fillStyle = 'rgba(120, 130, 150, .9)';
        g.font = '600 12px "Microsoft YaHei", sans-serif';
        g.fillText(textFit(sub, w - 20), x + 13, top + 63);
      }
    }

    // 课程
    state.courses.forEach(function (cs) {
      block(cs.d, cs.start, cs.end, cs.title, cs.place, '#F1F3F9', '#C3CADD', '#39415A');
    });

    // 活动
    state.schedule.forEach(function (e) {
      var ty = TYPES[e.type] || TYPES.lecture;
      block(e.d, e.start, e.end, e.title, (e.runKm > 0 ? '07:00–21:00 任选' : (e.place || '')),
            ty.bg, ty.color, '#1B2033');
    });

    // 底部
    g.strokeStyle = '#EDF0F7';
    g.beginPath();
    g.moveTo(PAD, H - FOOT + 10);
    g.lineTo(W - PAD, H - FOOT + 10);
    g.stroke();

    g.fillStyle = '#B9C1D2';
    g.font = '600 15px "Microsoft YaHei", sans-serif';
    g.fillText('排得开 · 校园日程排班器', PAD, H - 22);

    g.textAlign = 'right';
    g.fillText('导出于 ' + new Date().toLocaleString('zh-CN', { hour12: false }), W - PAD, H - 22);
    g.textAlign = 'left';

    return cv;
  }

  // 导出后弹预览：下载被浏览器拦了也有退路
  function showResult(opts) {
    var m = document.getElementById('modalResult');
    if (!m) return;
    document.getElementById('resultTitle').textContent = opts.title || '导出好了';
    document.getElementById('resultSub').textContent = opts.sub || '';

    var body = document.getElementById('resultBody');
    body.innerHTML = '';
    if (opts.imgUrl) {
      var img = document.createElement('img');
      img.src = opts.imgUrl;
      img.alt = '导出的图片';
      body.appendChild(img);
    } else if (opts.embedUrl) {
      var fr = document.createElement('iframe');
      fr.src = opts.embedUrl;
      fr.title = '导出预览';
      body.appendChild(fr);
    } else {
      body.innerHTML = '<div class="result-plain">文件已经生成好了，点下面「下载文件」保存。</div>';
    }

    var dl = document.getElementById('resultDownload');
    dl.href = opts.url;
    dl.download = opts.name;
    var op = document.getElementById('resultOpen');
    op.href = opts.url;

    m.hidden = false;
  }

  function exportDone(kind, url, name, canvas) {
    showResult({
      title: kind === 'pdf' ? 'PDF 生成好了' : '图片生成好了',
      sub: '文件名：' + name +
           (kind === 'img' ? ' —— 没自动下载的话，在图上右键 → 另存为' : ' —— 没自动下载的话，点下面的按钮'),
      imgUrl: kind === 'img' ? url : null,
      embedUrl: kind === 'pdf' ? url : null,
      url: url,
      name: name
    });
  }

  function exportSchedulePng() {
    if (!state.schedule.length && !state.courses.length) { toast('还没有排任何东西'); return; }
    var cv = drawScheduleCanvas();
    // 同步取值再点击，保住用户手势，浏览器不会拦
    var url = cv.toDataURL('image/png');
    var name = '排得开-课表-' + exportStamp() + '.png';
    downloadUrl(url, name);
    exportDone('img', url, name);
    toast('图片已生成');
  }

  // 最小 PDF：把 JPEG 原样塞进去，不依赖任何库
  function pdfFromJpeg(jpeg, w, h) {
    var enc = new TextEncoder();
    var parts = [], size = 0;
    function put(x) {
      var b = (typeof x === 'string') ? enc.encode(x) : x;
      parts.push(b);
      size += b.length;
    }
    var off = [];

    put('%PDF-1.4\n');

    var pw = 842, ph = 595, m = 22;            // A4 横向
    var sc = Math.min((pw - m * 2) / w, (ph - m * 2) / h);
    var dw = w * sc, dh = h * sc;
    var px = (pw - dw) / 2, py = (ph - dh) / 2;

    function obj(n, body) { off[n] = size; put(n + ' 0 obj\n' + body + '\nendobj\n'); }

    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] ' +
           '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');

    off[4] = size;
    put('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        jpeg.length + ' >>\nstream\n');
    put(jpeg);
    put('\nendstream\nendobj\n');

    var cs = 'q\n' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' +
             px.toFixed(2) + ' ' + py.toFixed(2) + ' cm\n/Im0 Do\nQ\n';
    off[5] = size;
    put('5 0 obj\n<< /Length ' + enc.encode(cs).length + ' >>\nstream\n' + cs + 'endstream\nendobj\n');

    var xref = size;
    var s = 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i <= 5; i++) s += ('0000000000' + off[i]).slice(-10) + ' 00000 n \n';
    s += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    put(s);

    var total = 0;
    parts.forEach(function (b) { total += b.length; });
    var out = new Uint8Array(total), p = 0;
    parts.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  function exportSchedulePdf() {
    if (!state.schedule.length && !state.courses.length) { toast('还没有排任何东西'); return; }
    var cv = drawScheduleCanvas();
    var jpeg = dataUrlToBytes(cv.toDataURL('image/jpeg', 0.93));
    var pdf = pdfFromJpeg(jpeg, cv.width, cv.height);
    var url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    var name = '排得开-课表-' + exportStamp() + '.pdf';
    downloadUrl(url, name);
    exportDone('pdf', url, name);
    toast('PDF 已生成');
  }

  // 当天的日程画成一张单页
  function drawDayCanvas() {
    var d = state.activeDay;
    var S = 2;
    var W = 1200;
    var items = [];

    state.courses.forEach(function (cs) {
      if (cs.d === d) items.push({ s: cs.start, e: cs.end, title: cs.title, sub: cs.place, kind: 'course' });
    });
    state.schedule.forEach(function (e) {
      if (e.d !== d) return;
      var ty = TYPES[e.type] || TYPES.lecture;
      items.push({
        s: e.start, e: e.end, title: e.title,
        sub: (e.runKm > 0 ? '07:00–21:00 任选' : (e.place || '')),
        kind: 'act', color: ty.color, bg: ty.bg, label: ty.label
      });
    });
    items.sort(function (p, q) { return toMin(p.s) - toMin(q.s); });

    var HEAD = 196, ROW = 94, GAPROW = 40, FOOT = 74, PAD = 64;
    var bodyH = 0;
    if (items.length) {
      bodyH = items.length * ROW;
      for (var k = 0; k < items.length - 1; k++) {
        if (toMin(items[k + 1].s) - toMin(items[k].e) >= 45) bodyH += GAPROW;
      }
    } else {
      bodyH = 240;
    }
    var H = HEAD + bodyH + FOOT;

    var cv = document.createElement('canvas');
    cv.width = Math.round(W * S / 2);
    cv.height = Math.round(H * S / 2);
    var g = cv.getContext('2d');
    g.scale(S / 2, S / 2);

    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, W, H);

    var dt = addDays(state.weekStart, d);
    var wk = weekOf(dt);
    var totalMin = items.reduce(function (sum, it) { return sum + (toMin(it.e) - toMin(it.s)); }, 0);

    // 头部
    g.fillStyle = '#131829';
    g.font = '800 40px "Microsoft YaHei", "PingFang SC", sans-serif';
    g.fillText(WD[d] + '的日程', PAD, 84);

    g.fillStyle = '#8B94A8';
    g.font = '600 20px "Microsoft YaHei", sans-serif';
    g.fillText((wk ? '第 ' + wk + ' 周 · ' : '') + fmtMD(dt) + ' · ' +
               (items.length ? items.length + ' 件事 · 共 ' + Math.round(totalMin / 60 * 10) / 10 + ' 小时' : '没有安排'),
               PAD, 120);

    g.textAlign = 'right';
    g.fillStyle = '#B9C1D2';
    g.font = '600 16px "Microsoft YaHei", sans-serif';
    g.fillText('排得开 · 校园日程排班器', W - PAD, 84);
    g.fillText('mobius-msz.github.io/paidekai', W - PAD, 112);
    g.textAlign = 'left';

    g.strokeStyle = '#E7EAF3';
    g.beginPath();
    g.moveTo(PAD, 150);
    g.lineTo(W - PAD, 150);
    g.stroke();

    function roundRect(x, y, w, hh, r) {
      var rr = Math.min(r, w / 2, hh / 2);
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + hh, rr);
      g.arcTo(x + w, y + hh, x, y + hh, rr);
      g.arcTo(x, y + hh, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
    }

    function fit(str, maxW) {
      if (g.measureText(str).width <= maxW) return str;
      var s = str;
      while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      return s + '…';
    }

    // 空状态
    if (!items.length) {
      g.fillStyle = '#C3C9DA';
      g.font = '600 24px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.fillText('这天没有安排 —— 去二课、志愿、乐跑页挑几场吧', W / 2, HEAD + 120);
      g.textAlign = 'left';
    }

    var y = HEAD + 22;
    items.forEach(function (it, idx) {
      var barX = PAD + 168;

      // 时间
      g.fillStyle = '#131829';
      g.font = '800 24px "Microsoft YaHei", sans-serif';
      g.textAlign = 'right';
      g.fillText(it.s, PAD + 132, y + 30);
      g.fillStyle = '#A9B2C4';
      g.font = '600 16px "Microsoft YaHei", sans-serif';
      g.fillText(it.e, PAD + 132, y + 54);
      g.textAlign = 'left';

      // 卡片
      var isCourse = (it.kind === 'course');
      roundRect(barX, y, W - PAD - barX, ROW - 14, 10);
      g.fillStyle = isCourse ? '#F1F3F9' : (it.bg || '#EEF1FE');
      g.fill();

      g.fillStyle = isCourse ? '#C3CADD' : (it.color || '#4C5CE0');
      g.fillRect(barX, y, 5, ROW - 14);

      // 类型标签
      var tag = isCourse ? '课' : (it.label || '活动');
      g.font = '700 14px "Microsoft YaHei", sans-serif';
      var tw = g.measureText(tag).width + 20;
      roundRect(barX + 18, y + 14, tw, 26, 6);
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.fill();
      g.fillStyle = isCourse ? '#5A647C' : (it.color || '#4C5CE0');
      g.fillText(tag, barX + 28, y + 32);

      // 标题
      g.fillStyle = isCourse ? '#39415A' : '#1B2033';
      g.font = '800 25px "Microsoft YaHei", sans-serif';
      g.fillText(fit(it.title, W - PAD - barX - 60), barX + 18 + tw + 14, y + 36);

      // 副信息
      var dur = toMin(it.e) - toMin(it.s);
      var bits = [];
      if (it.sub) bits.push(it.sub);
      bits.push(Math.floor(dur / 60) + (dur % 60 ? ' 小时 ' + (dur % 60) + ' 分' : ' 小时'));
      g.fillStyle = 'rgba(100, 110, 132, .9)';
      g.font = '600 16px "Microsoft YaHei", sans-serif';
      g.fillText(fit(bits.join(' · '), W - PAD - barX - 40), barX + 18, y + 62);

      y += ROW;

      // 空档
      if (idx < items.length - 1) {
        var gap = toMin(items[idx + 1].s) - toMin(it.e);
        if (gap >= 45) {
          g.strokeStyle = '#EDF0F7';
          g.setLineDash([6, 6]);
          g.beginPath();
          g.moveTo(barX, y + GAPROW / 2);
          g.lineTo(W - PAD, y + GAPROW / 2);
          g.stroke();
          g.setLineDash([]);

          g.fillStyle = '#B9C1D2';
          g.font = '600 15px "Microsoft YaHei", sans-serif';
          g.textAlign = 'center';
          g.fillText('空档 ' + gap + ' 分钟', barX + (W - PAD - barX) / 2, y + GAPROW / 2 - 8);
          g.textAlign = 'left';
          y += GAPROW;
        }
      }
    });

    // 页脚
    g.fillStyle = '#B9C1D2';
    g.font = '600 15px "Microsoft YaHei", sans-serif';
    g.fillText('排得开 · 校园日程排班器', PAD, H - 26);
    g.textAlign = 'right';
    g.fillText('导出于 ' + new Date().toLocaleString('zh-CN', { hour12: false }), W - PAD, H - 26);
    g.textAlign = 'left';

    return cv;
  }

  function exportDayPng() {
    var cv = drawDayCanvas();
    var url = cv.toDataURL('image/png');
    var name = '排得开-' + WD[state.activeDay] + '-' + exportStamp() + '.png';
    downloadUrl(url, name);
    exportDone('img', url, name);
    toast('图片已生成');
  }

  function exportDayPdf() {
    var cv = drawDayCanvas();
    var jpeg = dataUrlToBytes(cv.toDataURL('image/jpeg', 0.93));
    var pdf = pdfFromJpeg(jpeg, cv.width, cv.height);
    var url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    var name = '排得开-' + WD[state.activeDay] + '-' + exportStamp() + '.pdf';
    downloadUrl(url, name);
    exportDone('pdf', url, name);
    toast('PDF 已生成');
  }

  var exportMode = 'week';

  function openExport(mode) {
    exportMode = (mode === 'day') ? 'day' : 'week';
    var t = document.getElementById('exportTitle');
    var s = document.getElementById('exportSub');
    var ics = document.querySelector('#modalExport [data-exp="ics"]');
    var grid = document.querySelector('#modalExport .exp-grid');

    if (exportMode === 'day') {
      t.textContent = '导出' + WD[state.activeDay] + '的日程';
      s.textContent = '只导出当天的安排，一页纸';
      if (ics) ics.hidden = true;
      grid.classList.add('two');
    } else {
      t.textContent = '导出这一周的课表';
      s.textContent = '三种格式，看你要拿去干什么';
      if (ics) ics.hidden = false;
      grid.classList.remove('two');
    }
    document.getElementById('modalExport').hidden = false;
  }

  function runExport(kind) {
    document.getElementById('modalExport').hidden = true;
    if (exportMode === 'day') {
      if (kind === 'png') exportDayPng();
      else if (kind === 'pdf') exportDayPdf();
      return;
    }
    if (kind === 'png') exportSchedulePng();
    else if (kind === 'pdf') exportSchedulePdf();
    else if (kind === 'ics') downloadIcs();
  }

  /* ---------------- 导出日历（.ics） ---------------- */

  function icsEsc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function icsTime(dayOffset, hhmm) {
    var d = addDays(state.weekStart, dayOffset);
    var p = String(hhmm).split(':');
    // 视作北京时间（UTC+8）换算成 UTC，避免跨时区出错
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
                      parseInt(p[0], 10), parseInt(p[1], 10), 0) - 8 * 3600 * 1000;
    var u = new Date(ms);
    return u.getUTCFullYear() + pad2(u.getUTCMonth() + 1) + pad2(u.getUTCDate()) + 'T' +
           pad2(u.getUTCHours()) + pad2(u.getUTCMinutes()) + '00Z';
  }

  function buildIcs() {
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad2(now.getUTCMonth() + 1) + pad2(now.getUTCDate()) + 'T' +
                pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + pad2(now.getUTCSeconds()) + 'Z';

    var L = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PaiDeKai//Campus Scheduler//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:排得开 · 我的活动日程',
      'X-WR-TIMEZONE:Asia/Shanghai'
    ];

    state.schedule.forEach(function (e, i) {
      var bits = [];
      if (e.credit > 0) bits.push('二课学分 ' + fmt1(e.credit));
      if (e.volunteerHours > 0) bits.push('志愿时长 ' + fmt0(e.volunteerHours) + ' 小时');
      if (e.runKm > 0) bits.push('阳光乐跑 ' + fmt1(e.runKm) + ' km');
      if (e.tags.length) bits.push('标签：' + e.tags.join('、'));

      L.push('BEGIN:VEVENT');
      L.push('UID:pdk-' + e.id + '-' + i + '@paidekai');
      L.push('DTSTAMP:' + stamp);
      L.push('DTSTART:' + icsTime(e.d, e.start));
      L.push('DTEND:' + icsTime(e.d, e.end));
      L.push('SUMMARY:' + icsEsc(e.title));
      L.push('LOCATION:' + icsEsc(e.place));
      L.push('DESCRIPTION:' + icsEsc(bits.join(' / ')));
      L.push('BEGIN:VALARM');
      L.push('TRIGGER:-PT30M');
      L.push('ACTION:DISPLAY');
      L.push('DESCRIPTION:' + icsEsc('30 分钟后开始：' + e.title));
      L.push('END:VALARM');
      L.push('END:VEVENT');
    });

    L.push('END:VCALENDAR');
    return L.join('\r\n');
  }

  function downloadIcs() {
    if (!state.schedule.length) { toast('当前没有可导出的日程'); return; }

    var blob = new Blob([buildIcs()], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    downloadUrl(url, '排得开日程.ics');
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);

    toast('已导出 ' + state.schedule.length + ' 个日程，可导入钉钉日历');
  }

  /* ---------------- 截图导入 ---------------- */

  var shot = {
    kind: 'timetable',      // timetable | activities
    dataUrl: null,
    items: [],              // 视觉模型返回的条目
    picked: {},
    manualBusy: {},
    quick: []               // 对照录入时暂存的活动
  };

  var VISION_STORE = 'pdk.vision';

  function loadVision() {
    try {
      var raw = localStorage.getItem(VISION_STORE);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o.provider) state.vision.provider = o.provider;
      if (o.baseUrl) state.vision.baseUrl = normalizeBaseUrl(o.baseUrl);
      if (typeof o.key === 'string') state.vision.key = o.key;
      if (o.model) state.vision.model = o.model;
    } catch (e) { /* file:// 下 localStorage 可能不可用，忽略 */ }
  }

  function saveVision() {
    try { localStorage.setItem(VISION_STORE, JSON.stringify(state.vision)); } catch (e) {}
  }

  function dayIndex(s) {
    if (s == null) return -1;
    var m = String(s).match(/([一二三四五六日天])/);
    if (m) {
      var map = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6 };
      return map[m[1]];
    }
    var n = parseInt(s, 10);
    if (!isNaN(n) && n >= 1 && n <= 7) return n - 1;
    return -1;
  }

  function normTime(s) {
    if (!s) return '';
    var m = String(s).match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (!m) return '';
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return '';
    return pad2(h) + ':' + pad2(mi);
  }

  // 把起止时间落到上午 / 下午 / 晚上
  function slotsOf(start, end) {
    var a = toMin(start || '08:40');
    var b = toMin(end || '10:15');
    var out = [];
    if (a < 720) out.push('am');
    if (a < 1080 && b > 720) out.push('pm');
    if (b > 1080) out.push('eve');
    if (!out.length) out.push('am');
    return out;
  }

  function toEvent(it) {
    var d = dayIndex(it.day);
    var start = normTime(it.start) || '19:00';
    var end = normTime(it.end) || '21:00';
    if (toMin(end) <= toMin(start)) end = pad2(parseInt(start.split(':')[0], 10) + 2) + ':' + start.split(':')[1];

    var hay = (it.title || '') + ' ' + (it.tag || '') + ' ' + (it.place || '');
    var tags = detectTags(hay);
    if (!tags.length) tags = ['学术讲座'];

    return {
      id: 's' + (++uid),
      d: d,
      date: ymd(addDays(state.weekStart, d)),
      title: it.title || '未命名活动',
      type: detectType(hay),
      place: it.place || '待定',
      start: start,
      end: end,
      credit: Math.max(0, Number(it.credit) || 0),
      volunteerHours: Math.max(0, Number(it.hours) || 0),
      runKm: 0,
      capacity: Infinity,
      enrolled: 0,
      deadline: null,
      tags: tags,
      org: '截图导入',
      source: 'shot'
    };
  }

  function parseJsonLoose(text) {
    if (!text) return null;
    var s = String(text).trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function visionPrompt(kind) {
    if (kind === 'timetable') {
      return '这是一张中国大学课程表 App 的截图。按列是周一到周五，边上有时间刻度，每个色块是一门课。\n' +
        '提取每一门课，只输出 JSON，不要解释、不要 markdown 代码块：\n' +
        '{"items":[{"title":"高等数学 A1","day":"周二","start":"08:40","end":"10:15","place":"正心楼 518"}]}\n' +
        '规则：day 只能是 周一/周二/周三/周四/周五/周六/周日；start/end 用 24 小时制 HH:MM，' +
        '跨多个节次的课取最早上课时间与最晚下课时间；看不清的字段填空字符串；不要编造。';
    }
    return '这是「青春杭电」第二课堂平台的活动列表截图。每个卡片有标题、主办方、日期时间(如 2026-11-20 13:30-15:30)、标签和时长。\n' +
      '提取每个活动，只输出 JSON，不要解释、不要 markdown 代码块：\n' +
      '{"items":[{"title":"包饺子大赛","day":"周五","start":"13:30","end":"15:30","place":"五餐厅","credit":0,"hours":2}]}\n' +
      '规则：day 只能是 周一 到 周日；start/end 用 24 小时制 HH:MM；credit 是二课学分(分)，hours 是服务/志愿时长(小时)，没有就填 0；' +
      '图中没有地点的填空字符串；不要编造。';
  }

  // 1×1 透明 PNG，用来做"这个模型能不能看图"的最小探针
  var TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  // 兜底候选：账号里拉不到列表时给几个默认值。以控制台为准。
  var PRESET_MODELS = [
    'qwen3.7-plus', 'qwen4-max', 'qwen3.8-flash', 'qwen3-vl-plus',
    'kimi-latest', 'moonshot-v1-32k-vision-preview',
    'glm-4v-plus', 'Qwen/Qwen2.5-VL-72B-Instruct'
  ];

  // 常用服务的 Base URL（都填到版本号为止，不带 /chat/completions）
  // cors:false 表示实测不允许浏览器直连，选了会提示
  var PRESET_BASES = [
    { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', name: '阿里云百炼 · 国内站', cors: true },
    { url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', name: '阿里云百炼 · 国际站', cors: true },
    { url: 'https://open.bigmodel.cn/api/paas/v4', name: '智谱 GLM', cors: true },
    { url: 'https://api.siliconflow.cn/v1', name: '硅基流动', cors: true },
    { url: 'https://api.moonshot.cn/v1', name: '月之暗面 Kimi', cors: true },
    { url: 'https://api.openai.com/v1', name: 'OpenAI', cors: true },
    { url: 'https://ark.cn-beijing.volces.com/api/v3', name: '火山方舟 · 豆包（不支持网页直连）', cors: false },
    { url: 'http://localhost:11434/v1', name: '本地 Ollama', cors: true }
  ];

  function baseInfo(url) {
    var clean = normalizeBaseUrl(url);
    for (var i = 0; i < PRESET_BASES.length; i++) {
      if (normalizeBaseUrl(PRESET_BASES[i].url) === clean) return PRESET_BASES[i];
    }
    return null;
  }

  // 请求前的拦路检查，避免把「没填地址」误报成「网络问题」
  function baseProblem() {
    var b = normalizeBaseUrl(state.vision.baseUrl);
    if (!b) return '还没填 Base URL';
    if (!/^https?:\/\//i.test(b)) return 'Base URL 不是完整网址，要以 http:// 或 https:// 开头';
    return null;
  }

  // 网络不通 vs 被 CORS 拦，用一次"简单请求"区分开
  function explainNoResponse(base) {
    var b = normalizeBaseUrl(base) || 'https://127.0.0.1';

    // 已知不支持直连的，不用探了，直接说清楚
    var known = baseInfo(b);
    if (known && known.cors === false) {
      return Promise.resolve({
        title: '火山方舟 / 豆包 不支持网页直连',
        detail: '实测这个地址会拒绝浏览器的跨域请求 —— 不是你的 Key 问题，是它不开 CORS。<br>' +
                '<b>换 <a href="#" data-act="use-dashscope">阿里云百炼</a> 就行</b>（同样是通义千问的模型），' +
                '或者智谱、硅基流动、Kimi。'
      });
    }

    return fetch(b + '/models', { mode: 'no-cors', cache: 'no-store' })
      .then(function () { return true; })
      .catch(function () { return false; })
      .then(function (reachable) {
        if (reachable) {
          return {
            title: '这个地址不允许网页直连（CORS）',
            detail: '服务器能连通，但它没给浏览器开跨域许可。<br>' +
                    '<b>能直连的：</b>阿里云百炼 · 智谱 · 硅基流动 · Kimi · OpenAI · DeepSeek。<br>' +
                    '<b>不能直连的：</b>火山方舟 / 豆包 —— 只能用后端代理。'
          };
        }
        return {
          title: '网络根本连不上这个地址',
          detail: '域名写错、断网、或者被校园网/代理拦了。先检查 Base URL 是否完整，再换个网络试试。'
        };
      });
  }

  function scrollToStatus() {
    var box = document.getElementById('visStatus');
    if (box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }

  // 统一的失败处理：网络类问题异步细查，业务类问题直接翻译
  function handleVisionFailure(e) {
    if (!e || e.status === undefined) e = { status: 0, text: '', phase: 'image' };

    if (!e.status) {
      visSay('testing', '正在排查…', '先确认是不是网络问题');
      explainNoResponse(state.vision.baseUrl).then(function (info) {
        visSay('error', info.title, info.detail);
        scrollToStatus();
      });
      return;
    }

    var c = classifyVisionError(e.status, e.text, e.phase);
    visSay('error', c.title, c.detail);
    scrollToStatus();
  }

  // 用户经常把整个端点粘进来，这里统一收拾干净
  function normalizeBaseUrl(u) {
    var s = String(u || '').replace(/\s+/g, '');
    // 去掉误粘的完整路径
    s = s.replace(/\/(chat\/completions|completions|models|embeddings)\/?$/i, '');
    // 去掉多余斜杠
    s = s.replace(/\/+$/, '');
    return s;
  }

  function endpointHint() {
    var el = document.getElementById('vEndpoints');
    var raw = document.getElementById('vBase');
    if (!el || !raw) return;

    var clean = normalizeBaseUrl(raw.value);
    if (!clean) { el.innerHTML = '<span style="color:#B23A2A">Base URL 不能为空</span>'; return; }

    var fixed = (raw.value.trim() !== clean);
    var info = baseInfo(clean);
    var warn = (info && info.cors === false)
      ? '<br><span style="color:#B23A2A;font-weight:600">⚠ 这个地址实测不允许浏览器直连，请求会失败。换一家，或者加一层后端代理。</span>'
      : '';

    el.innerHTML =
      (fixed ? '已自动修正为 <code>' + esc(clean) + '</code> · ' : '') +
      '将调用 <code>POST ' + esc(clean) + '/chat/completions</code>' + warn;
  }

  function visSay(kind, title, detail) {
    var box = document.getElementById('visStatus');
    if (!box) return;
    box.className = 'vis-status ' + kind;
    box.innerHTML = '<b>' + esc(title) + '</b>' + (detail ? '<span>' + detail + '</span>' : '');
  }

  // 把 HTTP 状态码 + 响应体翻译成人能看懂的原因
  // 注意：判断顺序有讲究 —— DashScope 的 400 错误体里带 "type":"invalid_request_error"，
  // 如果先用宽松的 /model.*invalid/ 匹配，会把「模型不能看图」误判成「模型名不存在」。
  function classifyVisionError(status, text, phase) {
    var t = String(text || '');
    var low = t.toLowerCase();
    var raw = t ? '<code>' + esc(t.slice(0, 220)) + '</code>' : '';

    if (!status) {
      return {
        title: '请求没能发出去',
        detail: '多半是跨域（CORS）或网络问题 —— 有些厂商不允许浏览器直连。可以换一个允许直连的供应商，' +
                '或者加一层自己的后端代理。'
      };
    }
    if (status === 401 || status === 403) {
      return { title: 'API Key 无效或没权限', detail: '检查 Key 是否复制完整、是否属于这个 Base URL 对应的账号。' + raw };
    }

    var notVision = /does not support image|not support image|image input|image_url|multimodal|vision|unsupported content|content.{0,12}type/.test(low);
    var noModel = /model.{0,30}(does not exist|not exist|not found|no such|unknown|invalid model)/.test(low) ||
                  /(invalid|unknown) model/.test(low);

    if (phase === 'image' && notVision) {
      return {
        title: '这个模型不能看图',
        detail: '「' + esc(state.vision.model) + '」收到图片就报错了 —— 它是纯文本模型。' +
                'DeepSeek 系列、以及多数不带 VL / vision 标识的模型都不支持图像输入。换一个多模态模型。' + raw
      };
    }
    if (status === 404 || noModel) {
      return {
        title: '模型名不存在',
        detail: '这个 Base URL 下没有「' + esc(state.vision.model) + '」。' +
                '点「拉取可用模型」让它自己列出你能用的型号，或去控制台复制准确的模型 ID。' + raw
      };
    }
    if (phase === 'image' && status === 400) {
      return {
        title: '这个模型不能看图（HTTP 400）',
        detail: '换一个多模态模型试试，比如带 VL 的那几个。' + raw
      };
    }
    return { title: '请求失败（HTTP ' + status + '）', detail: raw || '接口没有返回可读的错误信息。' };
  }

  function runVisionTest() {
    var cfg = state.vision;
    if (!cfg.key) {
      visSay('error', '还没填 API Key', '展开上面填好 Key，再点测试。或者直接用下面的对照录入。');
      return;
    }
    var bp = baseProblem();
    if (bp) { visSay('error', '地址有问题', bp); return; }
    if (!cfg.model) { visSay('error', '模型没填', '点「拉取模型列表」挑一个，或手工填。'); return; }

    var url = normalizeBaseUrl(cfg.baseUrl) + '/chat/completions';

    function post(body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify(body)
      }).catch(function () { throw { status: 0, text: '', phase: 'text' }; });
    }

    visSay('testing', '第 1 步：确认 Key 和模型名', '发一个纯文字请求');

    return post({
      model: cfg.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 4
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw { status: res.status, text: t, phase: 'text' }; });
      }
      return res.json();
    }).then(function () {
      visSay('testing', '第 2 步：确认能不能看图', '发一个 1×1 图片探针');
      return post({
        model: cfg.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么颜色？只回答颜色。' },
            { type: 'image_url', image_url: { url: TINY_PNG } }
          ]
        }],
        max_tokens: 16
      }).catch(function () { throw { status: 0, text: '', phase: 'image' }; });
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw { status: res.status, text: t, phase: 'image' }; });
      }
      return res.json();
    }).then(function (json) {
      var out = json && json.choices && json.choices[0] && json.choices[0].message &&
                json.choices[0].message.content;
      visSay('ok', '配置可用',
        '鉴权、模型名、图像输入三项都通过了。' + (out ? '探针回了一句：' + esc(String(out).slice(0, 24)) : ''));
      toast('视觉模型连接正常');
    }).catch(function (e) {
      handleVisionFailure(e);
    });
  }

  /* 默认只露三格：服务商 / Key / 连接。其余全塞进「高级」。
     选服务商 → 贴 Key → 点连接：拉模型、挑一个能读图的、自动测通，全自动。 */

  var PROVIDERS = [
    { id: 'dashscope', name: '阿里云百炼 · 通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apply: 'https://bailian.console.aliyun.com/', model: 'qwen3.7-plus' },
    { id: 'kimi', name: '月之暗面 Kimi', base: 'https://api.moonshot.cn/v1',
      apply: 'https://platform.moonshot.cn/console/api-keys', model: '' },
    { id: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4',
      apply: 'https://open.bigmodel.cn/usercenter/apikeys', model: '' },
    { id: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1',
      apply: 'https://cloud.siliconflow.cn/account/ak', model: '' },
    { id: 'custom', name: '自定义…', base: '', apply: '', model: '' }
  ];

  function currentProvider() {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === state.vision.provider) return PROVIDERS[i];
    }
    return PROVIDERS[0];
  }

  // 从模型清单里挑"最可能能读图"的排前面
  function rankModels(ids) {
    function score(id) {
      var s = 0;
      if (/vl|vision|omni|multimodal/i.test(id)) s += 100;
      if (/qwen3\.\d|qwen4|gpt-4|gpt-5|claude|gemini|glm-4|doubao/i.test(id)) s += 40;
      if (/max|plus|pro/i.test(id)) s += 20;
      if (/embedding|rerank|tts|asr|audio|speech|image-gen|wanx|cosyvoice|ocr/i.test(id)) s -= 200;
      return s;
    }
    return ids.slice().sort(function (a, b) { return score(b) - score(a) || a.localeCompare(b); });
  }

  // 一个模型跑两步探针：先纯文字确认可用，再发 1×1 图片确认能读图
  function probeModel(model) {
    var cfg = state.vision;
    var url = normalizeBaseUrl(cfg.baseUrl) + '/chat/completions';

    function post(body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify(body)
      }).catch(function () { throw { status: 0, text: '', phase: 'text' }; });
    }

    function check(res, phase) {
      if (res.ok) return res.json();
      return res.text().then(function (t) { throw { status: res.status, text: t, phase: phase }; });
    }

    return post({ model: model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 })
      .then(function (res) { return check(res, 'text'); })
      .then(function () {
        return post({
          model: model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: '这张图是什么颜色？只回答颜色。' },
              { type: 'image_url', image_url: { url: TINY_PNG } }
            ]
          }],
          max_tokens: 16
        });
      })
      .then(function (res) { return check(res, 'image'); });
  }

  function tryCandidates(list, i, lastErr) {
    if (i >= list.length) {
      var c = classifyVisionError(lastErr && lastErr.status, lastErr && lastErr.text, lastErr && lastErr.phase);
      visSay('error', '试了 ' + list.length + ' 个都不行：' + c.title,
        c.detail + '<br>可以换一个服务商，或在下面「高级」里手工填模型。');
      return;
    }

    var m = list[i];
    state.vision.model = m;
    visSay('testing', '正在试 ' + m, '第 ' + (i + 1) + ' / ' + list.length + ' 个候选');

    return probeModel(m).then(function () {
      saveVision();
      renderVisionCfg();
      visSay('ok', '接好了：' + m,
        '以后点「AI 自动识别」就能直接读截图，不用再管这些设置。');
      toast('已接入 ' + m);
    }).catch(function (e) {
      return tryCandidates(list, i + 1, e);
    });
  }

  function quickConnect() {
    var keyEl = document.getElementById('vKey');
    var key = keyEl ? keyEl.value.trim() : state.vision.key;

    if (!key) {
      visSay('error', '先贴一个 API Key', '去 ' +
        '<a href="' + esc(currentProvider().apply) + '" target="_blank" rel="noopener">服务商控制台</a> 注册，' +
        '复制 Key 粘进来就可以。');
      return;
    }

    state.vision.key = key;
    if (!state.vision.baseUrl) {
      state.vision.baseUrl = currentProvider().base;
    }
    var bp = baseProblem();
    if (bp) { visSay('error', '地址有问题', bp); return; }
    saveVision();

    visSay('testing', '第 1 步：拉取可用模型', esc(normalizeBaseUrl(state.vision.baseUrl) + '/models'));

    return fetch(normalizeBaseUrl(state.vision.baseUrl) + '/models', {
      headers: { 'Authorization': 'Bearer ' + state.vision.key }
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw { status: res.status, text: t, phase: 'models' }; });
      }
      return res.json();
    }).then(function (json) {
      var arr = (json && (json.data || json.models)) || [];
      var ids = arr.map(function (m) {
        return typeof m === 'string' ? m : (m && (m.id || m.name)) || '';
      }).filter(Boolean);

      if (!ids.length) throw { status: 0, text: '', phase: 'models-empty' };

      state.visionModels = ids;
      return tryCandidates(rankModels(ids).slice(0, 4), 0);
    }).catch(function (e) {
      if (!e || e.status === undefined) e = { status: 0, text: '', phase: 'models' };

      if (e.phase === 'models-empty') {
        visSay('error', '接口通了，但没返回模型', '到「高级」里手工填模型 ID。');
        return;
      }
      if (e.status === 404) {
        visSay('error', '这个服务商不提供模型列表', '到「高级」里把 Base URL 和模型填好，再点「测试连接」。');
        return;
      }
      handleVisionFailure(e);
    });
  }

  function renderVisionCfg() {
    var box = document.getElementById('visCfgBody');
    if (!box) return;

    var prov = currentProvider();
    var provOpts = PROVIDERS.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === prov.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');

    var pool = (state.visionModels && state.visionModels.length) ? state.visionModels : PRESET_MODELS;
    var modelOpts = pool.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('');
    var baseOpts = PRESET_BASES.map(function (b) {
      return '<option value="' + esc(b.url) + '" label="' + esc(b.name) + '"></option>';
    }).join('');

    var linked = !!state.vision.key && !!state.vision.model;

    box.innerHTML =
      '<div class="vision-row"><span>服务商</span><select id="vProvider">' + provOpts + '</select></div>' +
      '<div class="vision-row"><span>API Key</span><input id="vKey" type="password" value="' + esc(state.vision.key) + '" placeholder="粘贴 Key" spellcheck="false"></div>' +
      '<div class="shot-actions">' +
        '<button class="btn primary" type="button" data-act="quick-connect">连接</button>' +
        '<span class="shot-hint">选服务商 → 贴 Key → 连接，剩下的它自己试</span>' +
      '</div>' +
      '<p class="shot-hint" style="margin:0">还没有 Key？去 ' +
        (prov.apply ? '<a href="' + esc(prov.apply) + '" target="_blank" rel="noopener">' + esc(prov.name) + '控制台</a> ' : '服务商控制台 ') +
        '注册一个，几分钟就能拿到。</p>' +
      '<details class="vision-adv">' +
        '<summary>高级：Base URL / 模型</summary>' +
        '<div class="adv-body">' +
          '<div class="vision-row"><span>Base URL</span><input id="vBase" list="vBaseList" value="' + esc(state.vision.baseUrl) + '" spellcheck="false">' +
            '<datalist id="vBaseList">' + baseOpts + '</datalist></div>' +
          '<p class="shot-hint" id="vEndpoints" style="margin:0"></p>' +
          '<div class="vision-row"><span>模型</span><input id="vModel" list="vModelList" value="' + esc(state.vision.model) + '" spellcheck="false">' +
            '<datalist id="vModelList">' + modelOpts + '</datalist></div>' +
          '<div class="shot-actions">' +
            '<button class="btn ghost" type="button" data-act="save-vision">保存</button>' +
            '<button class="btn ghost" type="button" data-act="test-vision">测试连接</button>' +
            '<button class="btn ghost" type="button" data-act="models">拉取模型列表</button>' +
          '</div>' +
        '</div>' +
      '</details>' +
      '<div class="vis-status ' + (linked ? 'ok' : 'idle') + '" id="visStatus"><b>' +
        (linked ? '已接入 ' + esc(state.vision.model) : '未接入') + '</b><span>' +
        (linked ? '点上面的「连接」可以重新校验，或直接去识别截图。'
                : '不接也能用 —— 下面的格子照着截图点，一样能把课表录进来。') +
      '</span></div>';

    var sel = document.getElementById('vProvider');
    if (sel) {
      sel.addEventListener('change', function () {
        state.vision.provider = this.value;
        var p = currentProvider();
        if (p.base) state.vision.baseUrl = p.base;
        // 换服务商就清掉旧模型名，免得拿通义的模型去问 Kimi
        state.vision.model = p.model || '';
        state.visionModels = [];
        saveVision();
        renderVisionCfg();
        if (state.vision.key && !state.vision.model) {
          visSay('idle', '已切到 ' + p.name, '点「连接」，它会自动拉模型清单并挑一个能读图的。');
        }
      });
    }

    var keyInput = document.getElementById('vKey');
    if (keyInput) {
      keyInput.addEventListener('change', function () {
        state.vision.key = this.value.trim();
        saveVision();
      });
    }

    var baseInput = document.getElementById('vBase');
    if (baseInput) baseInput.addEventListener('input', endpointHint);
    endpointHint();
  }

  function saveVisionFromDom() {
    var b = document.getElementById('vBase');
    var m = document.getElementById('vModel');
    if (b) state.vision.baseUrl = normalizeBaseUrl(b.value);
    if (m) state.vision.model = m.value.trim();
    var k = document.getElementById('vKey');
    if (k) state.vision.key = k.value.trim();
    saveVision();
    renderVisionCfg();
    toast('已保存');
  }

  // 直接问接口要模型清单 —— 比在这里硬编码模型名靠谱得多
  function fetchModelList() {
    var cfg = state.vision;
    if (!cfg.key) { visSay('error', '还没填 API Key', '拉取模型列表需要先填 Key。'); return; }
    var bp = baseProblem();
    if (bp) { visSay('error', '地址有问题', bp); return; }

    var url = normalizeBaseUrl(cfg.baseUrl) + '/models';
    visSay('testing', '正在拉取模型列表…', esc(url));

    return fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.key }
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw { status: res.status, text: t, phase: 'models' }; });
      }
      return res.json();
    }).then(function (json) {
      var arr = (json && (json.data || json.models)) || [];
      var ids = arr.map(function (m) {
        return typeof m === 'string' ? m : (m && (m.id || m.name)) || '';
      }).filter(Boolean);

      if (!ids.length) throw { status: 0, text: '', phase: 'models-empty' };

      ids.sort(function (a, b) {
        var av = /vl|vision|omni/i.test(a) ? 0 : 1;
        var bv = /vl|vision|omni/i.test(b) ? 0 : 1;
        return av - bv || a.localeCompare(b);
      });

      state.visionModels = ids;
      var dl = document.getElementById('vModelList');
      if (dl) dl.innerHTML = ids.map(function (id) { return '<option value="' + esc(id) + '"></option>'; }).join('');

      visSay('ok', '拉到 ' + ids.length + ' 个可用模型',
        '点「模型」输入框会直接弹出列表，输入前缀可以过滤。先挑一个再点「测试连接」。' +
        '<code>' + esc(ids.slice(0, 16).join('   ·   ')) + '</code>');
      toast('拉到 ' + ids.length + ' 个模型');
    }).catch(function (e) {
      if (!e || e.status === undefined) e = { status: 0, text: '', phase: 'models' };

      if (e.phase === 'models-empty') {
        visSay('error', '接口通了，但没返回模型',
          '这个 Base URL 可能不提供 <code>/models</code>。直接去控制台复制模型 ID 填进「模型」。');
      } else if (e.status === 404) {
        visSay('error', '这个 Base URL 不提供模型列表',
          '没有 <code>/models</code> 这个接口。去控制台复制模型 ID 手工填。');
      } else {
        handleVisionFailure(e);
      }
    });
  }

  /* ---- 弹窗开合 ---- */

  function setShotKind(kind) {
    shot.kind = kind;
    shot.items = [];
    shot.picked = {};
    document.querySelectorAll('#shotTabs .stab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-kind') === kind);
    });
    if (shot.dataUrl) renderShotPanel();
  }

  function openShot(kind) {
    shot.dataUrl = null;
    shot.items = [];
    shot.picked = {};
    shot.quick = [];
    shot.manualBusy = {};
    state.busy.forEach(function (k) { shot.manualBusy[k] = 1; });

    setShotKind(kind || 'timetable');

    document.getElementById('dropZone').hidden = false;
    document.getElementById('shotGrid').hidden = true;
    var res = document.getElementById('shotResult');
    if (res) res.innerHTML = '';
    document.getElementById('modalShot').hidden = false;
  }

  function loadShotFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('请选择图片文件'); return; }

    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        // 等比缩到最长边 1500，控制 base64 体积，也够模型看清字
        var max = 1500;
        var w = img.width, h = img.height;
        var scale = Math.min(1, max / Math.max(w, h));
        if (scale < 1) { w = Math.round(w * scale); h = Math.round(h * scale); }

        var cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);

        shot.dataUrl = cv.toDataURL('image/jpeg', 0.86);
        showShotWork();
        toast('已载入截图 ' + w + '×' + h);
      };
      img.onerror = function () { toast('图片解码失败'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function showShotWork() {
    document.getElementById('dropZone').hidden = true;
    document.getElementById('shotGrid').hidden = false;
    document.getElementById('shotBig').src = shot.dataUrl;
    renderShotPanel();
  }

  /* ---- 右侧面板 ---- */

  function renderShotPanel() {
    var panel = document.getElementById('shotPanel');
    if (!panel) return;

    var visionBlock =
      '<details class="vision-cfg">' +
        '<summary>自动识别（可选 · 贴一个 API Key 就能用）</summary>' +
        '<div class="vision-body" id="visCfgBody"></div>' +
      '</details>';

    var head =
      '<div class="shot-actions">' +
        '<button class="btn primary" type="button" data-act="vision">AI 自动识别</button>' +
        '<button class="btn ghost" type="button" data-act="reset">换一张</button>' +
      '</div>' +
      '<p class="shot-hint">' +
        (state.vision.key
          ? '已接入 <b>' + esc(state.vision.model) + '</b>，点上面的按钮自动抽取。'
          : '不接也能用：照着左边的截图点选 / 填写，零依赖、不联网。想全自动再配 API Key。') +
      '</p>';

    var body;

    if (shot.kind === 'timetable') {
      var grid = '<div class="mini-grid" id="miniGrid">';
      grid += '<div class="mh"></div>';
      WD.forEach(function (w) { grid += '<div class="mh">' + w.slice(1) + '</div>'; });
      [['am', '上午'], ['pm', '下午'], ['eve', '晚上']].forEach(function (row) {
        grid += '<div class="mr">' + row[1] + '</div>';
        for (var d = 0; d < 7; d++) {
          var k = d + '-' + row[0];
          grid += '<button type="button" class="mini-cell" data-mini="' + k + '" aria-pressed="' +
                  (shot.manualBusy[k] ? 'true' : 'false') + '"></button>';
        }
      });
      grid += '</div>';

      body =
        grid +
        '<div class="shot-actions">' +
          '<button class="btn primary" type="button" data-act="apply-grid">应用这些占用时段</button>' +
          '<span class="shot-hint">对着左边的截图点选，比翻课表快</span>' +
        '</div>' +
        '<div id="shotResult"></div>';
    } else {
      body =
        '<div class="shot-form" id="quickForm">' +
          '<label class="full"><span>活动名称</span><input id="qTitle" placeholder="照抄截图里的标题"></label>' +
          '<label><span>星期</span><select id="qDay">' +
            WD.map(function (w, i) { return '<option value="' + i + '">' + w + '</option>'; }).join('') +
          '</select></label>' +
          '<label><span>地点</span><input id="qPlace" placeholder="五餐厅"></label>' +
          '<label><span>开始</span><input id="qStart" placeholder="13:30"></label>' +
          '<label><span>结束</span><input id="qEnd" placeholder="15:30"></label>' +
          '<label><span>二课学分</span><input id="qCredit" type="number" step="0.1" value="0"></label>' +
          '<label><span>志愿时长(h)</span><input id="qHours" type="number" step="0.5" value="0"></label>' +
        '</div>' +
        '<div class="shot-actions">' +
          '<button class="btn ghost" type="button" data-act="quick-add">加入一条</button>' +
          '<span class="shot-hint">加一条就在下面显示会不会撞车</span>' +
        '</div>' +
        '<div class="mini-list" id="quickList"></div>' +
        '<div class="shot-actions">' +
          '<button class="btn primary" type="button" data-act="quick-apply">把已录入的活动加入活动池</button>' +
        '</div>' +
        '<div id="shotResult"></div>';
    }

    panel.innerHTML = visionBlock + head + body;
    renderVisionCfg();
    renderQuickList();
    renderShotResult();
  }

  /* ---- 对照录入：活动 ---- */

  function renderQuickList() {
    var box = document.getElementById('quickList');
    if (!box) return;

    if (!shot.quick.length) {
      box.innerHTML = '<div class="shot-hint">还没有录入。照着左侧截图填一条，回车即可。</div>';
      return;
    }

    box.innerHTML = shot.quick.map(function (e, i) {
      var c = conflictOf(e);
      var tag = '';
      if (c) {
        if (c.kind === 'busy') tag = '撞课';
        else if (c.kind === 'time') tag = '撞「' + (c.other.title || '').slice(0, 8) + '」';
        else if (c.kind === 'travel') tag = '转场紧';
        else tag = '排太满';
      }
      return '<div class="mini-item">' +
        '<span><span class="t">' + esc(e.title) + '</span>' +
          '<span class="m">' + WD[e.d] + ' ' + e.start + '–' + e.end +
          ' · ' + esc(e.place) + (tag ? ' · <b style="color:#C0392B">' + esc(tag) + '</b>' : '') + '</span></span>' +
        '<button class="x" type="button" data-del="' + i + '">✕</button>' +
      '</div>';
    }).join('');
  }

  function quickAdd() {
    var title = document.getElementById('qTitle').value.trim();
    var start = normTime(document.getElementById('qStart').value);
    var end = normTime(document.getElementById('qEnd').value);

    if (!title) { toast('先填活动名称'); return; }
    if (!start || !end) { toast('时间填成 HH:MM，例如 13:30'); return; }
    if (toMin(end) <= toMin(start)) { toast('结束要晚于开始'); return; }

    var e = toEvent({
      title: title,
      day: WD[parseInt(document.getElementById('qDay').value, 10)],
      start: start,
      end: end,
      place: document.getElementById('qPlace').value.trim(),
      credit: parseFloat(document.getElementById('qCredit').value) || 0,
      hours: parseFloat(document.getElementById('qHours').value) || 0
    });
    e.id = 'q' + (++uid);

    shot.quick.push(e);
    renderQuickList();

    document.getElementById('qTitle').value = '';
    document.getElementById('qPlace').value = '';
    document.getElementById('qStart').value = '';
    document.getElementById('qEnd').value = '';
    document.getElementById('qTitle').focus();
  }

  function quickApply() {
    if (!shot.quick.length) { toast('还没有录入任何活动'); return; }

    shot.quick.forEach(function (e) { e.custom = true; state.events.push(e); });
    var n = shot.quick.length;

    state.sources.erke.synced = true;
    state.sources.erke.at = new Date();
    state.sources.erke.imported = n;

    document.getElementById('modalShot').hidden = true;
    regenerate();
    toast('已加入 ' + n + ' 条活动，日程已增量重排');
  }

  /* ---- AI 识别 ---- */

  function runVision() {
    var btn = document.querySelector('#shotPanel [data-act="vision"]');

    if (!shot.dataUrl) { toast('先放一张截图'); return Promise.resolve(); }
    if (!state.vision.key) {
      var cfg = document.querySelector('.vision-cfg');
      if (cfg && !cfg.open) cfg.open = true;
      var st = document.getElementById('visStatus');
      if (st && st.scrollIntoView) st.scrollIntoView({ block: 'nearest' });
      visSay('error', '还没接入自动识别', '选服务商、贴一个 API Key，点「连接」就好。不接也能用下面的格子手动录入。');
      return Promise.resolve();
    }

    var bp = baseProblem();
    if (bp) {
      var cfgEl = document.querySelector('.vision-cfg');
      if (cfgEl && !cfgEl.open) cfgEl.open = true;
      visSay('error', '地址有问题', bp);
      scrollToStatus();
      return Promise.resolve();
    }

    if (btn) { btn.disabled = true; btn.textContent = '识别中…'; }

    var url = normalizeBaseUrl(state.vision.baseUrl) + '/chat/completions';

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.vision.key
      },
      body: JSON.stringify({
        model: state.vision.model,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: visionPrompt(shot.kind) },
            { type: 'image_url', image_url: { url: shot.dataUrl } }
          ]
        }]
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw { status: res.status, text: t, phase: 'image' };
        });
      }
      return res.json();
    }).then(function (json) {
      var content = json && json.choices && json.choices[0] &&
                    json.choices[0].message && json.choices[0].message.content;
      var data = parseJsonLoose(content);
      if (!data || !Array.isArray(data.items) || !data.items.length) {
        throw { status: 0, text: '', phase: 'parse', content: String(content || '') };
      }
      shot.items = data.items;
      shot.picked = {};
      shot.items.forEach(function (_, i) { shot.picked[i] = 1; });
      renderShotResult();
      visSay('ok', '识别成功', '抽到 ' + shot.items.length + ' 条，逐条过目后再应用。');
      toast('识别到 ' + shot.items.length + ' 条');
    }).catch(function (e) {
      if (!e || e.status === undefined) {
        e = { status: 0, text: '', phase: 'image' };
      }
      if (e.phase === 'parse') {
        visSay('error', '模型连通，但返回的不是合法 JSON',
          '多试一次通常就好；还是不行就换更强的模型，或者改用对照录入。' +
          '<code>' + esc(String(e.content).slice(0, 220)) + '</code>');
        scrollToStatus();
      } else {
        handleVisionFailure(e);
      }
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'AI 自动识别'; }
    });
  }

  /* ---- 结果预览与应用 ---- */

  function renderShotResult() {
    var box = document.getElementById('shotResult');
    if (!box) return;

    if (!shot.items.length) { box.innerHTML = ''; return; }

    var isTt = shot.kind === 'timetable';

    var rows = shot.items.map(function (it, i) {
      var d = dayIndex(it.day);
      var start = normTime(it.start), end = normTime(it.end);
      var ok = d >= 0 && !!start && !!end;

      var e = ok ? toEvent(it) : null;
      var meta, flag, cls, preCheck = ok;

      if (!ok) {
        meta = '未识别到日期或时间';
        flag = '需修正'; cls = 'flag-bad';
      } else {
        meta = WD[d] + ' ' + start + '–' + end + (it.place ? ' · ' + it.place : '');

        if (isTt) {
          flag = slotsOf(start, end).map(function (s) { return SLOT_LABEL[s]; }).join(' + ');
          cls = 'flag-ok';
        } else {
          var c = conflictOf(e);
          if (!c) { flag = '可加入'; cls = 'flag-ok'; }
          else {
            // 与「文字批量导入」保持一致：冲突项默认不勾选，由用户自己决定要不要硬报
            preCheck = false;
            if (c.kind === 'busy') { flag = '与课程冲突'; }
            else if (c.kind === 'time') { flag = '与「' + c.other.title + '」冲突'; }
            else if (c.kind === 'travel') { flag = '转场来不及'; }
            else { flag = '当天排太满'; }
            cls = 'flag-clash';
          }
        }
      }

      return '<label class="brow' + (ok ? '' : ' bad') + '">' +
        '<input type="checkbox" data-i="' + i + '"' + (preCheck ? ' checked' : '') + (ok ? '' : ' disabled') + '>' +
        '<span><span class="brow-t">' + esc(it.title || '未命名') + '</span>' +
        '<span class="brow-m">' + esc(meta) + '</span></span>' +
        '<span class="brow-flag ' + cls + '">' + esc(flag) + '</span>' +
      '</label>';
    }).join('');

    box.innerHTML =
      '<div class="batch-list">' + rows + '</div>' +
      '<div class="batch-foot">' +
        '<button class="btn primary" type="button" data-act="apply-vision">应用勾选的条目</button>' +
        '<span class="hint">识别结果先给你过目 —— AI 只负责抽，改不改由你定</span>' +
      '</div>';
  }

  function pickedItems() {
    var out = [];
    document.querySelectorAll('#shotResult input[type="checkbox"]').forEach(function (cb) {
      if (cb.checked && !cb.disabled) out.push(shot.items[parseInt(cb.getAttribute('data-i'), 10)]);
    });
    return out;
  }

  function applyVision() {
    var list = pickedItems();
    if (!list.length) { toast('没有勾选任何条目'); return; }

    if (shot.kind === 'timetable') {
      var keys = {};
      list.forEach(function (it) {
        var d = dayIndex(it.day);
        if (d < 0) return;
        slotsOf(normTime(it.start), normTime(it.end)).forEach(function (s) { keys[d + '-' + s] = 1; });
      });
      var n = Object.keys(keys).length;
      if (!n) { toast('没有可用的时段'); return; }

      state.busy = Object.keys(keys);
      state.sources.dingtalk.synced = true;
      state.sources.dingtalk.at = new Date();
      renderPanel();
      regenerate();
      document.getElementById('modalShot').hidden = true;
      toast('已按截图导入 ' + n + ' 个占用时段');
      return;
    }

    var added = 0;
    list.forEach(function (it) {
      var d = dayIndex(it.day);
      if (d < 0 || !normTime(it.start)) return;
      var ev = toEvent(it);
      ev.custom = true;
      state.events.push(ev);
      added++;
    });
    if (!added) { toast('没有可加入的条目'); return; }

    state.sources.erke.synced = true;
    state.sources.erke.at = new Date();
    state.sources.erke.imported = added;
    document.getElementById('modalShot').hidden = true;
    regenerate();
    toast('已导入 ' + added + ' 条活动');
  }

  function applyMiniGrid() {
    var keys = Object.keys(shot.manualBusy).filter(function (k) { return shot.manualBusy[k]; });
    state.busy = keys;
    state.sources.dingtalk.synced = true;
    state.sources.dingtalk.at = new Date();
    renderPanel();
    regenerate();
    document.getElementById('modalShot').hidden = true;
    toast('已应用 ' + keys.length + ' 个占用时段');
  }

  /* ============================================================
     作业清单
     ============================================================ */

  function renderTodo() {
    var wrap = document.getElementById('todoList');
    if (!wrap) return;

    var pending = state.tasks.filter(function (t) { return !t.done; });

    pending.sort(function (a, b) {
      if (!!b.fav !== !!a.fav) return b.fav ? 1 : -1;     // 收藏的排最前
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due - b.due;
    });

    updateTodoStats();

    if (!pending.length) {
      wrap.innerHTML = '<div class="todo-empty">' +
        (state.tasks.length ? '全清完了，出去走走吧 🎉' : '还没有作业。点右上角「导入作业」，让 AI 帮你整理。') +
        '</div>';
      return;
    }

    wrap.innerHTML = pending.map(function (t) {
      var info = dueInfo(t);
      var meta = [];
      if (t.course) meta.push(esc(t.course));
      if (t.due) {
        meta.push((t.due.getMonth() + 1) + '/' + t.due.getDate() +
                  ' ' + pad2(t.due.getHours()) + ':' + pad2(t.due.getMinutes()));
      }

      return '<div class="td" data-id="' + t.id + '">' +
               '<button type="button" class="td-check" aria-pressed="false" aria-label="标记完成"></button>' +
               '<div class="td-main">' +
                 '<span class="td-title">' + esc(t.title) + '</span>' +
                 '<span class="td-meta">' + (meta.join(' · ') || '没写课程和截止') + '</span>' +
               '</div>' +
               starBtn(t) +
               '<span class="td-badge ' + info.kind + '">' + esc(info.label) + '</span>' +
             '</div>';
    }).join('');
  }

  function updateTodoStats() {
    var countEl = document.getElementById('todoCount');
    var barEl = document.getElementById('todoBar');
    if (!countEl || !barEl) return;

    var total = state.tasks.length;
    var doneN = state.tasks.filter(function (t) { return t.done; }).length;

    countEl.textContent = doneN + ' / ' + total;
    barEl.style.width = total ? (doneN / total * 100).toFixed(1) + '%' : '0%';
  }

  // 勾掉一项：先划掉，再缩起来消失，进度条同时往前走
  function completeTask(id, row) {
    var t = null;
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) { t = state.tasks[i]; break; }
    }
    if (!t || t.done) return;

    t.done = true;

    var chk = row.querySelector('.td-check');
    if (chk) chk.setAttribute('aria-pressed', 'true');

    var badge = row.querySelector('.td-badge');
    if (badge) { badge.className = 'td-badge done'; badge.textContent = '搞定'; }

    row.classList.add('done');
    updateTodoStats();

    var left = state.tasks.filter(function (x) { return !x.done; }).length;
    toast(left ? '完成一项，还剩 ' + left + ' 项' : '全清完了，厉害 🎉');

    setTimeout(function () { row.classList.add('leaving'); }, 380);
    setTimeout(function () {
      renderTodo();
      if (!left) checkTaskWarning();
    }, 900);
  }

  // 打开页面时，把最急的作业顶到脸上
  function checkTaskWarning(force) {
    if (!force && (!store || !store.current)) return;
    var overdue = tasksOf('overdue');
    var urgent = tasksOf('urgent');
    if (!overdue.length && !urgent.length) return;

    var list = overdue.concat(urgent).slice(0, 4);

    document.getElementById('warnTitle').textContent = overdue.length ? '有作业已经过期了' : '有作业快到期了';
    document.getElementById('warnSub').textContent = overdue.length
      ? '先把这个补上，别拖到最后一天'
      : '现在处理，还来得及';

    document.getElementById('warnList').innerHTML = list.map(function (t) {
      var info = dueInfo(t);
      return '<li class="' + (info.kind === 'overdue' ? 'overdue' : '') + '">' +
               '<span class="wt"><b>' + esc(t.title) + '</b>' +
                 (t.course ? ' · ' + esc(t.course) : '') + '</span>' +
               '<span class="wd">' + esc(info.label) + '</span>' +
             '</li>';
    }).join('');

    document.getElementById('modalWarn').hidden = false;
  }

  function parseTaskLines(text) {
    return String(text || '').split(/\r?\n/).map(function (line) {
      var s = line.trim();
      if (!s) return null;
      s = s.replace(/^[-*•·]\s*/, '').replace(/^\d{1,2}\s*[.、)）]\s*/, '');
      if (!s) return null;

      var parts = s.split(/\s*[|｜\t]\s*/);

      if (parts.length === 1) {
        // 没有分隔符就试着从末尾抠出日期
        var m = s.match(/(\d{4}\s*[-\/.]\s*\d{1,2}\s*[-\/.]\s*\d{1,2}(\s+\d{1,2}\s*[:：]\s*\d{2})?|\d{1,2}\s*[-\/月]\s*\d{1,2}\s*日?(\s+\d{1,2}\s*[:：]\s*\d{2})?)\s*$/);
        if (m) {
          return { title: s.slice(0, m.index).trim(), due: parseDue(m[1]), course: '' };
        }
        return { title: s, due: null, course: '' };
      }

      return { title: parts[0].trim(), due: parseDue(parts[1] || ''), course: (parts[2] || '').trim() };
    }).filter(function (x) { return x && x.title; });
  }

  function parseTasksInto() {
    var raw = document.getElementById('taskText').value;
    var box = document.getElementById('taskResult');
    var items = [];

    // 优先当 AI 返回的 JSON 处理
    var json = parseJsonLoose(raw);
    var arr = json ? (json.tasks || json.items || (Array.isArray(json) ? json : null)) : null;

    if (arr && arr.length) {
      items = arr.map(function (it) {
        if (typeof it === 'string') return { title: it, due: null, course: '' };
        return {
          title: String(it.title || it.name || '').trim(),
          course: String(it.course || it.subject || '').trim(),
          due: parseDue(it.due || it.deadline || '')
        };
      }).filter(function (x) { return x.title; });
    } else {
      items = parseTaskLines(raw);
    }

    if (!items.length) {
      box.innerHTML = '<div class="pr-warn">没有识别出作业。每行一条，用 <b>|</b> 分隔标题和截止时间，例如：<br>' +
                      '<code>第十章习题 | 11-23 18:00 | 高等数学</code></div>';
      box.hidden = false;
      return;
    }

    box.innerHTML =
      '<div class="batch-list">' +
        items.map(function (it) {
          return '<div class="brow">' +
                   '<span></span>' +
                   '<span><span class="brow-t">' + esc(it.title) + '</span>' +
                   '<span class="brow-m">' + (it.course ? esc(it.course) + ' · ' : '') +
                     (it.due ? (it.due.getMonth() + 1) + '/' + it.due.getDate() + ' ' +
                               pad2(it.due.getHours()) + ':' + pad2(it.due.getMinutes()) : '没写截止') +
                   '</span></span>' +
                   '<span class="brow-flag flag-ok">待加入</span>' +
                 '</div>';
        }).join('') +
      '</div>' +
      '<div class="batch-foot">' +
        '<button class="btn primary" type="button" id="btnTaskAdd">加入清单（' + items.length + ' 条）</button>' +
        '<span class="hint">加进去就能勾掉了</span>' +
      '</div>';
    box.hidden = false;

    document.getElementById('btnTaskAdd').addEventListener('click', function () {
      items.forEach(function (it) { addTask(it.title, it.course, it.due, true); });
      closeAllModals();
      renderTodo();
      toast('加了 ' + items.length + ' 条作业');
      setTimeout(checkTaskWarning, 400);
    });
  }

  /* ============================================================
     文本导入 + AI 提示词
     ============================================================ */

  var peekKind = 'timetable';

  // 三套提示词：用户复制去问 DeepSeek / 豆包，拿 JSON 回来
  var HIST_PROMPT =
    '你是学生档案整理助手。我会给你第二课堂（素拓平台）或志愿服务（志愿汇）的历史记录，' +
    '可能是截图也可能是复制的文字。\n' +
    '请整理成下面的 JSON，**只输出 JSON，不要任何解释和 markdown 代码块**：\n' +
    '\n' +
    '{"history":[{"title":"图书馆志愿服务","date":"2024-11-05","credit":0,"hours":3}]}\n' +
    '\n' +
    '规则：\n' +
    '1. credit 是二课学分（单位：分），hours 是志愿时长（单位：小时），没有就填 0\n' +
    '2. date 用 YYYY-MM-DD；只知道年月就补成 YYYY-MM-01\n' +
    '3. 一条记录一个对象，不要合并\n' +
    '4. 看不清或换算不出来的，credit 和 hours 都填 0，**不要编造数字**';

  var VOL_PROMPT =
    '你是志愿服务信息提取助手。我会给你「志愿汇」或「青春杭电」的志愿岗位列表截图（或复制的文字）。\n' +
    '请整理成下面的 JSON，**只输出 JSON，不要任何解释和 markdown 代码块**：\n' +
    '\n' +
    '{"items":[{"title":"图书馆书目整理","day":"周二","start":"14:00","end":"16:00","place":"图书馆 三层","hours":2,"credit":0}]}\n' +
    '\n' +
    '规则：\n' +
    '1. day 只能是 周一 到 周日\n' +
    '2. start、end 用 24 小时制 HH:MM\n' +
    '3. hours 是志愿时长（单位：小时），必须填；没写明就按 end 减 start 算\n' +
    '4. credit 一律填 0 —— 志愿活动不算二课学分\n' +
    '5. 只提取还能报名的岗位；看不清的字段填空字符串，**不要编造**\n' +
    '6. 一个岗位一条，不要合并';

  var PROMPTS = {
    volunteer: VOL_PROMPT,

    timetable:
      '你是课程表信息提取助手。我会给你一张大学课程表的截图（或粘贴的文字）。\n' +
      '请把它整理成下面的 JSON，**只输出 JSON，不要任何解释和 markdown 代码块**：\n' +
      '\n' +
      '{"courses":[{"title":"高等数学 A1","day":"周二","start":"08:40","end":"10:15","place":"正心楼 518","weeks":"1-16","parity":"all"}]}\n' +
      '\n' +
      '规则：\n' +
      '1. day 只能是 周一 / 周二 / 周三 / 周四 / 周五 / 周六 / 周日\n' +
      '2. start、end 用 24 小时制 HH:MM；一门课跨多个节次时，取最早上课时间和最晚下课时间\n' +
      '3. place 是教室，图中没有就填空字符串 ""\n' +
      '4. 看不清的字段一律填空字符串，**不要编造**\n' +
      '5. 同一门课在一周内上多次，就输出多条\n' +
      '6. weeks 写周次范围，比如 "1-16"；只上前八周就写 "1-8"\n' +
      '7. parity 只能是 all / odd / even —— 单周课写 odd，双周课写 even，每周都上写 all',

    activities:
      '你是校园活动信息提取助手。我会给你「青春杭电」二课平台的活动列表截图（或复制的文字）。\n' +
      '请整理成下面的 JSON，**只输出 JSON，不要任何解释和 markdown 代码块**：\n' +
      '\n' +
      '{"items":[{"title":"包饺子大赛","day":"周五","start":"13:30","end":"15:30","place":"五餐厅","credit":0,"hours":2}]}\n' +
      '\n' +
      '规则：\n' +
      '1. day 只能是 周一 到 周日\n' +
      '2. start、end 用 24 小时制 HH:MM\n' +
      '3. credit 是二课学分（单位：分），hours 是志愿服务时长（单位：小时），没有就填 0\n' +
      '4. 只提取还能报名的活动；看不清的字段填空字符串，**不要编造**\n' +
      '5. 一个活动一条，不要合并',

    tasks:
      '你是作业整理助手。我会给你一段作业通知（课程群消息 / 教务系统截图 / 老师发的文字）。\n' +
      '请整理成下面的 JSON，**只输出 JSON，不要任何解释和 markdown 代码块**：\n' +
      '\n' +
      '{"tasks":[{"title":"完成 AIGC 大赛项目文档","course":"生成式人工智能","due":"2026-11-22 23:59"}]}\n' +
      '\n' +
      '规则：\n' +
      '1. title 写清要做的事，动词开头，不超过 20 个字\n' +
      '2. course 是课程名，没有就填空字符串 ""\n' +
      '3. due 是截止时间，格式 YYYY-MM-DD HH:MM；只说了日期就补 23:59；完全没提截止时间就填空字符串 ""\n' +
      '4. 一个作业一条，不要合并；没有截止时间的也要保留\n' +
      '5. **不要编造**通知里没有的内容'
  };

  function copyText(text, okMsg) {
    if (!text) { toast('没有可复制的内容'); return; }

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(okMsg || '已复制'); }
      catch (e) { toast('复制失败，请手动选中复制'); }
      document.body.removeChild(ta);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMsg || '已复制');
      }).catch(fallback);
    } else {
      fallback();
    }
  }

  function switchPane(pane) {
    var show = (pane === 'volunteer') ? 'activities' : pane;

    document.querySelectorAll('#impTabs .itab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-pane') === pane);
    });
    ['timetable', 'activities', 'tasks'].forEach(function (k) {
      var el = document.getElementById('pane-' + k);
      if (el) el.hidden = (k !== show);
    });

    // 志愿活动和二课活动共用一块面板，只换提示词和说明
    var isVol = (pane === 'volunteer');
    var cp = document.querySelector('#pane-activities [data-copy]');
    var pk = document.querySelector('#pane-activities [data-peek]');
    if (cp) cp.setAttribute('data-copy', isVol ? 'volunteer' : 'activities');
    if (pk) pk.setAttribute('data-peek', isVol ? 'volunteer' : 'activities');

    var hint = document.querySelector('#pane-activities .step-body span');
    if (hint) {
      hint.textContent = isVol
        ? '把「志愿汇 / 青春杭电」的岗位列表截图一起发过去'
        : '把「正在报名」那页截图一起发过去';
    }
    var step2 = document.querySelectorAll('#pane-activities .step-body span')[1];
    if (step2) {
      step2.textContent = isVol
        ? '每行「志愿时长：X 小时」会自动识别；粘 AI 的 JSON 也行'
        : '用空行分隔每条，或者直接粘 AI 返回的 JSON';
    }

    state.impPane = pane;
  }

  /* ---------------- 导入历史：解析与落地 ---------------- */

  function parseHistory(text) {
    var raw = String(text || '').trim();
    if (!raw) return [];

    var out = [];

    function push(title, date, credit, hours) {
      var t = String(title || '').trim();
      if (!t) return;
      var cr = Number(credit) || 0;
      var hr = Number(hours) || 0;
      if (cr <= 0 && hr <= 0) return;
      out.push({ id: 'h' + Date.now().toString(36) + out.length, title: t.slice(0, 40), date: String(date || ''), credit: cr, hours: hr });
    }

    // 1) 先试 JSON
    var json = null;
    try {
      var s = raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
      var i0 = s.indexOf('{'), i1 = s.lastIndexOf('}');
      var j0 = s.indexOf('['), j1 = s.lastIndexOf(']');
      if (i0 >= 0 && i1 > i0) json = JSON.parse(s.slice(i0, i1 + 1));
      else if (j0 >= 0 && j1 > j0) json = JSON.parse(s.slice(j0, j1 + 1));
    } catch (e) { json = null; }

    if (json) {
      var arr = json.history || json.items || json.records || (Array.isArray(json) ? json : null);
      if (arr && arr.length) {
        arr.forEach(function (it) {
          push(it.title || it.name || it.活动 || it.内容,
               it.date || it.日期 || '',
               it.credit || it.二课学分 || 0,
               it.hours || it.hour || it.时长 || 0);
        });
        if (out.length) return out;
      }
    }

    // 2) 再按行硬解
    raw.split(/\r?\n/).forEach(function (line) {
      var s2 = line.trim().replace(/^[-*·\d.、)]+\s*/, '');
      if (!s2) return;
      var cr = 0, hr = 0;
      var mc = s2.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:分|学分)/);
      var mh = s2.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:小时|h\b|时)/);
      if (mc) cr = parseFloat(mc[1]);
      if (mh) hr = parseFloat(mh[1]);
      if (!cr && !hr) return;
      var md = s2.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      var date = md ? (md[1] + '-' + pad2(+md[2]) + '-' + pad2(+md[3])) : '';
      var title = s2.replace(/([0-9]+(?:\.[0-9]+)?)\s*(?:分|学分|小时|时)/g, '')
                    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, '')
                    .replace(/[|,，;；]+/g, ' ')
                    .replace(/\s+/g, ' ').trim();
      push(title || '未命名记录', date, cr, hr);
    });

    return out;
  }

  function renderHistSum() {
    var el = document.getElementById('histSum');
    if (!el) return;
    var n = (state.history || []).length;
    if (!n) { el.textContent = '还没导入历史'; return; }
    el.innerHTML = '已导入 <b>' + n + '</b> 条 · 二课 <b>' + fmt1(histSum('credit')) +
                   '</b> 分 · 志愿 <b>' + fmt0(histSum('volunteer')) + '</b> 小时';
  }

  function openHistory() {
    document.getElementById('histText').value = '';
    renderHistSum();
    document.getElementById('modalHistory').hidden = false;
  }

  function applyHistory() {
    var text = document.getElementById('histText').value;
    var rows = parseHistory(text);
    if (!rows.length) { toast('没解析出记录 —— 检查一下格式'); return; }

    state.history = (state.history || []).concat(rows);
    rebuild();
    refreshAll();
    saveSoon();
    document.getElementById('modalHistory').hidden = true;
    toast('导入了 ' + rows.length + ' 条历史');
  }

  function clearHistory() {
    state.history = [];
    rebuild();
    refreshAll();
    saveSoon();
    renderHistSum();
    toast('历史已清空');
  }

  function openImport(pane) {
    switchPane(pane || state.impPane || 'activities');
    document.getElementById('modalText').hidden = false;
  }

  function gotoPage(name) {
    state.page = name;

    ['home', 'day', 'course', 'volunteer', 'run', 'data', 'me', 'about'].forEach(function (p) {
      var el = document.getElementById('page-' + p);
      if (el) el.hidden = (p !== name);
    });

    document.querySelectorAll('#nav .nv').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-page') === name);
    });

    try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { /* 老浏览器或测试环境没有 scrollTo，忽略 */ }
  }

  /* ============================================================
     兴趣侧写：五道题，问完就知道该推什么
     ============================================================ */

  var QUIZ = [
    {
      id: 'prefer', multi: true,
      q: '有空的时候，你更想去哪种活动？',
      sub: '可以多选',
      opts: [
        { k: '技术编程', t: '技术讲座 / 动手做东西' },
        { k: '学术讲座', t: '听听大佬讲什么' },
        { k: '志愿服务', t: '做点公益，帮到别人' },
        { k: '文体艺术', t: '看演出、逛展、做手工' },
        { k: '创新创业', t: '打比赛、组队做项目' },
        { k: '职业发展', t: '聊就业、改简历' }
      ]
    },
    {
      id: 'style', multi: false,
      q: '你更喜欢怎么参与？',
      sub: '单选',
      opts: [
        { k: '听', t: '坐着听，不动手' },
        { k: '做', t: '动手实践，边做边学' },
        { k: '聊', t: '小组讨论，认识新朋友' }
      ]
    },
    {
      id: 'motive', multi: false,
      q: '决定报不报，你最看重什么？',
      sub: '单选',
      opts: [
        { k: 'credit', t: '能拿二课学分' },
        { k: 'skill', t: '能学到真东西' },
        { k: 'resume', t: '对简历 / 保研有用' },
        { k: 'help', t: '能帮到人' },
        { k: 'fun', t: '就是图个开心' }
      ]
    },
    {
      id: 'when', multi: true,
      q: '你什么时候最有空？',
      sub: '可以多选',
      opts: [
        { k: 'eve', t: '工作日晚上' },
        { k: 'am', t: '工作日上午' },
        { k: 'pm', t: '工作日下午' },
        { k: 'weekend', t: '周末' }
      ]
    },
    {
      id: 'dur', multi: false,
      q: '一场活动你能坐多久？',
      sub: '单选',
      opts: [
        { k: 60, t: '1 小时以内' },
        { k: 120, t: '1–2 小时' },
        { k: 240, t: '半天也行' }
      ]
    }
  ];

  var quizAns = { prefer: [], style: '', motive: '', when: [], dur: '' };

  function openQuiz() {
    quizAns = { prefer: [], style: '', motive: '', when: [], dur: '' };

    var p = state.profile;
    if (p.done) {
      quizAns.prefer = p.tags.slice();
      quizAns.when = p.weekend ? ['weekend'] : p.slots.slice();
      quizAns.motive = p.motivation;
      quizAns.dur = p.maxDuration;
    }

    renderQuiz();
    document.getElementById('modalQuiz').hidden = false;
  }

  function renderQuiz() {
    var body = document.getElementById('quizBody');
    if (!body) return;

    body.innerHTML = QUIZ.map(function (q, qi) {
      var cur = quizAns[q.id];
      var opts = q.opts.map(function (o) {
        var on = q.multi ? cur.indexOf(o.k) !== -1 : String(cur) === String(o.k);
        return '<button type="button" class="qopt' + (on ? ' on' : '') + '"' +
               ' data-q="' + q.id + '" data-k="' + esc(String(o.k)) + '" data-multi="' + (q.multi ? 1 : 0) + '">' +
               esc(o.t) + '</button>';
      }).join('');

      return '<div class="qitem">' +
               '<div class="qhead"><span class="qn">' + (qi + 1) + '</span>' +
                 '<b>' + esc(q.q) + '</b><em>' + esc(q.sub) + '</em></div>' +
               '<div class="qopts">' + opts + '</div>' +
             '</div>';
    }).join('');

    var btn = document.getElementById('btnQuizDone');
    if (btn) btn.disabled = quizAns.prefer.length === 0;
  }

  function pickQuizOption(qid, key, multi) {
    if (multi) {
      var arr = quizAns[qid];
      var i = arr.indexOf(key);
      if (i === -1) arr.push(key);
      else arr.splice(i, 1);
    } else {
      quizAns[qid] = key;
    }
    renderQuiz();
  }

  function applyQuiz() {
    if (!quizAns.prefer.length) { toast('至少选一个你感兴趣的方向'); return; }

    var slots = [];
    var weekend = false;
    quizAns.when.forEach(function (k) {
      if (k === 'weekend') weekend = true;
      else slots.push(k);
    });
    if (!slots.length && !weekend) { slots = ['eve']; weekend = true; }

    state.profile = {
      done: true,
      tags: quizAns.prefer.slice(),
      slots: slots,
      weekend: weekend,
      motivation: quizAns.motive || 'fun',
      maxDuration: parseInt(quizAns.dur, 10) || 120
    };

    // 顺手把「我感兴趣」的 chips 同步过去
    state.interests = quizAns.prefer.slice();

    document.getElementById('modalQuiz').hidden = true;
    renderPanel();
    regenerate();

    toast('画像建好了，推荐已经按你的口味重排');
  }

  function profileSentence(p) {
    if (!p.done) return '还没做过问卷 —— 做完这五道题，推荐会准很多。';

    var tagPart = p.tags.slice(0, 2).join('、') || '什么都行';

    var timePart = (p.weekend && p.slots.length) ? '工作日和周末都能安排'
      : p.weekend ? '主要在周末'
      : p.slots.length ? '主要在工作日' : '时间随便';

    var motiveMap = {
      credit: '你想把学分攒够',
      skill: '你想学点真东西',
      resume: '你在为简历铺路',
      help: '你想做点有意义的事',
      fun: '你想图个开心'
    };

    return '你偏爱「' + tagPart + '」，' + timePart + '，' +
           (motiveMap[p.motivation] || '') + '，单场不超过 ' + (p.maxDuration / 60) + ' 小时。';
  }

  function renderProfile() {
    var p = state.profile;

    var html =
      '<div class="prof-head">' +
        '<div>' +
          '<h2 class="card-title">你的兴趣侧写</h2>' +
          '<p class="card-sub">' + esc(profileSentence(p)) + '</p>' +
        '</div>' +
        '<button class="btn ' + (p.done ? 'ghost' : 'primary') + ' sm" type="button" id="btnQuiz">' +
          (p.done ? '重新测' : '做个 5 题小问卷') +
        '</button>' +
      '</div>' +
      (p.done
        ? '<div class="prof-tags">' +
            p.tags.map(function (t) { return '<span class="ptag">' + esc(t) + '</span>'; }).join('') +
            '<span class="ptag ghost">' + (p.weekend ? '周末' : '工作日') + '</span>' +
            '<span class="ptag ghost">≤ ' + (p.maxDuration / 60) + ' 小时</span>' +
          '</div>'
        : '');

    ['profileCard', 'profileCard2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  }

  /* ============================================================
     推荐列表：系统只给推荐分，勾不勾你说了算
     ============================================================ */

  var PAGES = {
    course: {
      label: '二课活动',
      match: function (e) { return e.credit > 0; }
    },
    volunteer: {
      label: '志愿服务',
      match: function (e) { return e.volunteerHours > 0; }
    },
    run: {
      label: '阳光乐跑',
      match: function (e) { return e.runKm > 0; }
    }
  };

  function poolFor(kind) {
    var conf = PAGES[kind];
    return state.events
      .filter(function (e) { return conf.match(e); })
      .sort(function (a, b) {
        var sa = a._score ? a._score.total : 0;
        var sb = b._score ? b._score.total : 0;
        return sb - sa;
      });
  }

  function statusFlag(e) {
    var st = pickStatus(e);
    if (!st) return { cls: 'ok', text: '可加入' };
    if (st.kind === 'busy') return { cls: 'clash', text: '撞课' };
    if (st.kind === 'time') return { cls: 'clash', text: '撞「' + String(st.other.title).slice(0, 8) + '」' };
    if (st.kind === 'travel') return { cls: 'clash', text: '转场来不及' };
    if (st.kind === 'dense') return { cls: 'clash', text: '这天太满' };
    if (st.kind === 'full') return { cls: 'bad', text: '名额已满' };
    if (st.kind === 'deadline') return { cls: 'bad', text: '报名截止' };
    return { cls: 'bad', text: '不可用' };
  }

  /* ---------------- 活动页：分组 / 替换 / 两种状态 ---------------- */

  var confirmCb = null;

  function confirmDialog(o) {
    document.getElementById('cfTitle').textContent = o.title || '确认';
    document.getElementById('cfNote').textContent = o.note || '';
    document.getElementById('cfLines').innerHTML = (o.lines || []).join('');
    document.getElementById('cfOk').textContent = o.ok || '确定';
    confirmCb = o.onOk || null;
    document.getElementById('modalConfirm').hidden = false;
  }

  function closeConfirm() {
    document.getElementById('modalConfirm').hidden = true;
    confirmCb = null;
  }

  // 一场活动在当前状态下属于哪一组
  function pickStateOf(e) {
    var chosen = state.chosenIds.indexOf(e.id) !== -1;

    if (chosen) {
      var inSched = false;
      state.schedule.forEach(function (x) { if (x.id === e.id) inSched = true; });
      return inSched
        ? { group: 'ok', flag: { cls: 'ok', text: '已加入' } }
        : { group: 'blocked', flag: { cls: 'bad', text: '排不下' } };
    }

    var st = pickStatus(e);
    if (!st) return { group: 'ok', flag: { cls: 'ok', text: '可加入' } };
    if (st.kind === 'busy') return { group: 'busy', flag: { cls: 'clash', text: '撞课' } };
    if (st.kind === 'time') return { group: 'overlap', flag: { cls: 'clash', text: '时间重叠' }, other: st.other };
    if (st.kind === 'travel') return { group: 'overlap', flag: { cls: 'clash', text: '转场来不及' }, other: st.other };
    if (st.kind === 'full') return { group: 'blocked', flag: { cls: 'bad', text: '名额已满' } };
    if (st.kind === 'deadline') return { group: 'blocked', flag: { cls: 'bad', text: '报名截止' } };
    if (st.kind === 'dense') return { group: 'blocked', flag: { cls: 'clash', text: '这天太满' } };
    return { group: 'blocked', flag: { cls: 'bad', text: '不可用' } };
  }

  function pickRow(e, flag) {
    var t = TYPES[e.type];
    var on = state.chosenIds.indexOf(e.id) !== -1;
    var score = e._score ? e._score.total : 0;
    var isFlex = !!e.flex || e.runKm > 0;

    var when = isFlex
      ? WD[e.d] + ' · 07:00–21:00 任选'
      : WD[e.d] + ' ' + esc(e.start) + '–' + esc(e.end);

    var bits = [];
    if (!isFlex && e.place) bits.push(esc(e.place));
    if (e.credit > 0) bits.push('二课 <b>' + fmt1(e.credit) + '</b> 分');
    if (e.volunteerHours > 0) bits.push('志愿 <b>' + fmt0(e.volunteerHours) + '</b> 小时');
    if (e.runKm > 0) bits.push('跑 <b>' + fmt1(e.runKm) + '</b> km');
    if (!isFlex && isFinite(e.capacity)) bits.push('余 <b>' + (e.capacity - e.enrolled) + '</b>/' + e.capacity);

    var why = [];
    if (e._score && e._score.parts.profile >= 0.55) why.push('对味');
    if ((e.tags || []).some(function (x) { return state.interests.indexOf(x) !== -1; })) why.push('你标过的方向');
    if (!isFlex && isFinite(e.capacity) && e.capacity - e.enrolled <= 5) why.push('名额快没了');

    return '<label class="pick' + (on ? ' on' : '') + '" data-eid="' + e.id + '">' +
             '<input type="checkbox" data-eid="' + e.id + '"' + (on ? ' checked' : '') + '>' +
             '<div class="pick-main">' +
               '<div class="pick-top">' +
                 '<span class="pick-tag" style="--c:' + typeColor(t) + ';--bgc:' + typeBg(t) + '">' + t.label + '</span>' +
                 '<span class="pick-when">' + when + '</span>' +
                 (why.length ? '<span class="pick-why">' + why.join(' · ') + '</span>' : '') +
                 '<span class="pick-score" title="推荐分">' + score + '</span>' +
               '</div>' +
               '<div class="pick-title">' + esc(e.title) + '</div>' +
               '<div class="pick-meta">' + bits.join(' · ') + '</div>' +
             '</div>' +
             '<span class="pick-flag ' + flag.cls + '">' + esc(flag.text) + '</span>' +
           '</label>';
  }

  function groupBlock(title, rows, hint) {
    if (!rows.length) return '';
    return '<details class="pgroup">' +
             '<summary><span class="pg-title">' + title + '</span>' +
               '<span class="pg-meta">' + rows.length + ' 场</span><i class="chev">›</i></summary>' +
             (hint ? '<p class="pg-hint">' + hint + '</p>' : '') +
             '<div class="pick-list">' + rows.join('') + '</div>' +
           '</details>';
  }

  function renderPick(kind) {
    var el = document.getElementById('list-' + kind);
    if (!el) return;

    var pool = poolFor(kind);
    var chosen = pool.filter(function (e) { return state.chosenIds.indexOf(e.id) !== -1; });

    var cnt = document.getElementById('count-' + kind);
    if (cnt) {
      cnt.textContent = state.pickMode === 'done'
        ? '已选 ' + chosen.length + ' 场'
        : '已勾 ' + chosen.length + ' / ' + pool.length;
    }

    var seg = document.getElementById('seg-' + kind);
    if (seg) {
      Array.prototype.forEach.call(seg.querySelectorAll('[data-pickmode]'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-pickmode') === state.pickMode);
      });
    }

    if (kind === 'run') {
      var st = document.getElementById('runStat');
      if (st) {
        st.innerHTML = '场地 07:00–21:00 · 本周计划 ' + state.goals.run + ' 天 · 本学期 ' +
          state.run.done + ' 天 = ' + runScoreText(state.run.done) +
          ' · 单次 ' + fmt1(runKmOf()) + ' km';
      }
    }

    if (!pool.length) {
      el.innerHTML = '<div class="ag-empty">这一类还没有数据 —— 去「数据」页导入一批。</div>';
      return;
    }

    if (state.pickMode === 'done') {
      el.innerHTML = chosen.length
        ? '<div class="pick-list">' + chosen.map(function (e) {
            return pickRow(e, pickStateOf(e).flag);
          }).join('') + '</div>'
        : '<div class="ag-empty">还没选任何活动 —— 切回「编辑活动」去挑几场。</div>';
      return;
    }

    var g = { ok: [], busy: [], overlap: [], blocked: [] };
    pool.forEach(function (e) { g[pickStateOf(e).group].push(e); });

    var html = g.ok.length
      ? '<div class="pick-list">' + g.ok.map(function (e) {
          return pickRow(e, pickStateOf(e).flag);
        }).join('') + '</div>'
      : '<div class="ag-empty">这一类暂时没有能直接加的 —— 往下看折叠。</div>';

    html += groupBlock('和课程撞了',
      g.busy.map(function (e) { return pickRow(e, { cls: 'clash', text: '撞课' }); }),
      '这些时间你正在上课，加进来也排不下。');

    html += groupBlock('和你已选的重叠',
      g.overlap.map(function (e) { return pickRow(e, pickStateOf(e).flag); }),
      '勾它们会把已经排进去的那一场换掉 —— 会先问你要不要换。');

    html += groupBlock('暂时选不了',
      g.blocked.map(function (e) { return pickRow(e, pickStateOf(e).flag); }),
      '名额已满、报名截止，或者那天实在排不下了。');

    el.innerHTML = html;
  }

  // 会重叠的，先问一句再替换
  function askReplace(e, other) {
    confirmDialog({
      title: '和已有活动重叠',
      note: '选这个，会把「' + other.title + '」从日程里换掉。',
      lines: [
        '<div class="cf-line"><span class="cf-tag cf-old">已经排了</span>' +
          '<span class="cf-name">' + esc(other.title) + '</span>' +
          '<em>' + WD[other.d] + ' ' + esc(other.start) + '–' + esc(other.end) + '</em></div>',
        '<div class="cf-line"><span class="cf-tag cf-new">要加的是</span>' +
          '<span class="cf-name">' + esc(e.title) + '</span>' +
          '<em>' + WD[e.d] + ' ' + esc(e.start) + '–' + esc(e.end) + '</em></div>'
      ],
      ok: '替换',
      onOk: function () {
        var oi = state.chosenIds.indexOf(other.id);
        if (oi !== -1) state.chosenIds.splice(oi, 1);
        if (state.chosenIds.indexOf(e.id) === -1) state.chosenIds.push(e.id);
        regenerate();
        toast('已换成「' + e.title.slice(0, 14) + '」');
      }
    });
  }

  function togglePick(id) {
    var i = state.chosenIds.indexOf(id);
    if (i !== -1) {
      state.chosenIds.splice(i, 1);
      regenerate();
      return;
    }

    var e = null;
    state.events.forEach(function (x) { if (x.id === id) e = x; });
    if (!e) return;

    // 阳光乐跑是弹性的，不会和谁重叠
    var st = e.flex ? null : pickStatus(e);
    if (st && (st.kind === 'time' || st.kind === 'travel')) {
      askReplace(e, st.other);
      return;
    }

    state.chosenIds.push(id);
    regenerate();

    var bad = null;
    state.rejected.forEach(function (r) { if (r.e.id === id) bad = r; });
    if (!bad) return;

    var row = document.querySelector('.pick[data-eid="' + id + '"]');
    if (row) {
      row.classList.add('shake');
      setTimeout(function () { row.classList.remove('shake'); }, 620);
    }
    toast(REASON_TEXT[bad.why] || '排不下');
  }

  function pickAllRecommended(kind) {
    var pool = poolFor(kind);
    var limit = kind === 'run' ? state.goals.run : Infinity;
    var picked = [];

    pool.forEach(function (e) {
      if (state.chosenIds.indexOf(e.id) !== -1) return;
      if (picked.length >= limit) return;
      if (!e.flex && pickStatus(e)) return;      // 会撞的先跳过
      picked.push(e.id);
    });

    if (!picked.length) { toast('没有可加的'); return; }
    picked.forEach(function (id) { state.chosenIds.push(id); });
    regenerate();
    toast('按推荐加了 ' + picked.length + ' 个，不满意可以取消');
  }

  function clearPicked(kind) {
    var pool = poolFor(kind);
    var ids = pool.map(function (e) { return e.id; });
    state.chosenIds = state.chosenIds.filter(function (id) { return ids.indexOf(id) === -1; });
    regenerate();
    toast('清空了');
  }

  /* ============================================================
     活动结算：过了结束时间，就得给个说法
     ============================================================ */

  var recSeq = 0;

  function seedRecord(title, type, dayOffset, start, end, credit, hours, status) {
    var d = addDays(new Date(), dayOffset);
    state.records.push({
      id: 'r' + (++recSeq),
      title: title,
      type: type,
      date: ymd(d),
      start: start,
      end: end,
      credit: credit || 0,
      hours: hours || 0,
      status: status || 'pending'
    });
  }

  function renderSettle() {
    var card = document.getElementById('settleCard');
    var list = document.getElementById('settleList');
    if (!card || !list) return;

    var now = Date.now();
    var pend = state.records.filter(function (r) {
      if (r.status !== 'pending') return false;
      return new Date(r.date + 'T' + r.end + ':00').getTime() <= now;
    });

    card.hidden = pend.length === 0;

    var cnt = document.getElementById('settleCount');
    if (cnt) cnt.textContent = pend.length ? pend.length + ' 场' : '';

    if (!pend.length) { list.innerHTML = ''; return; }

    list.innerHTML = pend.map(function (r) {
      var d = new Date(r.date);
      var bits = [];
      if (r.credit > 0) bits.push('+' + fmt1(r.credit) + ' 学分');
      if (r.hours > 0) bits.push('+' + fmt0(r.hours) + ' 小时');

      return '<div class="settle-row">' +
               '<div class="settle-main">' +
                 '<div class="settle-title">' + esc(r.title) + '</div>' +
                 '<div class="settle-meta">' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                   esc(r.start) + '–' + esc(r.end) +
                   (bits.length ? ' · ' + bits.join(' · ') : '') + '</div>' +
               '</div>' +
               '<div class="settle-actions">' +
                 '<button class="btn primary sm" type="button" data-settle="' + r.id + '" data-ok="1">去了</button>' +
                 '<button class="btn ghost sm" type="button" data-settle="' + r.id + '" data-ok="0">没去</button>' +
               '</div>' +
             '</div>';
    }).join('');
  }

  function settleRecord(id, ok) {
    var rec = null;
    state.records.forEach(function (r) { if (r.id === id) rec = r; });
    if (!rec || rec.status !== 'pending') return;

    rec.status = ok ? 'done' : 'missed';
    rec.settledAt = new Date();

    if (ok) {
      var gain = rec.credit > 0 ? '+' + fmt1(rec.credit) + ' 学分'
               : rec.hours > 0 ? '+' + fmt0(rec.hours) + ' 小时'
               : '记一笔';
      toast('「' + rec.title.slice(0, 12) + '」搞定 · ' + gain);
    } else {
      toast('记作没去，不扣分');
    }

    renderSettle();
    renderHistory('course');
    renderHistory('volunteer');
    renderStats();
    saveSoon();
  }

  /* ---------------- 我的历史 ---------------- */

  var HIST_MATCH = {
    course: function (r) { return /^(lecture|practice|competition|art|career)$/.test(r.type); },
    volunteer: function (r) { return r.type === 'volunteer'; }
  };

  function renderHistory(kind) {
    var el = document.getElementById('history-' + kind);
    if (!el) return;

    var all = state.records
      .filter(HIST_MATCH[kind])
      .filter(function (r) { return r.status !== 'pending'; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    var done = all.filter(function (r) { return r.status === 'done'; });
    var got = 0;
    done.forEach(function (r) { got += (kind === 'volunteer' ? r.hours : r.credit); });

    var cnt = document.getElementById('hist-' + kind + '-count');
    if (cnt) {
      cnt.textContent = all.length
        ? '去了 ' + done.length + '/' + all.length + ' · 累计 ' +
          (kind === 'volunteer' ? fmt0(got) + ' 小时' : fmt1(got) + ' 分')
        : '';
    }

    if (!all.length) {
      el.innerHTML = '<div class="ag-empty">还没有记录。活动结束后回「日程」结算，就会记在这里。</div>';
      return;
    }

    el.innerHTML = all.map(function (r) {
      var d = new Date(r.date);
      var isDone = r.status === 'done';
      var gain = '';
      if (isDone) {
        if (r.credit > 0) gain = '+' + fmt1(r.credit) + ' 分';
        else if (r.hours > 0) gain = '+' + fmt0(r.hours) + ' 小时';
      }

      return '<div class="hist-row">' +
               '<span class="hist-date">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
               '<span class="hist-title">' + esc(r.title) + '</span>' +
               '<span class="hist-gain">' + esc(gain) + '</span>' +
               '<span class="hist-flag ' + (isDone ? 'ok' : 'miss') + '">' +
                 (isDone ? '去了' : '没去') + '</span>' +
             '</div>';
    }).join('');
  }

  function renderStats() {
    var el = document.getElementById('statsGrid');
    if (!el) return;

    var done = state.records.filter(function (r) { return r.status === 'done'; });
    var missed = state.records.filter(function (r) { return r.status === 'missed'; });

    var credit = 0, hours = 0;
    done.forEach(function (r) { credit += r.credit; hours += r.hours; });

    var total = done.length + missed.length;
    var rate = total ? Math.round(done.length / total * 100) : 0;

    var defs = [
      { name: '二课学分（已结算）', val: fmt1(credit), unit: '分' },
      { name: '志愿时长（已结算）', val: fmt0(hours), unit: '小时' },
      { name: '出勤率', val: String(rate), unit: '%' },
      { name: '本学期阳光乐跑', val: String(state.run.done), unit: '/ ' + state.run.target + ' 天' }
    ];

    el.innerHTML = defs.map(function (d) {
      return '<div class="stat">' +
               '<span class="stat-name">' + d.name + '</span>' +
               '<span class="stat-val">' + d.val + '<s>' + d.unit + '</s></span>' +
             '</div>';
    }).join('');
  }

  /* ============================================================
     背景 / 壁纸
     ============================================================ */

  var BG_PRESETS = [
    { id: 'morning', name: '晨雾', css: 'linear-gradient(135deg,#eef2ff,#f8f5ff 45%,#e6f7ff)' },
    { id: 'lime', name: '青柠', css: 'linear-gradient(135deg,#f0fdf4,#ecfeff 60%,#f7fee7)' },
    { id: 'dusk', name: '暮橘', css: 'linear-gradient(135deg,#fff7ed,#ffe9d6 55%,#fee2e2)' },
    { id: 'ink', name: '墨蓝', css: 'linear-gradient(135deg,#e2e8ff,#dceeff 50%,#ede9fe)' },
    { id: 'paper', name: '素纸', css: 'linear-gradient(180deg,#fafbfd,#eef1f7)' }
  ];

  var bgSeq = 0;

  function applyBg(spec) {
    state.bg = spec || { kind: 'default' };

    var layer = document.getElementById('bglayer');
    if (layer) {
      layer.innerHTML = '';
      layer.style.background = '';
      layer.style.backgroundSize = '';

      if (state.bg.kind === 'preset') {
        var p = null;
        BG_PRESETS.forEach(function (x) { if (x.id === state.bg.id) p = x; });
        if (p) layer.style.background = p.css;
      } else if (state.bg.kind === 'image') {
        layer.style.background = 'url("' + state.bg.url + '") center/cover no-repeat';
      } else if (state.bg.kind === 'video') {
        layer.innerHTML = '<video autoplay muted loop playsinline src="' + state.bg.url + '"></video>';
      }
    }

    document.body.classList.toggle('has-wall', state.bg.kind !== 'default');
    renderBg();
    saveSoon();
  }

  function renderBg() {
    var grid = document.getElementById('bgGrid');
    if (!grid) return;

    var html = '';

    html += '<button type="button" class="bgtile' + (state.bg.kind === 'default' ? ' on' : '') +
            '" data-bg="default"><span class="bgfill" style="background:linear-gradient(180deg,var(--bg),var(--line-2))"></span>' +
            '<span class="bgname">默认</span></button>';

    BG_PRESETS.forEach(function (p) {
      var on = state.bg.kind === 'preset' && state.bg.id === p.id;
      html += '<button type="button" class="bgtile' + (on ? ' on' : '') + '" data-bgpreset="' + p.id + '">' +
                '<span class="bgfill" style="background:' + p.css + '"></span>' +
                '<span class="bgname">' + esc(p.name) + '</span></button>';
    });

    state.wallpapers.forEach(function (w) {
      var on = state.bg.kind !== 'preset' && state.bg.kind !== 'default' && state.bg.id === w.id;
      html += '<button type="button" class="bgtile tall' + (on ? ' on' : '') + '" data-wall="' + w.id + '">' +
                (w.previewUrl
                  ? '<span class="bgfill" style="background:url(\'' + w.previewUrl + '\') center/cover no-repeat"></span>'
                  : '<span class="bgfill" style="background:#dfe3ef"></span>') +
                (w.kind === 'video' ? '<i class="bgplay">▶</i>' : '') +
                '<span class="bgname">' + esc(w.name) + '</span>' +
              '</button>';
    });

    grid.innerHTML = html;
  }

  // 一个壁纸文件夹里可能有 project.json / preview.jpg / Wallpaper.mp4
  function importWallpapers(files) {
    if (!files || !files.length) return;

    var byDir = {};
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var rel = f.webkitRelativePath || f.name;
      var parts = rel.split('/');
      if (parts.length < 2) continue;
      var dir = parts.slice(0, -1).join('/');
      var base = parts[parts.length - 1].toLowerCase();
      (byDir[dir] = byDir[dir] || {})[base] = f;
    }

    var dirs = Object.keys(byDir).filter(function (d) { return byDir[d]['project.json']; });
    if (!dirs.length) {
      toast('没找到 project.json —— 可能选错文件夹了');
      return;
    }

    toast('找到 ' + dirs.length + ' 个壁纸，读一下…');

    var picked = dirs.slice(0, 80);

    Promise.all(picked.map(function (dir) {
      var entry = byDir[dir];
      return entry['project.json'].text().then(function (txt) {
        var meta = {};
        try { meta = JSON.parse(txt); } catch (e) {}

        var prevName = String(meta.preview || 'preview.jpg').toLowerCase();
        var prev = entry[prevName] || entry['preview.jpg'] || entry['preview.png'] || entry['preview.gif'];
        var mediaFile = meta.file ? entry[String(meta.file).toLowerCase()] : null;
        var isVideo = /^(mp4|webm)$/i.test(String((meta.file || '').split('.').pop()));

        return {
          id: 'w' + (++bgSeq),
          name: String(meta.title || dir.split('/').pop() || '壁纸'),
          kind: isVideo ? 'video' : 'image',
          previewUrl: prev ? URL.createObjectURL(prev) : '',
          mediaUrl: mediaFile ? URL.createObjectURL(mediaFile)
                  : (prev ? URL.createObjectURL(prev) : '')
        };
      }).catch(function () { return null; });
    })).then(function (list) {
      var ok = list.filter(Boolean);
      ok.forEach(function (w) { state.wallpapers.push(w); });
      renderBg();
      toast(ok.length ? '导入了 ' + ok.length + ' 张壁纸' : '读取失败，换个文件夹试试');
    });
  }


  /* ============================================================
     首页：介绍、滚动行、待办、文章
     ============================================================ */

  // 某一天是第几教学周
  function weekOf(dt) {
    var t = state.term && state.term.start;
    if (!t) return 0;
    var start = new Date(t + 'T00:00:00');
    if (isNaN(start.getTime())) return 0;
    var d = new Date(dt);
    d.setHours(0, 0, 0, 0);
    var diff = Math.floor((d - start) / 86400000);
    if (diff < 0) return 0;
    return Math.floor(diff / 7) + 1;
  }

  function termWeek() {
    return weekOf(new Date());
  }

  function gradeText() {
    var g = (state.term && state.term.grade) || 0;
    var s = (state.term && state.term.semester) || 1;
    if (!g) return '';
    return ['大一', '大二', '大三', '大四'][g - 1] + (s === 2 ? '下' : '上');
  }

  function termLabel() {
    var w = termWeek();
    var g = gradeText();
    if (!w) return '未设置开学日';
    return (g ? g + ' · ' : '') + '第 ' + w + ' 周';
  }

  var FEATURES = [
    { n: '01', t: '冲突检测', d: '详细地告诉你冲突原因。', c: 'brand' },
    { n: '02', t: '个性推荐', d: '从六个维度告诉你它为什么值得你选。', c: 'purple' },
    { n: '03', t: '导入多样化', d: '三种导入方式，总有一种适合你。', c: 'pink' },
    { n: '04', t: '自动保存', d: '我们相信你的数据不会丢失。', c: 'green' },
    { n: '05', t: '结算功能', d: '结束后自动归入待结算，点一下记账。', c: 'amber' },
    { n: '06', t: '页面自由', d: '可自由更改页面颜色。', c: 'cyan' }
  ];

  function renderFeatureGrid() {
    var el = document.getElementById('featGrid');
    if (!el) return;
    el.innerHTML = FEATURES.map(function (f) {
      return '<div class="feat">' +
               '<span class="feat-n">' + f.n + '</span>' +
               '<h3 class="feat-t">' + f.t + '</h3>' +
               '<p class="feat-d">' + f.d + '</p>' +
             '</div>';
    }).join('');
  }

  function renderHero() {
    var termEl = document.getElementById('heroTerm');
    if (termEl) termEl.textContent = termLabel();

    var box = document.getElementById('heroStats');
    if (!box) return;

    var pending = state.records.filter(function (r) { return r.status === 'pending'; });
    var now = Date.now();
    pending = pending.filter(function (r) {
      return new Date(r.date + 'T' + r.end + ':00').getTime() <= now;
    });
    var todo = state.tasks.filter(function (t) { return !t.done; });

    var stats = [
      { v: state.schedule.length, k: '本周已排', u: '件', go: 'day', tip: '看日程' },
      { v: state.courses.length, k: '课程', u: '门', go: 'data', tip: '看课表' },
      { v: todo.length, k: '待办作业', u: '项', go: 'day', tip: '看清单' },
      { v: pending.length, k: '待结算', u: '场', go: 'day', tip: '去结算' }
    ];
    box.innerHTML = stats.map(function (s) {
      return '<button class="hstat" type="button" data-page="' + s.go + '" title="' + s.tip + '">' +
               '<b>' + s.v + '</b><span>' + s.k + '</span><em>' + s.u + '</em>' +
               '<i class="hstat-go">→</i>' +
             '</button>';
    }).join('');
  }

  function marqueeSegments() {
    var pend = state.records.filter(function (r) { return r.status === 'pending'; }).length;
    var todo = state.tasks.filter(function (t) { return !t.done; }).length;
    var got = { credit: histSum('credit'), volunteer: histSum('volunteer'), run: 0 };
    state.schedule.forEach(function (e) {
      got.credit += e.credit;
      got.volunteer += e.volunteerHours;
      if (e.runKm > 0) got.run += 1;
    });

    return [
      '三分钟导完课表，往后一周不用再心算',
      '第 ' + (termWeek() || 0) + ' 周 · 本周已排 ' + state.schedule.length + ' 件事',
      '撞课、转场来不及、名额抢光 —— 勾之前就知道',
      '早八几点、空档多长、能塞下哪一场，一屏看完',
      '二课 ' + fmt1(got.credit) + ' / ' + fmt1(state.goals.credit) + ' 分 · 志愿 ' + fmt0(got.volunteer) + ' / ' + fmt0(state.goals.volunteer) + ' 小时 · 阳光乐跑 ' + got.run + ' / ' + state.goals.run + ' 天',
      '待办作业 ' + todo + ' 项 · 待结算 ' + pend + ' 场',
      '它只提醒你，不替你做决定',
      '刷新不丢，换电脑重来；深浅色随你',
      '把脑子腾出来，去干点别的'
    ];
  }

  function renderMarquee() {
    var track = document.getElementById('marqueeTrack');
    if (!track) return;

    var segs = marqueeSegments();
    var one = segs.map(function (s) {
      return '<span class="mq"><i></i>' + esc(s) + '</span>';
    }).join('');
    // 复制一份，滚动到一半时无缝接上
    track.innerHTML = one + one;
  }

  function openWidget() {
    var w = 340;
    var h = 560;
    var left = Math.max(20, (screen.availWidth || 1280) - w - 60);
    var top = 90;
    var feat = 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
               ',menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes';
    var win = window.open('widget.html', 'paidekai-widget', feat);
    if (!win) {
      toast('浏览器拦了这个弹窗，允许后再试');
    } else {
      toast('挂件开好了 —— 钉在桌面上就能一直看');
    }
  }

  function exportBackup() {
    persist();
    var payload = { app: 'paidekai', ver: 1, exportedAt: new Date().toISOString(), store: store };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = '排得开-备份-' + ymd(new Date()) + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    toast('备份已下载，拿去另一个浏览器导入');
  }

  function importBackupFile(file) {
    if (!file) return;
    file.text().then(function (txt) {
      var obj = JSON.parse(txt);
      if (!obj || obj.app !== 'paidekai' || !obj.store || !obj.store.users || !obj.store.users.length) {
        throw new Error('这不是排得开的备份文件');
      }
      store = obj.store;
      if (!store.current || !(store.data || {})[store.current]) {
        store.current = store.users[0].id;
      }
      var d = (store.data || {})[store.current];
      seedData();
      if (d) applySnapshot(d);
      persist();
      hideGate();
      refreshAll();
      gotoPage(state.page || 'home');
      toast('已恢复 ' + store.users.length + ' 个档案');
    }).catch(function (e) {
      toast((e && e.message) ? e.message : '这个文件读不了');
    });
  }

  function pickBackupFile() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = function () {
      var f = this.files && this.files[0];
      if (f) importBackupFile(f);
    };
    inp.click();
  }

  var STAR_ON = 'M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z';
  var STAR_OFF = 'M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25zm0 2.445L6.615 5.5a.75.75 0 01-.564.41l-3.097.45 2.24 2.184a.75.75 0 01.216.664l-.528 3.084 2.769-1.456a.75.75 0 01.698 0l2.77 1.456-.53-3.084a.75.75 0 01.216-.664l2.24-2.183-3.096-.45a.75.75 0 01-.564-.41L8 2.694z';

  // 参考 GitHub 的 Star 按钮：图标 + 文字，两种状态
  function starBtn(t) {
    return '<button class="ghstar' + (t.fav ? ' on' : '') + '" type="button"' +
             ' data-fav="' + t.id + '" aria-pressed="' + (t.fav ? 'true' : 'false') + '"' +
             ' title="' + (t.fav ? '取消收藏' : '收藏，排到最前面') + '">' +
             '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="' +
               (t.fav ? STAR_ON : STAR_OFF) + '"/></svg>' +
             '<span>' + (t.fav ? 'Starred' : 'Star') + '</span>' +
           '</button>';
  }

  function toggleTaskFav(id) {
    state.tasks.forEach(function (t) {
      if (t.id === id) t.fav = !t.fav;
    });
    renderHomeTodo();
    renderTodo();
    saveSoon();
  }

  function renderHomeTodo() {
    var el = document.getElementById('homeTodo');
    if (!el) return;

    var all = state.tasks.filter(function (t) { return !t.done; }).slice();
    all.sort(function (p, q) {
      if (!!q.fav !== !!p.fav) return q.fav ? 1 : -1;      // 收藏的排最前
      if (!p.due) return 1;
      if (!q.due) return -1;
      return new Date(p.due) - new Date(q.due);
    });
    var list = all.slice(0, 4);

    if (!list.length) {
      el.innerHTML = '<div class="ag-empty">清单是空的 —— 去「日程」页导入一份作业。</div>';
      return;
    }

    el.innerHTML = list.map(function (t) {
      var info = dueInfo(t);
      return '<div class="htodo' + (t.fav ? ' is-fav' : '') + '">' +
               starBtn(t) +
               '<span class="htodo-dot ' + info.kind + '"></span>' +
               '<button class="htodo-main" type="button" data-page="day">' +
                 '<span class="htodo-title">' + esc(t.title) + '</span>' +
                 '<span class="htodo-meta">' + esc(t.course || '未归课') + '</span>' +
               '</button>' +
               '<span class="htodo-when ' + info.kind + '">' + esc(info.label) + '</span>' +
             '</div>';
    }).join('');
  }

  /* ---------------- 文章 ---------------- */

  var ARTICLES = [{
    id: 'howto',
    tag: '指南',
    title: '如何正确食用「排得开」',
    sub: '五步，十分钟内能吃上',
    date: '2026-11-19',
    read: '3 分钟',
    body: [
      { p: '先说结论：这玩意儿一年只需要认真设置一次，之后每天花十秒看一眼。' },

      { h: '第一步，起个名字' },
      { p: '昵称加头像。头像能选 emoji，也能传自己的图——会自动压成方形，四 KB 左右。' },
      { p: '档案就待在这个浏览器里，不上传，也没有密码。换台电脑，重新来一遍。' },

      { h: '第二步，把课表塞进去' },
      { p: '右上角「＋ 导入」，或者去「数据」页。三条路，挑顺手的：' },
      { li: '有截图 —— 扔给视觉模型直接读' },
      { li: '没配 Key —— 复制提示词丢给 DeepSeek / 豆包 / Kimi，再把回答粘回来' },
      { li: '懒得折腾 —— 手动点格子，也就十几下' },
      { p: '课表一学期只变一次，这一步值得慢一点。' },

      { h: '第三步，告诉它你缺什么' },
      { p: '「数据」页有个「我要凑够」：二课学分、志愿时长、每周跑几天。' },
      { p: '之前攒的学分和时长也能导进来，别从零开始算——否则它推给你的全是早就做完的事。' },

      { h: '第四步，勾活动' },
      { p: '二课、志愿、阳光乐跑三页，每条都带着分数和理由。' },
      { p: '勾一个会撞课的，整行抖一下，然后告诉你撞了谁、差几分钟。这是全场最值钱的一秒。' },
      { p: '「按推荐勾上」只是替你连点几下，勾完随时能取消。' },

      { h: '第五步，每天看一眼日程' },
      { p: '上面待结算，下面当天议程。课和活动排在同一条时间轴上，课是安静的灰蓝，活动按类型上色。' },
      { p: '底下两行小字：有没有早八、空档多长、这空档能塞进哪一场。' },
      { p: '活动结束自动掉进待结算，点「去了」或「没去」，记一笔。' },

      { h: '吃完抹嘴' },
      { p: '深浅色在右上角；壁纸在「我的」页，能直接读你电脑里 Wallpaper Engine 的库。' },
      { p: '它不报名，不爬数据，不碰你账号。三个数据源都连不上，为什么连不上，全写在「关于」页里。' }
    ]
    }, {
    id: 'policy',
    tag: '政策',
    title: '学分与阳光乐跑：手册里到底怎么写的',
    sub: '三条经常被搞混的要求，附文件号和页码',
    date: '2026-11-19',
    read: '6 分钟',
    body: [
      { p: '以下条款摘自《杭州电子科技大学学生手册》（2017 年版）。手册年纪不小了，具体执行以学院和教务处最新通知为准——但机制和主干要求基本没变。' },

      { h: '一、阳光乐跑算「天数」，不是「次数」' },
      { p: '这是最容易搞错的一条。体育部按「有效天数」计：一天跑一次算 1 天，一天跑三次也只算 1 天。小程序上那个数字是天数。' },
      { li: '单次距离：男生 2.0 公里，女生 1.5 公里。' },
      { li: '分数看天数：《体育1》的标准是 14 天 60 分、16 天 70、18 天 80、20 天 90、21 天 100。' },
      { li: '21 天以上就是加分：22 天 +1、24 天 +2、25 天 +3、26 天 +4、27 天 +5。' },
      { li: '少于 10 天，体育课平时分也是 0。' },
      { p: '场地时间：西区副馆南侧塑胶跑道 07:00–21:00，东区东田径场 07:00–21:00，北区西北田径场 18:30–21:00。' },
      { p: '刷脸那一刻就进入过程考核 —— 别锁屏、别切后台、别骑车代跑。乐跑违规者，体育课按缺考处理。' },
      { p: '以上来自杭电体联《体育1》课程学生乐跑时间通知（2026 年 10 月 25 日）。乐跑时间 2026-10-28 至 2026-12-18，约七周，校运会和法定节假日期间暂停。' },

      { h: '二、课外教育学分：讲座至少 8 次' },
      { p: '依据《本科生课外教育管理规定》（杭电教〔2013〕145 号，手册 P112–115），纳入学籍管理的课外教育项目共十来项。其中和我们排日程最相关的是这几个：' },
      { li: '讲座 · 选修 1 学分 · 第 1–8 学期 · 至少参加 8 次，其中校团委组织的至少 4 次' },
      { li: '课外读书活动 · 2 学分 · 读 8 本以上，每本交读书笔记' },
      { li: '社会实践 · 1 学分 · 至少参加 1 次，需介绍信回执和实践报告' },
      { p: '必修部分还有军训 1 学分、军事理论 1 学分、形势与政策 2 学分、心理健康 2 学分、毕业教育 1 学分、就业力促进 2.5 学分。这些是排进培养计划的，不用自己抢。' },

      { h: '三、创新与拓展学分：必修 2 分' },
      { p: '依据《创新与拓展学分认定管理办法》（杭电本〔2016〕110 号，手册 P118–120）：' },
      { li: '记入教务系统，课程名「创新学分」，学分 2，作为必修' },
      { li: '其中「学生科技竞赛」「科研活动」两项合计不少于 1 分' },
      { li: '拿到 4 分及以上记「优秀」，2 分以上不足 4 分记「合格」' },
      { li: '超过 2 分的部分，单项 3 分以上的项目可申请作任选课；科技类最多 8 学分，社会实践与文体类不超过 4 学分' },
      { p: '同一学年、同一项目不累加，只记最高分。每学年第二学期开学第二周申请，第五周反馈登记。' },

      { h: '四、这个网页怎么用这些数字' },
      { p: '「数据」页的「我要凑够」就是给你填这些目标的——二课学分、志愿时长、本周跑几天。它按你填的目标算缺口，再按缺口给每场活动打分。' },
      { p: '之所以让你自己填，而不是写死成「必修 2 分」：要求按年级、学院、年份都会变，写死的数字一旦过期，错的不是功能，是你。' },

      { h: '五、去哪儿确认最新版' },
      { p: '二课看素拓平台的活动公告和学院通知，创新与拓展学分看教务处每学年第二学期的申报通知，阳光乐跑看「杭电体联」公众号每学期发的推文。手册里写「本手册内容与学校文件不符的，以学校文件为准」——这句是关键。' }
    ]  }];

  function renderPosts() {
    var el = document.getElementById('postList');
    if (!el) return;

    var cnt = document.getElementById('articleCount');
    if (cnt) cnt.textContent = ARTICLES.length + ' 篇';

    el.innerHTML = ARTICLES.map(function (a) {
      return '<button class="post" type="button" data-article="' + a.id + '">' +
               '<span class="post-tag">' + esc(a.tag) + '</span>' +
               '<span class="post-main">' +
                 '<span class="post-title">' + esc(a.title) + '</span>' +
                 '<span class="post-sub">' + esc(a.sub) + '</span>' +
               '</span>' +
               '<span class="post-meta">' + esc(a.date) + ' · ' + esc(a.read) + '</span>' +
               '<span class="post-arrow">→</span>' +
             '</button>';
    }).join('');
  }

  function openArticle(id) {
    var a = null;
    ARTICLES.forEach(function (x) { if (x.id === id) a = x; });
    if (!a) return;

    document.getElementById('articleTitle').textContent = a.title;
    document.getElementById('articleMeta').textContent = a.date + ' · ' + a.read + ' · ' + a.tag;

    var html = a.body.map(function (b) {
      if (b.h) return '<h4 class="art-h">' + esc(b.h) + '</h4>';
      if (b.li) return '<p class="art-li">' + esc(b.li) + '</p>';
      return '<p class="art-p">' + esc(b.p) + '</p>';
    }).join('');
    document.getElementById('articleBody').innerHTML = html;
    document.getElementById('modalArticle').hidden = false;
    document.getElementById('articleBody').scrollTop = 0;
  }

  /* ---------------- 学期 / 早八 / 空档 ---------------- */

  function renderTerm() {
    var chip = document.getElementById('termChip');
    if (chip) chip.textContent = '第 ' + weekOf(state.weekStart) + ' 周';

    var inp = document.getElementById('termStart');
    if (inp && document.activeElement !== inp) {
      inp.value = (state.term && state.term.start) || '';
    }
    var tG = document.getElementById('termGrade');
    var tS = document.getElementById('termSem');
    if (tG && document.activeElement !== tG) tG.value = String((state.term && state.term.grade) || 1);
    if (tS && document.activeElement !== tS) tS.value = String((state.term && state.term.semester) || 1);

    var hint = document.getElementById('termHint');
    if (hint) hint.textContent = '现在是' + termLabel();
  }

  function dayCourses(d) {
    var wk = termWeek();
    return state.courses.filter(function (c) { return c.d === d && courseActive(c, wk); })
      .sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
  }

  function renderDayNote() {
    var el = document.getElementById('dayNote');
    if (!el) return;

    var d = state.activeDay;
    var cs = dayCourses(d);
    var evs = state.schedule.filter(function (e) { return e.d === d; });

    var bits = [];

    // 早八：这天第一节课在 9 点前
    if (cs.length && toMin(cs[0].start) <= 540) {
      bits.push('<span class="dn dn-early"><i>早八</i>' + esc(cs[0].start) + ' · ' + esc(cs[0].title) +
                (cs[0].place ? ' · ' + esc(cs[0].place) : '') + '</span>');
    }

    // 空档：08:00–22:00 之间，没被课和活动占掉的窗口
    var blocks = []
      .concat(cs.map(function (c) { return [toMin(c.start), toMin(c.end)]; }))
      .concat(evs.map(function (e) { return [toMin(e.start), toMin(e.end)]; }))
      .sort(function (a, b) { return a[0] - b[0]; });

    var gaps = [];
    var cur = 480;                    // 08:00
    blocks.forEach(function (b) {
      if (b[0] - cur >= 45) gaps.push([cur, b[0]]);
      if (b[1] > cur) cur = b[1];
    });
    if (1320 - cur >= 45) gaps.push([cur, 1320]);   // 到 22:00

    if (gaps.length) {
      var g = gaps[0];
      var mins = g[1] - g[0];
      var fit = state.events.filter(function (e) {
        return e.d === d && toMin(e.start) >= g[0] && toMin(e.end) <= g[1] &&
               state.chosenIds.indexOf(e.id) === -1;
      }).length;
      bits.push('<span class="dn dn-gap"><i>空档</i>' +
                minsToHHMM(g[0]) + '–' + minsToHHMM(g[1]) + '（' + mins + ' 分钟）' +
                (fit ? '，能塞下 ' + fit + ' 场' : '') + '</span>');
    }

    el.innerHTML = bits.join('');
    el.hidden = !bits.length;
  }

  /* ============================================================
     深浅色主题
     ============================================================ */

  var THEME_KEY = 'paidekai.theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(v) {
    var t = (v === 'dark') ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    renderThemeSeg();
    try {
      if (state && state.events && state.events.length) renderAll();
    } catch (e) {}
  }

  function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  function renderThemeSeg() {
    var box = document.getElementById('themeSeg');
    if (!box) return;
    var t = currentTheme();
    Array.prototype.forEach.call(box.querySelectorAll('[data-theme-v]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-theme-v') === t);
    });
  }

  /* ============================================================
     本地档案：没有后端时，成熟的做法是本机档案，不是假登录
     ============================================================ */

  var STORE_KEY = 'paidekai.v1';
  var AVATARS = ['🐱', '🐼', '🦊', '🐧', '🐸', '🦉', '🐙', '🌵'];
  var AV_BG = ['#EEF1FE', '#FDF0EE', '#E8F7F1', '#FFF6E0', '#F3EFFE', '#E6F7FF', '#F5F7FC', '#FDEFF5'];

  var store = null;
  var saveTimer = null;
  var gateMode = 'new';
  var gateAv = 0;
  var gateCustom = null;
  var gateGender = 'm';          // 'm' | 'f' | ''

  function isImgAv(a) {
    return typeof a === 'string' && a.indexOf('data:image') === 0;
  }

  function avHtml(av, idx, cls) {
    if (isImgAv(av)) {
      return '<span class="' + cls + ' avimg"><img src="' + av + '" alt=""></span>';
    }
    return '<span class="' + cls + '" style="background:' + AV_BG[idx % AV_BG.length] + '">' + esc(av) + '</span>';
  }

  // 把一张图裁成方形、缩到 160px，转成 dataURL 存本地
  function avatarFromFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('不是图片')); return; }

      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('读取失败')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片解码失败')); };
        img.onload = function () {
          var S = 160;
          var c = document.createElement('canvas');
          c.width = S;
          c.height = S;
          var g = c.getContext('2d');
          var k = Math.max(S / img.width, S / img.height);
          var w = img.width * k;
          var h = img.height * k;
          g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          resolve(c.toDataURL('image/jpeg', 0.86));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  var LEGACY_KEY = 'zhuangbushang.v1';   // 旧名字时期存下的档案

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      // 改名前的老档案：搬一次过来，别让人重新导入一遍
      if (!raw) {
        var oldRaw = localStorage.getItem(LEGACY_KEY);
        if (oldRaw) {
          localStorage.setItem(STORE_KEY, oldRaw);
          raw = oldRaw;
        }
      }
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStore(s) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
      return true;
    } catch (e) {
      return false;
    }
  }

  function stripEvent(e) {
    return {
      id: e.id, d: e.d, date: e.date, title: e.title, type: e.type, place: e.place,
      start: e.start, end: e.end,
      credit: e.credit || 0, volunteerHours: e.volunteerHours || 0, runKm: e.runKm || 0,
      capacity: isFinite(e.capacity) ? e.capacity : null,
      enrolled: e.enrolled || 0,
      deadline: e.deadline ? new Date(e.deadline).getTime() : null,
      tags: (e.tags || []).slice(),
      org: e.org || '',
      flex: !!e.flex,
      custom: !!e.custom
    };
  }

  function restoreEvent(r) {
    return {
      id: r.id, d: r.d, date: r.date, title: r.title, type: r.type, place: r.place,
      start: r.start, end: r.end,
      credit: r.credit || 0, volunteerHours: r.volunteerHours || 0, runKm: r.runKm || 0,
      capacity: r.capacity === null ? Infinity : r.capacity,
      enrolled: r.enrolled || 0,
      deadline: r.deadline ? new Date(r.deadline) : null,
      tags: (r.tags || []).slice(),
      org: r.org || '',
      flex: !!r.flex,
      custom: !!r.custom
    };
  }

  function snapshot() {
    var bgOk = state.bg && (state.bg.kind === 'default' || state.bg.kind === 'preset');
    return {
      goals: JSON.parse(JSON.stringify(state.goals)),
      interests: state.interests.slice(),
      profile: JSON.parse(JSON.stringify(state.profile)),
      busy: state.busy.slice(),
      courses: JSON.parse(JSON.stringify(state.courses)),
      // 演示池来自代码里的 RAW，不存档 —— 否则改一次数据，老档案永远看不到
      events: state.events.filter(function (e) { return e.custom; }).map(stripEvent),
      chosenIds: state.chosenIds.slice(),
      records: JSON.parse(JSON.stringify(state.records)),
      tasks: state.tasks.map(function (t) {
        return {
          id: t.id, title: t.title, course: t.course,
          due: t.due ? new Date(t.due).getTime() : null,
          done: !!t.done,
          fav: !!t.fav
        };
      }),
      maxPerDay: state.maxPerDay,
      run: JSON.parse(JSON.stringify(state.run)),
      history: JSON.parse(JSON.stringify(state.history || [])),
      mode: state.mode || 'demo',
      sources: JSON.parse(JSON.stringify(state.sources)),
      term: JSON.parse(JSON.stringify(state.term)),
      bg: bgOk ? JSON.parse(JSON.stringify(state.bg)) : { kind: 'default' },
      vision: {
        provider: state.vision.provider,
        baseUrl: state.vision.baseUrl,
        key: state.vision.key,
        model: state.vision.model
      }
    };
  }

  function applySnapshot(d) {
    if (d && d.run && !(d.run.len >= 15 && d.run.len <= 120)) d.run.len = 30;
    if (!d) return;

    if (d.goals) state.goals = d.goals;
    if (d.interests) state.interests = d.interests.slice();
    if (d.profile) state.profile = d.profile;
    if (d.maxPerDay) state.maxPerDay = d.maxPerDay;
    if (d.run) state.run = d.run;
    if (d.history) state.history = d.history;
    if (d.mode === 'demo' || d.mode === 'normal') state.mode = d.mode;
    if (d.sources) state.sources = d.sources;
    if (d.term) state.term = d.term;
    if (d.bg) state.bg = d.bg;
    if (d.vision) state.vision = d.vision;

    if (d.busy) state.busy = d.busy.slice();
    if (d.courses) state.courses = d.courses;
    uid = 0;                                         // 重建前重置，保证 id 稳定
    // 演示模式下重建活动池；正常模式下池子是空的，只留用户自己导入的
    state.events = (state.mode === 'demo') ? buildEvents() : [];
    if (d.events && d.events.length) {
      state.events = state.events.concat(d.events.map(restoreEvent));
    }
    if (d.chosenIds) state.chosenIds = d.chosenIds.slice();
    if (d.records) state.records = d.records;
    if (d.tasks) {
      state.tasks = d.tasks.map(function (t) {
        return {
          id: t.id, title: t.title, course: t.course,
          due: t.due ? new Date(t.due) : null,
          done: !!t.done,
          fav: !!t.fav
        };
      });
    }

    // 计数器对齐，避免新条目撞 id
    var maxN = 0;
    state.events.forEach(function (e) {
      var n = parseInt(String(e.id).replace(/\D/g, ''), 10);
      if (n > maxN) maxN = n;
    });
    uid = Math.max(uid, maxN);

    var mt = 0;
    state.tasks.forEach(function (t) {
      var n = parseInt(String(t.id).replace(/\D/g, ''), 10);
      if (n > mt) mt = n;
    });
    taskSeq = Math.max(taskSeq, mt);

    var mr = 0;
    state.records.forEach(function (r) {
      var n = parseInt(String(r.id).replace(/\D/g, ''), 10);
      if (n > mr) mr = n;
    });
    recSeq = Math.max(recSeq, mr);
  }

  function persist() {
    if (!store || !store.current) return;
    store.data = store.data || {};
    store.data[store.current] = snapshot();
    writeStore(store);
    state.savedAt = Date.now();
  }

  function saveSoon() {
    if (!store || !store.current) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      persist();
    }, 350);
  }

  function userNameOf(id) {
    var n = '';
    (store && store.users || []).forEach(function (u) { if (u.id === id) n = u.name; });
    return n || '未命名';
  }

  function agoText(ts) {
    if (!ts) return '尚未保存';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 10) return '刚刚保存';
    if (s < 60) return s + ' 秒前保存';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前保存';
    return '已保存';
  }

  /* ---------------- 建档 / 切换 ---------------- */

  function showGate(mode) {
    gateMode = mode || 'new';
    if (gateMode !== 'avatar') gateCustom = null;
    if (gateMode === 'new') gateGender = 'm';
    renderGate();
    document.getElementById('gate').hidden = false;
  }

  function hideGate() {
    var g = document.getElementById('gate');
    if (g) g.hidden = true;
  }

  function renderGate() {
    var users = (store && store.users) || [];
    var list = document.getElementById('gateUsers');
    var form = document.getElementById('gateForm');
    var titleEl = document.getElementById('gateTitle');
    var switchBtn = document.getElementById('gateSwitch');
    var nameRow = document.getElementById('gateNameRow');
    var goBtn = document.getElementById('gateGo');
    var avatarMode = (gateMode === 'avatar');

    if (gateMode === 'pick' && users.length) {
      list.innerHTML = users.map(function (u, i) {
        return '<button class="guser' + (u.id === store.current ? ' cur' : '') + '" type="button" data-uid="' + u.id + '">' +
                 avHtml(u.av, i, 'gav') +
                 '<span class="gname">' + esc(u.name) + '</span>' +
                 (u.id === store.current ? '<span class="gcur">当前</span>' : '') +
               '</button>';
      }).join('');
      list.hidden = false;
      form.hidden = true;
      titleEl.textContent = '选一个档案';
      switchBtn.hidden = false;
      switchBtn.textContent = '建个新的';
      return;
    }

    var gWrap = document.getElementById('gateGender');
    if (gWrap) {
      Array.prototype.forEach.call(gWrap.querySelectorAll('[data-g]'), function (b) {
        var on = b.getAttribute('data-g') === (gateGender || '');
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    list.innerHTML = '';
    list.hidden = true;
    form.hidden = false;
    if (nameRow) nameRow.hidden = avatarMode;
    if (goBtn) goBtn.textContent = avatarMode ? '保存头像' : '开始使用';

    if (avatarMode) {
      titleEl.textContent = '换个头像';
      switchBtn.hidden = true;
    } else {
      titleEl.textContent = users.length ? '新建一个档案' : '先给这个档案起个名字';
      switchBtn.hidden = !users.length;
      switchBtn.textContent = '返回选择';
    }

    renderAvs();
  }

  function renderAvs() {
    var box = document.getElementById('gateAvs');
    if (!box) return;

    box.innerHTML = AVATARS.map(function (a, i) {
      var on = !gateCustom && i === gateAv;
      return '<button type="button" class="gav-pick' + (on ? ' on' : '') +
             '" data-av="' + i + '" style="background:' + AV_BG[i % AV_BG.length] + '">' + a + '</button>';
    }).join('');

    var prev = document.getElementById('gateUploadPrev');
    var text = document.getElementById('gateUploadText');
    var up = document.getElementById('gateUpload');
    if (!prev) return;

    if (gateCustom) {
      prev.innerHTML = '<img src="' + gateCustom + '" alt="">';
      text.textContent = '换一张';
      up.classList.add('on');
    } else {
      prev.textContent = '＋';
      text.textContent = '上传自己的图片';
      up.classList.remove('on');
    }
  }

  function makeProfile(name) {
    var nm = String(name || '').trim().slice(0, 12);
    if (!nm) { toast('先起个名字'); return; }

    // 先把当前这个档案存下来，再建新的 —— 否则最后未保存的改动会丢
    if (store && store.current) persist();

    store = store || { ver: 1, current: null, users: [], data: {} };
    var id = 'u' + Date.now().toString(36);
    store.users.push({ id: id, name: nm, av: gateCustom || AVATARS[gateAv], gender: gateGender, at: Date.now() });
    // 学期信息跟着档案走
    var gg = document.getElementById('gateGrade');
    var ss = document.getElementById('gateSem');
    state.term = {
      start: (state.term && state.term.start) || STATE_DEFAULTS.term.start,
      grade: gg ? (parseInt(gg.value, 10) || 1) : 1,
      semester: ss ? (parseInt(ss.value, 10) || 1) : 1
    };
    store.current = id;

    seedData();          // 按当前模式铺数据
    persist();
    hideGate();
    refreshAll();
    toast('档案建好了，' + nm);
  }

  function currentUser() {
    var u = null;
    if (!store) return null;
    (store.users || []).forEach(function (x) { if (x.id === store.current) u = x; });
    return u;
  }

  function gateSubmit() {
    if (gateMode === 'avatar') {
      var u = currentUser();
      if (!u) return;
      u.av = gateCustom || AVATARS[gateAv];
      u.gender = gateGender;
      persist();
      hideGate();
      renderAccount();
      toast('资料改好了');
      return;
    }
    makeProfile(document.getElementById('gateName').value);
  }

  function openAvatarEditor() {
    var u = currentUser();
    if (!u) return;
    gateCustom = isImgAv(u.av) ? u.av : null;
    gateAv = Math.max(0, AVATARS.indexOf(isImgAv(u.av) ? '' : u.av));
    gateGender = u.gender || '';
    showGate('avatar');
  }

  function switchUser(id) {
    if (!store) return;
    persist();                       // 先把当前这个存下来

    store.current = id;
    var d = (store.data || {})[id];

    seedData();
    if (d) applySnapshot(d);

    persist();
    hideGate();
    refreshAll();
    toast('已切换到 ' + userNameOf(id));
  }

  function resetProfile() {
    if (!store || !store.current) return;
    seedData();
    persist();
    refreshAll();
    renderMode();
    toast(state.mode === 'demo' ? '已重置为演示数据' : '已清空');
  }

  function refreshAll() {
    renderHistSum();
    renderPanel();
    applyBg(state.bg || { kind: 'default' });
    regenerate();
    renderAccount();
  }

  /* ---------------- 「我的」页档案卡 ---------------- */

  function genderText(g) {
    return g === 'm' ? '男生' : (g === 'f' ? '女生' : '性别没填');
  }

  function toggleGender() {
    var u = currentUser();
    if (!u) return;
    u.gender = (u.gender === 'm') ? 'f' : 'm';   // 点一下切换，只有两态
    persist();
    renderAccount();
    toast(genderText(u.gender));
  }

  function renderAccount() {
    var el = document.getElementById('accountCard');
    if (!el || !store) return;

    var u = null;
    (store.users || []).forEach(function (x) { if (x.id === store.current) u = x; });
    if (!u) { el.innerHTML = ''; return; }

    var idx = store.users.indexOf(u);

    el.innerHTML =
      '<div class="ac">' +
        avHtml(u.av, idx, 'ac-av') +
        '<div class="ac-body">' +
          '<div class="ac-name">' + esc(u.name) + '</div>' +
          '<div class="ac-sub">' +
            '<button class="ac-gender" type="button" data-ac="gender" title="点击切换">' +
              genderText(u.gender) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="ac-act">' +
          '<button class="btn ghost sm" type="button" data-ac="avatar">换头像</button>' +
          '<button class="btn ghost sm" type="button" data-ac="switch">切换档案</button>' +
          '<button class="btn ghost sm" type="button" data-ac="new">新建</button>' +
        '</div>' +
      '</div>' +
      '<div class="ac-foot">' +
        '<span class="muted">换浏览器 / 换电脑：导出备份，在新浏览器导入即可复原</span>' +
        '<div class="ac-foot-act">' +
          '<button class="btn ghost sm" type="button" data-ac="export">导出备份</button>' +
          '<button class="btn ghost sm" type="button" data-ac="import">导入备份</button>' +
          '<button class="btn ghost sm" type="button" data-ac="widget">桌面挂件</button>' +
          '<button class="link-btn" type="button" data-ac="reset">重置</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    var bg = document.getElementById('btnGenerate');
    if (bg) bg.addEventListener('click', function () {
      regenerate();
      toast('已重新排程');
    });

    document.getElementById('btnCopy').addEventListener('click', copySchedule);

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', closeAllModals);
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeAllModals();
    });

    /* ---- 数据接入：三个适配器 ---- */

    document.getElementById('sources').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');

      if (act === 'run') {
        openRun();
      } else if (act === 'run-apply') {
        if (runLeft() <= 0) { toast('已经跑满，不用再排跑步'); return; }
        state.goals.run = Math.ceil(runPerWeek());
        document.getElementById('goalRun').value = state.goals.run;
        regenerate();
        toast('本周计划跑 ' + state.goals.run + ' 天');
      } else if (act === 'batch') {
        openImport('activities');
      } else if (act === 'table') {
        openImport('timetable');
      } else if (act === 'export') {
        downloadIcs();
      }
    });

    /* ---- 截图导入 ---- */

    document.getElementById('shotTabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('.stab');
      if (b) setShotKind(b.getAttribute('data-kind'));
    });

    document.getElementById('btnToText').addEventListener('click', function () {
      document.getElementById('modalShot').hidden = true;
      openImport(shot.kind === 'timetable' ? 'timetable' : 'activities');
    });

    var dz = document.getElementById('dropZone');
    dz.addEventListener('click', function () {
      document.getElementById('shotFile').click();
    });
    dz.addEventListener('dragover', function (e) {
      e.preventDefault();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', function () { dz.classList.remove('dragover'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('dragover');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadShotFile(f);
    });
    document.getElementById('shotFile').addEventListener('change', function () {
      if (this.files && this.files[0]) loadShotFile(this.files[0]);
      this.value = '';
    });

    // Ctrl+V 直接粘贴截图
    document.addEventListener('paste', function (ev) {
      if (document.getElementById('modalShot').hidden) return;
      var items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          var f = items[i].getAsFile();
          if (f) { ev.preventDefault(); loadShotFile(f); return; }
        }
      }
    });

    document.getElementById('shotPanel').addEventListener('click', function (ev) {
      var del = ev.target.closest('[data-del]');
      if (del) {
        shot.quick.splice(parseInt(del.getAttribute('data-del'), 10), 1);
        renderQuickList();
        return;
      }

      var mini = ev.target.closest('[data-mini]');
      if (mini) {
        var k = mini.getAttribute('data-mini');
        shot.manualBusy[k] = shot.manualBusy[k] ? 0 : 1;
        mini.setAttribute('aria-pressed', shot.manualBusy[k] ? 'true' : 'false');
        return;
      }

      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      if (btn.tagName === 'A') ev.preventDefault();

      var act = btn.getAttribute('data-act');
      if (act === 'save-vision') saveVisionFromDom();
      else if (act === 'test-vision') runVisionTest();
      else if (act === 'models') fetchModelList();
      else if (act === 'quick-connect') quickConnect();
      else if (act === 'use-dashscope') {
        state.vision.provider = 'dashscope';
        state.vision.baseUrl = PROVIDERS[0].base;
        saveVision();
        renderVisionCfg();
        toast('已切到阿里云百炼，填上 Key 点连接即可');
      }
      else if (act === 'vision') runVision();
      else if (act === 'reset') {
        shot.dataUrl = null;
        shot.items = [];
        document.getElementById('dropZone').hidden = false;
        document.getElementById('shotGrid').hidden = true;
      }
      else if (act === 'apply-grid') applyMiniGrid();
      else if (act === 'quick-add') quickAdd();
      else if (act === 'quick-apply') quickApply();
      else if (act === 'apply-vision') applyVision();
    });

    ['runDone', 'runTarget', 'runKm', 'runWeeks'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', renderRunPreview);
    });
    document.getElementById('btnRunApply').addEventListener('click', applyRun);

    document.getElementById('btnBatchSample').addEventListener('click', function () {
      document.getElementById('batchText').value = batchSampleText();
    });
    document.getElementById('btnBatchParse').addEventListener('click', function () {
      if (!document.getElementById('batchText').value.trim()) {
        toast('先把活动列表粘进来'); return;
      }
      parseBatch();
    });

    document.getElementById('btnTableSample').addEventListener('click', function () {
      document.getElementById('tableText').value =
        '周一 第1-2节 高等数学 三教201\n' +
        '周一 第3-4节 大学物理 三教305\n' +
        '周二 第1-2节 数据结构 二教108\n' +
        '周二 第5-6节 大学英语 一教210\n' +
        '周三 第3-4节 人工智能导论 三教401\n' +
        '周四 第5-6节 概率论与数理统计 三教210\n' +
        '周五 第1-2节 电路分析基础 二教305';
    });
    document.getElementById('btnTableParse').addEventListener('click', function () {
      if (!document.getElementById('tableText').value.trim()) {
        toast('先把课表粘进来'); return;
      }
      applyTimetable();
    });

    // 目标输入
    [['goalCredit', 'credit', parseFloat], ['goalVolunteer', 'volunteer', parseFloat], ['goalRun', 'run', parseInt]].forEach(function (cfg) {
      document.getElementById(cfg[0]).addEventListener('input', function () {
        var v = cfg[2](this.value);
        if (isNaN(v) || v < 0) v = 0;
        state.goals[cfg[1]] = v;
        regenerate();
      });
    });

    // 每日上限
    var mpIn = document.getElementById('maxPerDay');
    if (mpIn) mpIn.addEventListener('input', function () {
      state.maxPerDay = parseInt(this.value, 10);
      document.getElementById('maxPerDayVal').textContent = state.maxPerDay;
      regenerate();
    });

    // 兴趣 chips
    document.getElementById('interestChips').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-interest]');
      if (!btn) return;
      var tag = btn.getAttribute('data-interest');
      var i = state.interests.indexOf(tag);
      if (i === -1) state.interests.push(tag);
      else state.interests.splice(i, 1);
      btn.setAttribute('aria-pressed', String(i === -1));
      regenerate();
    });

    // 固定占用
    document.getElementById('busyGrid').addEventListener('click', function (ev) {
      var cell = ev.target.closest('.cell');
      if (!cell) return;
      var dayN = parseInt(cell.getAttribute('data-d'), 10);
      var slotN = cell.getAttribute('data-slot');
      var key = busyKey(dayN, slotN);
      var i = state.busy.indexOf(key);

      if (i === -1) {
        state.busy.push(key);
      } else {
        state.busy.splice(i, 1);
        // 关掉某个时段时，把落在里面的课程记录一起删掉，免得日程里还挂着
        var w = SLOTS[slotN];
        state.courses = state.courses.filter(function (c) {
          if (c.d !== dayN) return true;
          var a = toMin(c.start), b = toMin(c.end);
          return !(a < w[1] && w[0] < b);
        });
      }

      cell.setAttribute('aria-pressed', String(i === -1));
      regenerate();
    });

    // 打卡片上的「打分依据」
    document.getElementById('agenda').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.btn-score');
      if (!btn) return;
      var box = btn.closest('.ag-body').querySelector('.scores');
      if (!box) return;
      var hidden = box.classList.toggle('hide');
      btn.textContent = hidden ? '打分依据 ▾' : '打分依据 ▴';
    });

    /* ---- 页面切换：任何带 data-page 的元素都能跳 ---- */
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-page]');
      if (!b) return;
      ev.preventDefault();
      gotoPage(b.getAttribute('data-page'));
    });

    /* ---- 数据页：四张导入卡 ---- */
    document.getElementById('page-data').addEventListener('click', function (ev) {
      var card = ev.target.closest('[data-imp]');
      if (!card) return;
      var kind = card.getAttribute('data-imp');
      if (kind === 'shot') { openShot('timetable'); return; }
      openImport(kind);
    });

    /* ---- 星期切换 ---- */
    document.getElementById('daystrip').addEventListener('click', function (ev) {
      var chip = ev.target.closest('[data-d]');
      if (!chip) return;
      state.activeDay = parseInt(chip.getAttribute('data-d'), 10);
      renderDayStrip();
      renderAgenda();
    });

    /* ---- 导入中心 ---- */
    document.getElementById('btnAdd').addEventListener('click', function () { openImport('activities'); });
    document.getElementById('btnImportTable').addEventListener('click', function () { openImport('timetable'); });
    document.getElementById('btnImportTasks').addEventListener('click', function () { openImport('tasks'); });

    document.getElementById('impTabs').addEventListener('click', function (ev) {
      var tab = ev.target.closest('.itab');
      if (!tab) return;
      switchPane(tab.getAttribute('data-pane'));
    });

    document.getElementById('btnToShot').addEventListener('click', function () {
      document.getElementById('modalText').hidden = true;
      openShot('timetable');
    });

    // 复制提示词 / 看看它写了什么
    document.addEventListener('click', function (ev) {
      var cp = ev.target.closest('[data-copy]');
      if (cp) {
        ev.preventDefault();
        copyText(PROMPTS[cp.getAttribute('data-copy')] || '', '提示词已复制，去粘给 AI 吧');
        return;
      }
      var pk = ev.target.closest('[data-peek]');
      if (pk) {
        ev.preventDefault();
        peekKind = pk.getAttribute('data-peek');
        document.getElementById('peekBody').textContent = PROMPTS[peekKind] || '';
        document.getElementById('modalPeek').hidden = false;
        return;
      }

      /* ---- 兴趣侧写 ---- */
      if (ev.target.closest('#btnQuiz')) { openQuiz(); return; }

      var qo = ev.target.closest('.qopt');
      if (qo) {
        pickQuizOption(qo.getAttribute('data-q'), qo.getAttribute('data-k'),
                       qo.getAttribute('data-multi') === '1');
        return;
      }

      /* ---- 列表批量操作 ---- */
      var pa = ev.target.closest('[data-pickall]');
      if (pa) { pickAllRecommended(pa.getAttribute('data-pickall')); return; }

      var cl = ev.target.closest('[data-clear]');
      if (cl) { clearPicked(cl.getAttribute('data-clear')); return; }
    });

    // 勾选活动 → 立刻进/出日程
    document.addEventListener('change', function (ev) {
      var cb = ev.target;
      if (!cb || cb.type !== 'checkbox') return;
      var eid = cb.getAttribute('data-eid');
      if (!eid) return;
      togglePick(eid);
    });

    /* ---- 编辑活动 / 已编辑 ---- */
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-pickmode]');
      if (!b) return;
      state.pickMode = b.getAttribute('data-pickmode');
      renderPick('course');
      renderPick('volunteer');
      renderPick('run');
    });

    /* ---- 替换确认 ---- */
    var cfOk = document.getElementById('cfOk');
    if (cfOk) {
      cfOk.addEventListener('click', function () {
        var cb = confirmCb;
        closeConfirm();
        if (cb) cb();
      });
    }
    var cfCancel = document.getElementById('cfCancel');
    if (cfCancel) cfCancel.addEventListener('click', closeConfirm);

    var btnMode = document.getElementById('btnMode');
    if (btnMode) btnMode.addEventListener('click', function () {
      applyMode(state.mode === 'demo' ? 'normal' : 'demo');
    });

    var cfSave = document.getElementById('cfSave');
    if (cfSave) cfSave.addEventListener('click', saveCourseFromForm);

    var cfCancel = document.getElementById('cfCancel');
    if (cfCancel) cfCancel.addEventListener('click', function () { fillCourseForm(null); });

    var cList = document.getElementById('courseList');
    if (cList) {
      cList.addEventListener('click', function (ev) {
        var e1 = ev.target.closest('[data-cedit]');
        if (e1) {
          var id = e1.getAttribute('data-cedit');
          var cur = null;
          state.courses.forEach(function (x) { if (x.id === id) cur = x; });
          if (cur) fillCourseForm(cur);
          return;
        }
        var e2 = ev.target.closest('[data-cdel]');
        if (e2) removeCourse(e2.getAttribute('data-cdel'));
      });
    }

    var btnCourse = document.getElementById('btnCourse');
    if (btnCourse) btnCourse.addEventListener('click', openCourseEditor);

    var tG = document.getElementById('termGrade');
    var tS = document.getElementById('termSem');
    function saveGrade() {
      var g = parseInt(tG.value, 10) || 1;
      var s = parseInt(tS.value, 10) || 1;
      state.term = state.term || {};
      state.term.grade = g;
      state.term.semester = s;
      var warn = document.getElementById('termWarn');
      if (warn) warn.hidden = false;
      regenerate();
      saveSoon();
    }
    if (tG) tG.addEventListener('change', saveGrade);
    if (tS) tS.addEventListener('change', saveGrade);

    var btnHist = document.getElementById('btnHistory');
    if (btnHist) btnHist.addEventListener('click', openHistory);

    var btnHistPrompt = document.getElementById('btnHistPrompt');
    if (btnHistPrompt) btnHistPrompt.addEventListener('click', function () {
      copyText(HIST_PROMPT, '提示词已复制，去粘给 AI 吧');
    });

    var btnHistOk = document.getElementById('btnHistOk');
    if (btnHistOk) btnHistOk.addEventListener('click', applyHistory);

    var btnHistClear = document.getElementById('btnHistClear');
    if (btnHistClear) btnHistClear.addEventListener('click', clearHistory);

    var rl = document.getElementById('runLen');
    if (rl) {
      rl.value = runLen();
      rl.addEventListener('change', function () {
        var v = parseInt(this.value, 10);
        if (!(v >= 15 && v <= 120)) v = 30;
        this.value = v;
        state.run.len = v;
        rebuild();
        refreshAll();
        saveSoon();
        toast('每次乐跑按 ' + v + ' 分钟排');
      });
    }

    var btnExportDay = document.getElementById('btnExportDay');
    if (btnExportDay) {
      btnExportDay.addEventListener('click', function () { openExport('day'); });
    }

    /* ---- 导出模块的四个入口 ---- */
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-exp2]');
      if (!b) return;
      ev.preventDefault();
      var k = b.getAttribute('data-exp2');
      if (k === 'week-png') exportSchedulePng();
      else if (k === 'week-pdf') exportSchedulePdf();
      else if (k === 'week-ics') downloadIcs();
      else if (k === 'day') openExport('day');
    });

    /* ---- 导出课表 ---- */
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-exp]');
      if (!b) return;
      ev.preventDefault();
      runExport(b.getAttribute('data-exp'));
    });

    /* ---- 收藏 ---- */
    document.addEventListener('click', function (ev) {
      var s = ev.target.closest('[data-fav]');
      if (!s) return;
      ev.preventDefault();
      ev.stopPropagation();
      toggleTaskFav(s.getAttribute('data-fav'));
    });

    /* ---- 文章 ---- */
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-article]');
      if (!a) return;
      ev.preventDefault();
      openArticle(a.getAttribute('data-article'));
    });

    /* ---- 学期开学日 ---- */
    var termStart = document.getElementById('termStart');
    if (termStart) {
      termStart.addEventListener('change', function () {
        if (!this.value) return;
        state.term = { start: this.value };
        renderTerm();
        renderHero();
        renderMarquee();
        saveSoon();
        toast('开学日已设为 ' + this.value);
      });
    }

    /* ---- 深浅色 ---- */
    var themeBtn = document.getElementById('btnTheme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    var themeSeg = document.getElementById('themeSeg');
    if (themeSeg) {
      themeSeg.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-theme-v]');
        if (b) applyTheme(b.getAttribute('data-theme-v'));
      });
    }

    /* ---- 本地档案 ---- */
    var gateG = document.getElementById('gateGender');
    if (gateG) {
      gateG.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-g]');
        if (!b) return;
        gateGender = b.getAttribute('data-g') || '';
        renderGate();
      });
    }

    var gateGo = document.getElementById('gateGo');
    if (gateGo) gateGo.addEventListener('click', gateSubmit);

    var gateUpload = document.getElementById('gateUpload');
    if (gateUpload) {
      gateUpload.addEventListener('click', function () {
        document.getElementById('gateAvFile').click();
      });
    }

    var gateAvFile = document.getElementById('gateAvFile');
    if (gateAvFile) {
      gateAvFile.addEventListener('change', function () {
        var f = this.files && this.files[0];
        this.value = '';
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) { toast('图片太大了，换一张小的'); return; }
        avatarFromFile(f).then(function (dataUrl) {
          gateCustom = dataUrl;
          renderAvs();
          toast('图片读好了，记得点保存');
        }).catch(function () {
          toast('这张图读不了，换一张试试');
        });
      });
    }

    var gateNameEl = document.getElementById('gateName');
    if (gateNameEl) {
      gateNameEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') gateSubmit();
      });
    }

    var gateAvsEl = document.getElementById('gateAvs');
    if (gateAvsEl) {
      gateAvsEl.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-av]');
        if (!b) return;
        gateAv = parseInt(b.getAttribute('data-av'), 10) || 0;
        renderAvs();
      });
    }

    var gateUsersEl = document.getElementById('gateUsers');
    if (gateUsersEl) {
      gateUsersEl.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-uid]');
        if (b) switchUser(b.getAttribute('data-uid'));
      });
    }

    var gateSwitchEl = document.getElementById('gateSwitch');
    if (gateSwitchEl) {
      gateSwitchEl.addEventListener('click', function () {
        showGate(gateMode === 'pick' ? 'new' : 'pick');
      });
    }

    var acEl = document.getElementById('accountCard');
    if (acEl) {
      acEl.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-ac]');
        if (!b) return;
        var k = b.getAttribute('data-ac');
        if (k === 'gender') toggleGender();
        else if (k === 'export') exportBackup();
        else if (k === 'import') pickBackupFile();
        else if (k === 'widget') openWidget();
        else if (k === 'avatar') openAvatarEditor();
        else if (k === 'switch') showGate('pick');
        else if (k === 'new') showGate('new');
        else if (k === 'reset') {
          if (window.confirm('把这个档案重置回演示数据？')) resetProfile();
        }
      });
    }

    // 关页面前再存一次，防止最后几百毫秒的改动丢掉
    window.addEventListener('beforeunload', function () {
      if (store && store.current) persist();
    });
    document.getElementById('btnQuizDone').addEventListener('click', applyQuiz);
    document.getElementById('btnQuizReset').addEventListener('click', function () {
      quizAns = { prefer: [], style: '', motive: '', when: [], dur: '' };
      renderQuiz();
    });

    /* ---- 结算 ---- */
    document.getElementById('settleList').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-settle]');
      if (!b) return;
      settleRecord(b.getAttribute('data-settle'), b.getAttribute('data-ok') === '1');
    });

    /* ---- 背景 / 壁纸 ---- */
    document.getElementById('btnWeImport').addEventListener('click', function () {
      document.getElementById('weDir').click();
    });
    document.getElementById('weDir').addEventListener('change', function () {
      importWallpapers(this.files);
      this.value = '';
    });

    document.getElementById('btnBgFile').addEventListener('click', function () {
      document.getElementById('bgFile').click();
    });
    document.getElementById('bgFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      var url = URL.createObjectURL(f);
      var isVid = /^video\//.test(f.type);
      applyBg({ kind: isVid ? 'video' : 'image', url: url, id: 'local', name: f.name });
      toast(isVid ? '视频背景已应用' : '背景已应用');
    });

    document.getElementById('btnBgReset').addEventListener('click', function () {
      applyBg({ kind: 'default' });
      toast('回到默认背景');
    });

    document.getElementById('bgGrid').addEventListener('click', function (ev) {
      var d = ev.target.closest('[data-bg]');
      if (d) { applyBg({ kind: 'default' }); return; }

      var p = ev.target.closest('[data-bgpreset]');
      if (p) { applyBg({ kind: 'preset', id: p.getAttribute('data-bgpreset') }); return; }

      var w = ev.target.closest('[data-wall]');
      if (w) {
        var id = w.getAttribute('data-wall');
        var item = null;
        state.wallpapers.forEach(function (x) { if (x.id === id) item = x; });
        if (!item) return;
        applyBg({
          kind: item.kind === 'video' ? 'video' : 'image',
          url: item.mediaUrl || item.previewUrl,
          poster: item.previewUrl,
          id: item.id,
          name: item.name
        });
        toast('已换成「' + item.name + '」');
      }
    });

    document.getElementById('btnPeekCopy').addEventListener('click', function () {
      copyText(PROMPTS[peekKind] || '', '提示词已复制');
    });

    /* ---- 作业 ---- */
    document.getElementById('btnTaskSample').addEventListener('click', function () {
      document.getElementById('taskText').value =
        '完成 AIGC 大赛项目文档初稿 | 2026-11-21 23:59 | 生成式人工智能应用基础\n' +
        '第十章习题 3、5、7 | 11-23 18:00 | 高等数学\n' +
        '小组展示 PPT 定稿 | 11-26 | 大学英语\n' +
        '实验报告：RC 电路幅频特性 | 11-30 12:00 | 电路分析基础';
    });

    document.getElementById('btnTaskParse').addEventListener('click', function () {
      if (!document.getElementById('taskText').value.trim()) {
        toast('先把作业清单粘进来'); return;
      }
      parseTasksInto();
    });

    document.getElementById('todoList').addEventListener('click', function (ev) {
      var chk = ev.target.closest('.td-check');
      if (!chk) return;
      var row = chk.closest('.td');
      if (row) completeTask(row.getAttribute('data-id'), row);
    });
  }

  /* ---------------- 启动 ---------------- */

  // 正常模式：什么都不铺，连活动池也是空的，全靠用户自己导入
  function seedEmpty() {
    state.courses = [];
    state.busy = [];
    state.events = [];
    state.tasks = [];
    state.records = [];
    state.chosenIds = [];
    state.history = [];

    uid = 0;
    taskSeq = 0;
    recSeq = 0;

    state.goals = JSON.parse(JSON.stringify(STATE_DEFAULTS.goals));
    state.interests = STATE_DEFAULTS.interests.slice();
    state.profile = JSON.parse(JSON.stringify(STATE_DEFAULTS.profile));
    state.maxPerDay = STATE_DEFAULTS.maxPerDay;
    state.run = { done: 0, target: 21, km: 0, weeksLeft: 4, len: 30 };
    state.sources = JSON.parse(JSON.stringify(STATE_DEFAULTS.sources));
    state.term = JSON.parse(JSON.stringify(STATE_DEFAULTS.term));
    state.bg = { kind: 'default' };
  }

  // 按当前模式铺数据
  function seedData() {
    if (state.mode === 'demo') seedDemo();
    else seedEmpty();
  }

  function renderMode() {
    var b = document.getElementById('btnMode');
    if (!b) return;
    var demo = state.mode === 'demo';
    b.textContent = demo ? '演示模式' : '正常模式';
    b.classList.toggle('is-normal', !demo);
    b.title = demo ? '当前是演示模式 —— 点一下切到正常模式（清空样例数据）'
                   : '当前是正常模式 —— 点一下切回演示模式（重新铺样例数据）';
  }

  function applyMode(mode) {
    if (mode === state.mode) return;
    var toDemo = (mode === 'demo');
    var msg = toDemo
      ? '切回演示模式会重新铺一份样例数据，当前这个档案里的内容会被覆盖。继续？'
      : '切到正常模式会清空这个档案里的演示数据（课表、作业、活动、结算记录），变成空白，之后靠你自己导入。继续？';
    if (window.confirm && !window.confirm(msg)) return;

    try {
      state.mode = mode;
      seedData();
      persist();
      refreshAll();
      gotoPage('home');
      toast(toDemo ? '已切到演示模式' : '已切到正常模式 —— 去「数据」页导入你的课表');
    } catch (err) {
      // 兜底：切模式失败也别把页面搞崩
      if (window.console) console.error('[排得开] 切模式失败：', err);
      try { refreshAll(); } catch (e2) {}
      toast('切换时出了点问题，已恢复');
    }
  }

  // 铺一份完整的演示数据（新建档案、重置档案都走这里）
  function seedDemo() {
    state.courses = [];
    state.busy = [];
    state.events = [];
    state.tasks = [];
    state.records = [];
    state.chosenIds = [];

    uid = 0;
    taskSeq = 0;
    recSeq = 0;

    // 用户偏好也回到出厂值，免得新档案继承上一个档案的目标
    state.goals = JSON.parse(JSON.stringify(STATE_DEFAULTS.goals));
    state.interests = STATE_DEFAULTS.interests.slice();
    state.profile = JSON.parse(JSON.stringify(STATE_DEFAULTS.profile));
    state.maxPerDay = STATE_DEFAULTS.maxPerDay;
    state.run = JSON.parse(JSON.stringify(STATE_DEFAULTS.run));
    state.sources = JSON.parse(JSON.stringify(STATE_DEFAULTS.sources));
    state.term = JSON.parse(JSON.stringify(STATE_DEFAULTS.term));
    state.bg = { kind: 'default' };

    // 默认课表（照着杭电助手的真实课表抄了一份，节次用 a-b 表示）
    COURSE_SEED.forEach(function (c) {
      var s0 = PERIOD_TIME[c.a] || PERIOD_TIME[1];
      var s1 = PERIOD_TIME[c.b] || s0;
      state.courses.push({
        id: 'c' + (++cid),
        d: c.d, start: s0[0], end: s1[1], title: c.title, place: c.place,
        weeks: c.weeks || { from: 1, to: 16, parity: 'all' }
      });
      slotsForSpan(c.a, c.b).forEach(function (s) {
        var k = busyKey(c.d, s);
        if (state.busy.indexOf(k) === -1) state.busy.push(k);
      });
    });

    state.events = buildEvents();

    // 演示用的几条作业：故意有已经过期的、也有今晚到期的
    TASK_SEED.forEach(function (t) {
      addTask(t.title, t.course, t.due(), true);
    });

    // 过去几天的活动记录：有的已结算，有的还等你给个说法
    seedRecord('大模型应用开发工作坊（第二期）', 'practice', -6, '19:00', '21:00', 0.4, 0, 'done');
    seedRecord('图书馆志愿服务 · 书目整理', 'volunteer', -5, '14:00', '16:00', 0, 2, 'done');
    seedRecord('校园歌手大赛 · 复赛', 'art', -4, '19:00', '21:00', 0.2, 0, 'missed');
    seedRecord('「AI＋公益」志愿者培训', 'volunteer', -2, '12:30', '13:30', 0, 1, 'done');
    seedRecord('「挑战杯」竞赛宣讲会（上一场）', 'competition', -1, '18:30', '20:00', 0.25, 0, 'pending');
    seedRecord('阳光乐跑', 'sports', -1, '19:00', '19:45', 0, 0, 'pending');

    // 演示数据铺好后，默认把推荐项勾上
    scoreAll();
    state.chosenIds = recommend().ids;
  }

  /* ---------------- PWA：离线 + 安装 ---------------- */

  var installEvt = null;

  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function renderInstall() {
    var tip = document.getElementById('installTip');
    var btn = document.getElementById('btnInstall');
    if (!tip || !btn) return;

    if (isStandalone()) {
      tip.textContent = '已经装好了 —— 现在就是独立应用模式。';
      btn.hidden = true;
      return;
    }
    if (installEvt) {
      tip.textContent = '装完就是一个独立应用：桌面有图标、打开全屏、断网也能用。';
      btn.hidden = false;
      return;
    }
    btn.hidden = true;
    tip.textContent = isIOS()
      ? 'iPhone / iPad：Safari 里点底部「分享」→「添加到主屏幕」。'
      : '手机用 Chrome / Edge，电脑用 Chrome / Edge，地址栏右侧会出现「安装」图标；也可以直接点浏览器菜单里的「安装」或「添加到主屏幕」。';
  }

  // 手机上把导航移到 body 下：顶栏有 backdrop-filter，会变成 fixed 的定位容器
  function placeNav() {
    var nav = document.getElementById('nav');
    var bar = document.querySelector('.topbar');
    if (!nav || !bar) return;
    var mobile = window.innerWidth <= 640;
    if (mobile) {
      if (nav.parentElement !== document.body) document.body.appendChild(nav);
      nav.classList.add('tabbar');
    } else {
      if (nav.parentElement !== bar) bar.appendChild(nav);
      nav.classList.remove('tabbar');
    }
  }

  function setupPWA() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installEvt = e;
      renderInstall();
    });

    window.addEventListener('appinstalled', function () {
      installEvt = null;
      renderInstall();
      toast('装好了，桌面找「排得开」');
    });

    var btn = document.getElementById('btnInstall');
    if (btn) {
      btn.addEventListener('click', function () {
        if (!installEvt) return;
        installEvt.prompt();
        installEvt.userChoice.then(function () {
          installEvt = null;
          renderInstall();
        });
      });
    }

    renderInstall();
    placeNav();
    window.addEventListener('resize', placeNav);

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  /* ============================================================
     附加模块：定位距离 / 图片灯箱 / 3D 校园入口
     全部在 JS 里创建 DOM，index.html 不用改一行
     ============================================================ */

  var GEO_LAT = 30.3199, GEO_LNG = 120.3527;
  var DIRS8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

  function geoDistance(lat1, lon1, lat2, lon2) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function geoBearing(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180;
    var y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    var x = Math.cos(lat1 * r) * Math.sin(lat2 * r) -
            Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  var EXTRAS_CSS = [
    '.zbs-fab{position:fixed;right:16px;z-index:60;width:52px;height:52px;border-radius:50%;',
    'display:grid;place-items:center;cursor:pointer;font-family:inherit;',
    'box-shadow:0 12px 26px -14px rgba(19,24,41,.55);transition:transform .16s ease}',
    '.zbs-fab:hover{transform:translateY(-2px)}',
    '.zbs-geo{background:linear-gradient(140deg,var(--brand),var(--accent));color:#fff;',
    'border:0;font-size:12px;font-weight:800}',
    '.zbs-c3d{background:var(--surface);color:var(--brand-ink);border:1px solid var(--line);',
    'text-decoration:none;font-size:13px;font-weight:900}',
    '@media(max-width:640px){.zbs-geo{bottom:calc(84px + env(safe-area-inset-bottom))}',
    '.zbs-c3d{bottom:calc(144px + env(safe-area-inset-bottom))}}',
    '@media(min-width:641px){.zbs-geo{bottom:28px}.zbs-c3d{bottom:88px}}',
    '.zbs-mask{position:fixed;inset:0;z-index:120;display:none;place-items:center;padding:16px}',
    '.zbs-veil{position:absolute;inset:0;background:rgba(8,10,16,.72);backdrop-filter:blur(6px)}',
    '.zbs-card{position:relative;width:min(420px,100%);background:var(--surface);',
    'border:1px solid var(--line);border-radius:18px;padding:20px;',
    'box-shadow:0 30px 80px -40px rgba(0,0,0,.9)}',
    '.zbs-k{margin:0;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}',
    '.zbs-card h3{margin:3px 0 0;font-size:19px;font-weight:800;color:var(--ink)}',
    '.zbs-addr{margin:12px 0 2px;font-size:12px;color:var(--ink-2);line-height:1.6}',
    '.zbs-note{margin:0;font-size:10.5px;color:var(--muted)}',
    '.zbs-body{margin:14px 0;padding:14px;border-radius:12px;background:var(--surface-2);',
    'border:1px solid var(--line)}',
    '.zbs-hint{margin:0;font-size:12px;color:var(--muted);line-height:1.7}',
    '.zbs-num{font-size:28px;font-weight:900;letter-spacing:-.03em;color:var(--ink)}',
    '.zbs-num small{font-size:13px;font-weight:700;margin-left:3px;color:var(--muted)}',
    '.zbs-dir{margin-top:4px;font-size:12px;color:var(--brand-ink);font-weight:700}',
    '.zbs-acts{display:flex;gap:8px;flex-wrap:wrap}',
    '.zbs-ok{padding:8px 14px;border-radius:10px;border:0;background:var(--brand);color:#fff;',
    'font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}',
    '.zbs-ghost{padding:8px 14px;border-radius:10px;border:1px solid var(--line);',
    'background:var(--surface-2);color:var(--brand-ink);font-size:12px;font-weight:700;',
    'text-decoration:none;display:inline-block}',
    '.zbs-x{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:8px;',
    'border:1px solid var(--line);background:var(--surface-2);cursor:pointer;color:var(--ink-2)}',
    '.zbs-lb{position:fixed;inset:0;z-index:200;display:none;place-items:center;',
    'background:rgba(8,10,16,.94);padding:20px}',
    '.zbs-lb img{max-width:94vw;max-height:86vh;border-radius:12px;display:block}',
    '.zbs-lb-x{position:absolute;top:18px;right:18px;width:38px;height:38px;border-radius:50%;',
    'border:0;background:rgba(255,255,255,.16);color:#fff;font-size:15px;cursor:pointer}'
  ].join('');

  function setupExtras() {
    if (document.getElementById('zbsExtras')) return;

    var st = document.createElement('style');
    st.id = 'zbsExtras';
    st.textContent = EXTRAS_CSS;
    document.head.appendChild(st);

    /* ---- 3D 入口 ---- */
    var c3d = document.createElement('a');
    c3d.className = 'zbs-fab zbs-c3d';
    c3d.href = 'campus.html';
    c3d.textContent = '3D';
    c3d.title = '3D 校园地图';
    document.body.appendChild(c3d);

    /* ---- 定位 ---- */
    var geoBtn = document.createElement('button');
    geoBtn.type = 'button';
    geoBtn.className = 'zbs-fab zbs-geo';
    geoBtn.textContent = '定位';
    geoBtn.title = '算一下我离校区多远';
    document.body.appendChild(geoBtn);

    var mask = document.createElement('div');
    mask.className = 'zbs-mask';
    mask.innerHTML =
      '<div class="zbs-veil"></div>' +
      '<div class="zbs-card">' +
        '<button class="zbs-x" type="button" aria-label="关闭">✕</button>' +
        '<p class="zbs-k">Live location</p>' +
        '<h3>我的位置</h3>' +
        '<p class="zbs-addr">杭州电子科技大学 · 下沙校区 · 学源街 1158 号</p>' +
        '<p class="zbs-note">只在本机计算，不上传</p>' +
        '<div class="zbs-body"><p class="zbs-hint">点下面按钮，浏览器会问你要不要授权定位。</p></div>' +
        '<div class="zbs-acts">' +
          '<button class="zbs-ok" type="button">允许定位</button>' +
          '<a class="zbs-ghost" target="_blank" rel="noopener" ' +
            'href="https://uri.amap.com/marker?position=120.3527,30.3199">在高德打开</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    var body = mask.querySelector('.zbs-body');
    var ok = mask.querySelector('.zbs-ok');

    function closeGeo() { mask.style.display = 'none'; }
    geoBtn.addEventListener('click', function () { mask.style.display = 'grid'; });
    mask.querySelector('.zbs-x').addEventListener('click', closeGeo);
    mask.querySelector('.zbs-veil').addEventListener('click', closeGeo);

    ok.addEventListener('click', function () {
      if (!navigator.geolocation) {
        body.innerHTML = '<p class="zbs-hint">这个浏览器不支持定位。</p>';
        return;
      }
      body.innerHTML = '<p class="zbs-hint">正在定位…</p>';
      navigator.geolocation.getCurrentPosition(function (pos) {
        var m = geoDistance(pos.coords.latitude, pos.coords.longitude, GEO_LAT, GEO_LNG);
        var b = geoBearing(pos.coords.latitude, pos.coords.longitude, GEO_LAT, GEO_LNG);
        var txt = m < 1000 ? Math.round(m) + '<small>米</small>'
                           : (m / 1000).toFixed(1) + '<small>公里</small>';
        body.innerHTML = '<div class="zbs-num">' + txt + '</div>' +
          '<div class="zbs-dir">校区在你 ' + DIRS8[Math.round(b / 45) % 8] +
          ' 方向 · 方位角 ' + Math.round(b) + '°</div>' +
          '<p class="zbs-hint" style="margin-top:8px">定位精度约 ' +
          Math.round(pos.coords.accuracy || 0) + ' 米</p>';
        ok.textContent = '重新定位';
      }, function () {
        body.innerHTML = '<p class="zbs-hint">定位被拒绝或失败 —— 可以点「在高德打开」手动看路线。</p>';
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });

    /* ---- 灯箱 ---- */
    var lb = document.createElement('div');
    lb.className = 'zbs-lb';
    lb.innerHTML = '<button class="zbs-lb-x" type="button" aria-label="关闭">✕</button><img alt="">';
    document.body.appendChild(lb);
    var lbImg = lb.querySelector('img');

    function closeLb() { lb.style.display = 'none'; lbImg.removeAttribute('src'); }
    lb.addEventListener('click', function (e) {
      if (e.target !== lbImg) closeLb();
    });

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (t.closest('.zbs-lb') || t.closest('a')) return;
      if ((t.naturalWidth || 0) < 400) return;
      lbImg.src = t.currentSrc || t.src;
      lb.style.display = 'grid';
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeGeo();
      closeLb();
    });
  }

  function init() {
    setupPWA();
    setupExtras();
    loadVision();

    seedData();

    state.activeDay = 0;
    state.impPane = 'activities';

    // 有本地档案就恢复，没有就先让人建档
    store = readStore();
    var restored = false;
    if (store && store.users && store.users.length) {
      if (!store.current || !(store.data || {})[store.current]) {
        store.current = store.users[0].id;
      }
      var saved = (store.data || {})[store.current];
      if (saved) {
        applySnapshot(saved);
        restored = true;
      }
    }

    renderPanel();
    bind();

    if (restored) hideGate(); else showGate('new');

    // 第一次进来才自动勾推荐；恢复存档时尊重用户上次的选择
    if (!restored) {
      scoreAll();
      state.chosenIds = recommend().ids;
    }

    regenerate();
    gotoPage('home');
    applyBg(state.bg || { kind: 'default' });

    // 打开页面先看看有没有快过期的
    setTimeout(function () { checkTaskWarning(); }, 700);

    // 仅用于自动化测试与调试：index.html?debug=1
    if (/[?&]debug=1/.test(location.search)) {
      window.__pdk = {
        state: state, shot: shot,
        openShot: openShot, showShotWork: showShotWork,
        runVision: runVision, toEvent: toEvent,
        parseJsonLoose: parseJsonLoose, conflictOf: conflictOf,
        classifyVisionError: classifyVisionError,
        openImport: openImport, switchPane: switchPane,
        parseTaskLines: parseTaskLines, addTask: addTask,
        PROMPTS: PROMPTS,
        applyBg: applyBg, store: function () { return store; },
        makeProfile: makeProfile, switchUser: switchUser,
        persist: persist, snapshot: snapshot, seedDemo: seedDemo,
        avatarFromFile: avatarFromFile, openAvatarEditor: openAvatarEditor, gateSubmit: gateSubmit,
        applyTheme: applyTheme, currentTheme: currentTheme,
        state: state, store: store,
        openExport: openExport, drawScheduleCanvas: drawScheduleCanvas, pdfFromJpeg: pdfFromJpeg,
        drawDayCanvas: drawDayCanvas
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
