const axios = require('axios');

const API_BASE = 'https://kyfw.12306.cn';
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

let stationMap = null; // { 站名: 编码 }
let stationRev = null; // { 编码: 站名 }
let queryPathCache = null;

function headers(cookieStr) {
  const h = {
    'User-Agent': UA,
    Referer: 'https://kyfw.12306.cn/otn/leftTicket/init',
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  if (cookieStr) h.Cookie = cookieStr;
  return h;
}

async function loadStations() {
  if (stationMap) return stationMap;
  const urls = [
    'https://kyfw.12306.cn/otn/resources/js/framework/station_name.js',
    'https://www.12306.cn/resources/js/framework/station_name.js',
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const resp = await axios.get(url, { headers: headers(), timeout: 10000 });
      const m = String(resp.data).match(/station_names\s*=\s*'([^']+)'/);
      if (!m || !m[1]) throw new Error('未匹配到 station_names');
      const map = {};
      const rev = {};
      const parts = m[1].split('@').filter(Boolean);
      for (const p of parts) {
        const f = p.split('|');
        if (f.length < 3) continue;
        const name = f[1];
        const code = f[2];
        if (!map[name]) map[name] = code;
        rev[code] = name;
      }
      stationMap = map;
      stationRev = rev;
      return map;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('加载车站编码失败: ' + (lastErr && lastErr.message));
}

// 站名/城市名 → 编码；支持精确、前缀、包含匹配
function resolveStation(input) {
  if (!input) return null;
  if (!stationMap) return null;
  if (stationMap[input]) return stationMap[input];
  const keys = Object.keys(stationMap);
  const prefix = keys.filter((k) => k.startsWith(input));
  if (prefix.length) return stationMap[prefix[0]];
  const contain = keys.filter((k) => k.includes(input));
  if (contain.length) return stationMap[contain[0]];
  return null;
}

async function getCookie() {
  const resp = await axios.get(`${API_BASE}/otn/leftTicket/init`, {
    headers: headers(),
    timeout: 10000,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const map = {};
  const arr = resp.headers['set-cookie'] || [];
  for (const c of arr) {
    const kv = c.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) map[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
  return map;
}

async function getQueryPath() {
  if (queryPathCache) return queryPathCache;
  const resp = await axios.get(`${API_BASE}/otn/leftTicket/init`, {
    headers: headers(),
    timeout: 10000,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const html = String(resp.data || '');
  const m = html.match(/var CLeftTicketUrl\s*=\s*'([^']+)'/);
  if (m && m[1]) {
    queryPathCache = m[1];
    return m[1];
  }
  queryPathCache = 'leftTicket/queryZ';
  return queryPathCache;
}

const SEAT_FIELDS = [
  ['swz_num', '商务座'],
  ['tz_num', '特等座'],
  ['zy_num', '一等座'],
  ['ze_num', '二等座'],
  ['gr_num', '高级软卧'],
  ['rw_num', '软卧'],
  ['yw_num', '硬卧'],
  ['rz_num', '软座'],
  ['yz_num', '硬座'],
  ['wz_num', '无座'],
  ['srrb_num', '动卧'],
];

const SEAT_CODE = {
  A: '商务座',
  9: '商务座',
  P: '特等座',
  M: '一等座',
  O: '二等座',
  6: '高级软卧',
  4: '软卧',
  3: '硬卧',
  2: '软座',
  1: '硬座',
  W: '无座',
  F: '动卧',
};

function parsePrices(ypInfo) {
  const out = {};
  if (!ypInfo) return out;
  for (let i = 0; i + 10 <= ypInfo.length; i += 10) {
    const seg = ypInfo.slice(i, i + 10);
    const seatName = SEAT_CODE[seg[0]];
    const price = parseInt(seg.slice(1, 6), 10);
    if (seatName && !isNaN(price) && price > 0) {
      out[seatName] = (price / 10).toFixed(1);
    }
  }
  return out;
}

function parseTicket(item, map) {
  const v = item.split('|');
  const station = (code) => map[code] || code || '';
  const seats = {};
  const fieldIndex = {
    swz_num: 32, tz_num: 25, zy_num: 31, ze_num: 30,
    gr_num: 21, rw_num: 23, yw_num: 28, rz_num: 24,
    yz_num: 29, wz_num: 26, srrb_num: 33,
  };
  for (const [key, name] of SEAT_FIELDS) {
    const idx = fieldIndex[key];
    const val = v[idx] || '';
    if (val && val !== '无' && val !== '--') seats[name] = val === '有' ? '有' : `${val}张`;
  }
  return {
    trainNo: v[3], // 车次
    from: station(v[6]),
    to: station(v[7]),
    startTime: v[8],
    arriveTime: v[9],
    duration: v[10],
    startDate: v[13],
    houbu: v[37], // 候补标记
    seats,
    prices: parsePrices(v[39]),
  };
}

async function queryTickets({ date, from, to }) {
  await loadStations();
  const fromCode = resolveStation(from);
  const toCode = resolveStation(to);
  if (!fromCode) throw new Error(`未找到出发站「${from}」，请用具体站名如「北京南」`);
  if (!toCode) throw new Error(`未找到到达站「${to}」，请用具体站名如「上海虹桥」`);
  const cookie = await getCookie();
  const cookieStr = Object.entries(cookie)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const path = await getQueryPath();
  const url = `${API_BASE}/otn/${path}`;
  const resp = await axios.get(url, {
    params: {
      'leftTicketDTO.train_date': date,
      'leftTicketDTO.from_station': fromCode,
      'leftTicketDTO.to_station': toCode,
      purpose_codes: 'ADULT',
    },
    headers: headers(cookieStr),
    timeout: 12000,
  });
  const body = resp.data;
  if (!body || !body.data) {
    throw new Error('查询失败: ' + (body && body.messages ? body.messages : '接口无返回'));
  }
  const result = body.data.result || [];
  const map = body.data.map || {};
  return result.map((r) => parseTicket(r, map));
}

async function getStations() {
  await loadStations();
  return { map: stationMap, rev: stationRev };
}

module.exports = { queryTickets, getStations, resolveStation };
