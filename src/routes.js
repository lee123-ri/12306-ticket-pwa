const express = require('express');
const router = express.Router();
const nlu = require('./nlu');
const t12306 = require('./t12306');
const monitor = require('./monitor');
const push = require('./push');

function buildBuyUrl(from, to, date) {
  return `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=${encodeURIComponent(from + ',' + to)}&date=${date}`;
}

router.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

router.get('/vapid-key', (req, res) => res.json({ publicKey: push.getPublicKey() }));

router.post('/chat', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.json({ ok: false, error: '请输入查询内容' });
  }
  const parsed = await nlu.parse(String(text).trim());
  const { intent, params } = parsed;

  if (intent === 'monitor') {
    if (!params.date || !params.from || !params.to) {
      return res.json({
        ok: false,
        intent,
        parsed,
        error: '监控需要明确日期、出发站、到达站，例如「盯一下8月25日北京到上海的二等座」',
      });
    }
    const item = monitor.addMonitor({
      date: params.date,
      from: params.from,
      to: params.to,
      seatType: params.seatType,
      maxPrice: params.maxPrice,
      timeAfter: params.timeAfter,
      timeBefore: params.timeBefore,
    });
    const seat = params.seatType ? ' ' + params.seatType : '';
    return res.json({
      ok: true,
      intent,
      message: `已开始监控 ${params.date} ${params.from}→${params.to}${seat}，有余票会推送通知`,
      monitor: item,
    });
  }

  if (intent === 'daily') {
    if (!params.from || !params.to) {
      return res.json({
        ok: false,
        intent,
        parsed,
        error: '每日票价日报需要明确出发地、到达地，例如「每天8点北京到上海的最便宜票价」',
      });
    }
    const item = monitor.addMonitor({
      type: 'daily',
      from: params.from,
      to: params.to,
      seatType: params.seatType,
      pushTime: params.pushTime || '08:00',
    });
    const seat = params.seatType ? ` ${params.seatType}` : '';
    return res.json({
      ok: true,
      intent,
      message: `已创建每日票价日报：每天 ${item.pushTime} 推送 ${params.from}→${params.to}${seat} 的最低价`,
      monitor: item,
    });
  }

  if (!params.date || !params.from || !params.to) {
    return res.json({
      ok: false,
      intent,
      parsed,
      error: '需要明确日期、出发地、到达地，例如「明天北京到上海的二等座」',
    });
  }

  try {
    let tickets = await t12306.queryTickets(params);
    if (params.seatType) {
      tickets = tickets.filter((t) => t.seats[params.seatType]);
    }
    if (params.maxPrice) {
      tickets = tickets.filter((t) => {
        const price = t.prices[params.seatType] || Math.min(...Object.values(t.prices || {}).map(Number));
        return !price || price <= params.maxPrice;
      });
    }
    if (params.timeAfter) tickets = tickets.filter((t) => t.startTime >= params.timeAfter);
    if (params.timeBefore) tickets = tickets.filter((t) => t.startTime <= params.timeBefore);

    return res.json({
      ok: true,
      intent,
      parsed,
      count: tickets.length,
      tickets: tickets.slice(0, 20),
      buyUrl: buildBuyUrl(params.from, params.to, params.date),
    });
  } catch (e) {
    return res.json({ ok: false, intent, parsed, error: e.message });
  }
});

router.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.json({ ok: false, error: '无效订阅' });
  push.addSubscription(sub);
  res.json({ ok: true });
});

router.delete('/subscribe', (req, res) => {
  push.removeSubscription(req.body && req.body.endpoint);
  res.json({ ok: true });
});

router.get('/monitors', (req, res) => res.json({ ok: true, list: monitor.listMonitors() }));

router.delete('/monitors/:id', (req, res) => {
  monitor.removeMonitor(req.params.id);
  res.json({ ok: true });
});

router.post('/monitors/:id/toggle', (req, res) => {
  const item = monitor.toggleMonitor(req.params.id, !!req.body.active);
  res.json({ ok: true, item });
});

module.exports = router;
