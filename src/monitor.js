const t12306 = require('./t12306');
const push = require('./push');
const db = require('./db');
const config = require('./config');

let timer = null;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nowHM() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

function todayStr() {
  return fmt(new Date());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function addMonitor(task) {
  const list = db.getMonitors();
  const type = task.type || 'watch';
  const item = {
    id: genId(),
    active: true,
    createdAt: Date.now(),
    type,
    intervalSec: task.intervalSec || config.pollIntervalSec,
    ...task,
  };
  if (type === 'daily') {
    item.pushTime = task.pushTime || '08:00';
    item.days = task.days || 7;
    item.lastPushDate = null;
  } else {
    item.lastHitKey = null;
    item.lastHitAt = null;
  }
  list.push(item);
  db.saveMonitors(list);
  return item;
}

function listMonitors() {
  return db.getMonitors();
}

function removeMonitor(id) {
  const list = db.getMonitors().filter((m) => m.id !== id);
  db.saveMonitors(list);
}

function toggleMonitor(id, active) {
  const list = db.getMonitors();
  const item = list.find((m) => m.id === id);
  if (item) {
    item.active = active;
    db.saveMonitors(list);
  }
  return item;
}

function filterTickets(tickets, task) {
  return tickets.filter((t) => {
    if (task.seatType && !t.seats[task.seatType]) return false;
    if (task.maxPrice) {
      const price = t.prices[task.seatType] || Math.min(...Object.values(t.prices || {}).map(Number));
      if (price && price > task.maxPrice) return false;
    }
    if (task.timeAfter && t.startTime && t.startTime < task.timeAfter) return false;
    if (task.timeBefore && t.startTime && t.startTime > task.timeBefore) return false;
    return true;
  });
}

async function checkWatch(item) {
  const tickets = await t12306.queryTickets(item);
  const hits = filterTickets(tickets, item);
  const hitKey = hits.map((t) => t.trainNo + (item.seatType || '')).join(',');
  if (hits.length > 0 && hitKey !== item.lastHitKey) {
    const seat = item.seatType ? ` ${item.seatType}` : '';
    await push.pushAll({
      title: '有余票了',
      body: `${item.date} ${item.from}→${item.to}${seat} 有 ${hits.length} 趟可购，点此查看`,
      url: config.baseUrl + '/',
      tag: item.id,
    });
    item.lastHitKey = hitKey;
    item.lastHitAt = Date.now();
  } else if (hits.length === 0) {
    item.lastHitKey = null;
  }
  return { id: item.id, hits: hits.length };
}

function cheapestTicket(tickets, seatType) {
  let best = null;
  for (const t of tickets) {
    if (seatType) {
      const p = t.prices[seatType];
      if (p && (!best || Number(p) < Number(best.price))) {
        best = { trainNo: t.trainNo, seatType, price: p, startTime: t.startTime, arriveTime: t.arriveTime };
      }
    } else {
      for (const [seat, p] of Object.entries(t.prices || {})) {
        if (!best || Number(p) < Number(best.price)) {
          best = { trainNo: t.trainNo, seatType: seat, price: p, startTime: t.startTime, arriveTime: t.arriveTime };
        }
      }
    }
  }
  return best;
}

async function buildDailyReport(item) {
  const days = item.days || 7;
  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const date = fmt(d);
    try {
      const tickets = await t12306.queryTickets({ date, from: item.from, to: item.to });
      const best = cheapestTicket(tickets, item.seatType);
      if (best) daily.push({ date, ...best });
    } catch (e) {
      console.error(`[daily] ${item.id} 查 ${date} 失败:`, e.message);
    }
    await sleep(300);
  }
  daily.sort((a, b) => Number(a.price) - Number(b.price));
  return daily;
}

async function checkDaily(item) {
  if (item.lastPushDate === todayStr()) return;
  if (nowHM() < (item.pushTime || '08:00')) return;

  const report = await buildDailyReport(item);
  const tag = 'daily-' + item.id;
  if (report.length === 0) {
    await push.pushAll({
      title: `票价日报 ${item.from}→${item.to}`,
      body: `未来 ${item.days} 天暂无票或查询失败`,
      url: config.baseUrl + '/',
      tag,
    });
  } else {
    const best = report[0];
    const brief = report
      .slice(0, 3)
      .map((r) => `${r.date.slice(5)} ${r.seatType}¥${r.price}`)
      .join('，');
    await push.pushAll({
      title: `票价日报 ${item.from}→${item.to}`,
      body: `最低 ${best.date.slice(5)} ${best.trainNo} ${best.seatType} ¥${best.price}｜近期：${brief}`,
      url: config.baseUrl + '/',
      tag,
    });
  }
  item.lastPushDate = todayStr();
}

async function tick() {
  const list = db.getMonitors().filter((m) => m.active);
  for (const item of list) {
    try {
      if (item.type === 'daily') await checkDaily(item);
      else await checkWatch(item);
    } catch (e) {
      console.error(`[monitor] ${item.id} 失败:`, e.message);
    }
  }
  db.saveMonitors(list);
}

function start() {
  if (timer) return;
  const sec = Math.max(5, config.pollIntervalSec);
  timer = setInterval(tick, sec * 1000);
  console.log(`[monitor] 监控已启动，间隔 ${sec}s`);
}

module.exports = { addMonitor, listMonitors, removeMonitor, toggleMonitor, start, tick, buildDailyReport };
