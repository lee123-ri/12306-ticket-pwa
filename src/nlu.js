const axios = require('axios');
const config = require('./config');

const SEAT_KEYWORDS = ['商务座', '特等座', '一等座', '二等座', '高级软卧', '软卧', '硬卧', '软座', '硬座', '无座', '动卧'];

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseRelativeDate(text) {
  const now = new Date();
  if (/大后天/.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 3); return fmt(d); }
  if (/后天/.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 2); return fmt(d); }
  if (/明天|明日/.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }
  if (/今天|今日/.test(text)) return fmt(now);

  const weekMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  let m = text.match(/下?周([一二三四五六日天])/);
  if (m) {
    const target = weekMap[m[1]];
    const cur = now.getDay() === 0 ? 7 : now.getDay();
    let diff = target - cur;
    if (/下周/.test(text)) diff += 7;
    if (diff <= 0) diff += 7;
    const d = new Date(now);
    d.setDate(d.getDate() + diff);
    return fmt(d);
  }

  m = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  m = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (m) return `${now.getFullYear()}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;

  return null;
}

// 规则兜底解析
function parseByRules(text) {
  let intent = 'query';
  if (/每天|每日|天天|日报/.test(text)) intent = 'daily';
  else if (/监控|盯|抢|提醒|通知|放票|候补|刷票|有余票|捡漏/.test(text)) intent = 'monitor';

  // 每天的推送时间点（先提取，避免被价格剥离误伤）
  let pushTime = '08:00';
  const tm = text.match(/(\d{1,2})\s*[点:时]/);
  if (tm) pushTime = String(tm[1]).padStart(2, '0') + ':00';

  // 剥离意图前缀、时间词、席别、价格，剩下的才是站点对
  let cleaned = text
    .replace(/每天|每日|天天|日报/g, '')
    .replace(/^(盯一下|盯|帮我|麻烦|请|查一下|查|看看|看一下|看|抢|监控|提醒|通知|找|搜|订)/, '')
    .replace(/今天|今日|明天|明日|后天|大后天/g, '')
    .replace(/下?周[一二三四五六日天]/g, '')
    .replace(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?/g, '')
    .replace(/\d{1,2}月\d{1,2}[日号]/g, '')
    .replace(/\d{1,2}\s*[点:时]/g, '');

  let seatType = null;
  for (const s of SEAT_KEYWORDS) {
    if (text.includes(s)) { seatType = s; break; }
  }
  if (seatType) cleaned = cleaned.replace(seatType, '');

  let maxPrice = null;
  const pm = cleaned.match(/(\d+)\s*元?/);
  if (pm && /以内|以下|之内|内|预算|不超过/.test(cleaned)) maxPrice = Number(pm[1]);
  cleaned = cleaned.replace(/\d+\s*元?(?:以内|以下|之内|内)?/g, '');

  let from = null;
  let to = null;
  const pair = cleaned.match(/([\u4e00-\u9fa5]{2,10}?)[到去至→]([\u4e00-\u9fa5]{2,10})/);
  if (pair) {
    from = pair[1].replace(/^从/, '').replace(/[的了呢啊吧]$/, '');
    to = pair[2].replace(/[的了呢啊吧]$/, '');
  }

  const date = parseRelativeDate(text);

  return { intent, params: { date, from, to, seatType, maxPrice, pushTime } };
}

// DeepSeek 解析
async function parseByLLM(text) {
  const today = fmt(new Date());
  const sys = `你是火车票查询助手。今天是 ${today}。从用户输入中提取结构化信息，只输出一个 JSON 对象，不要输出任何其它文字。

JSON 字段说明：
- intent: "query"(查票) 或 "monitor"(监控某天的余票/放票提醒) 或 "daily"(每天定时查最低票价日报)。含"每天/每日/天天/日报"等要每天查票价的为 daily；含"监控/盯/抢/提醒/通知/放票/候补"为 monitor；否则 query。
- date: 目标日期，格式 yyyy-MM-dd（相对日期如"明天"要换算成绝对日期）。daily 意图可为 null。
- from: 出发站或城市名（如"北京""北京南"）。
- to: 到达站或城市名。
- seatType: 席别，取值仅限：商务座/特等座/一等座/二等座/软卧/硬卧/软座/硬座/无座/动卧/高级软卧，没有则为 null。
- maxPrice: 单张票价上限（数字，元），没有则为 null。
- timeAfter: 最早出发时间 HH:mm，没有则为 null。
- timeBefore: 最晚出发时间 HH:mm，没有则为 null。
- pushTime: 每天推送时间 HH:mm，仅 daily 意图需要，默认 "08:00"。如"每天8点"→"08:00"。

示例输入："每天8点查一下北京到上海最便宜的票价" → {"intent":"daily","date":null,"from":"北京","to":"上海","seatType":null,"maxPrice":null,"timeAfter":null,"timeBefore":null,"pushTime":"08:00"}`;

  const resp = await axios.post(
    config.deepseek.apiUrl,
    {
      model: config.deepseek.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    },
    {
      headers: { Authorization: `Bearer ${config.deepseek.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );
  const content = resp.data.choices[0].message.content;
  const obj = JSON.parse(content);
  const params = {
    date: obj.date || null,
    from: obj.from || null,
    to: obj.to || null,
    seatType: obj.seatType || null,
    maxPrice: obj.maxPrice || null,
    timeAfter: obj.timeAfter || null,
    timeBefore: obj.timeBefore || null,
    pushTime: obj.pushTime || '08:00',
  };
  return { intent: obj.intent === 'daily' || obj.intent === 'monitor' ? obj.intent : 'query', params };
}

async function parse(text) {
  if (config.deepseek.apiKey) {
    try {
      return await parseByLLM(text);
    } catch (e) {
      console.error('[nlu] LLM 解析失败，回退规则:', e.message);
    }
  }
  return parseByRules(text);
}

module.exports = { parse, parseRelativeDate };
