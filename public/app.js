const chat = document.getElementById('chat');
const form = document.getElementById('form');
const input = document.getElementById('input');
const notifyBtn = document.getElementById('notifyBtn');
const monitorBtn = document.getElementById('monitorBtn');
const monitorPanel = document.getElementById('monitorPanel');
const monitorBody = document.getElementById('monitorBody');
const monitorClose = document.getElementById('monitorClose');
const mask = document.getElementById('mask');

function addMsg(text, cls) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

function addHTML(cls, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = html;
  div.appendChild(bubble);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTickets(data) {
  if (!data.tickets || data.tickets.length === 0) {
    return '<div class="hint">没有找到符合条件的车次，换个日期或席别试试。</div>';
  }
  let html = `<div class="hint">共 ${data.count} 趟，点击「去购票」跳转 12306 官方页面下单</div>`;
  for (const t of data.tickets) {
    const seats = Object.entries(t.seats || {}).map(([name, val]) => {
      const price = t.prices && t.prices[name] ? `<span class="p">¥${esc(t.prices[name])}</span>` : '';
      return `<span class="seat has">${esc(name)} ${esc(val)}${price}</span>`;
    }).join('');
    html += `
      <div class="ticket">
        <div class="row1"><span class="train">${esc(t.trainNo)}</span><span class="dur">历时 ${esc(t.duration)}</span></div>
        <div class="route">${esc(t.from)} → ${esc(t.to)}</div>
        <div class="times"><span class="big">${esc(t.startTime)}</span><span>—</span><span class="big">${esc(t.arriveTime)}</span></div>
        <div class="seats">${seats || '<span class="hint">各席别均无票</span>'}</div>
        <a class="buy" href="${esc(data.buyUrl)}" target="_blank" rel="noopener">去 12306 购票</a>
      </div>`;
  }
  return html;
}

async function send(text) {
  addMsg(text, 'user');
  const thinking = addMsg('正在查询…', 'bot');
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await resp.json();
    thinking.remove();
    if (data.intent === 'monitor' || data.intent === 'daily') {
      if (data.ok) {
        addHTML('bot', `<div>${esc(data.message)}</div><div class="hint">可在右上角「监控」里管理</div>`);
      } else {
        addHTML('bot', `<div class="err">${esc(data.error)}</div>`);
      }
    } else if (data.ok) {
      addHTML('bot', renderTickets(data));
    } else {
      addHTML('bot', `<div class="err">${esc(data.error)}</div>`);
    }
  } catch (e) {
    thinking.remove();
    addHTML('bot', `<div class="err">请求失败：${esc(e.message)}</div>`);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  send(text);
});

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function enableNotify() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('当前浏览器不支持通知');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('通知权限被拒绝，请到浏览器设置里允许');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyResp = await fetch('/api/vapid-key');
    const { publicKey } = await keyResp.json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    notifyBtn.textContent = '通知已开';
    notifyBtn.classList.add('on');
  } catch (e) {
    alert('开启通知失败：' + e.message);
  }
}
notifyBtn.addEventListener('click', enableNotify);

function openPanel() {
  monitorPanel.classList.add('show');
  mask.classList.add('show');
  loadMonitors();
}
function closePanel() {
  monitorPanel.classList.remove('show');
  mask.classList.remove('show');
}
monitorBtn.addEventListener('click', openPanel);
monitorClose.addEventListener('click', closePanel);
mask.addEventListener('click', closePanel);

async function loadMonitors() {
  const resp = await fetch('/api/monitors');
  const data = await resp.json();
  if (!data.list || data.list.length === 0) {
    monitorBody.innerHTML = '<div class="empty">暂无监控任务<br><br>在聊天里说「盯一下8月25日北京到上海的二等座」即可添加</div>';
    return;
  }
  monitorBody.innerHTML = data.list.map((m) => {
    const seat = m.seatType ? ' ' + m.seatType : '';
    if (m.type === 'daily') {
      return `
        <div class="monitor-item">
          <div class="m1">每日 ${esc(m.pushTime)} · ${esc(m.from)}→${esc(m.to)}${esc(seat)}</div>
          <div class="m2">${m.active ? '日报监控中' : '已暂停'} · 推送最低票价</div>
          <div class="m3">
            <button data-act="toggle" data-id="${esc(m.id)}">${m.active ? '暂停' : '恢复'}</button>
            <button class="del" data-act="del" data-id="${esc(m.id)}">删除</button>
          </div>
        </div>`;
    }
    return `
      <div class="monitor-item">
        <div class="m1">${esc(m.date)} ${esc(m.from)}→${esc(m.to)}${esc(seat)}</div>
        <div class="m2">${m.active ? '监控中' : '已暂停'}${m.maxPrice ? ' · 限价 ¥' + esc(m.maxPrice) : ''}</div>
        <div class="m3">
          <button data-act="toggle" data-id="${esc(m.id)}">${m.active ? '暂停' : '恢复'}</button>
          <button class="del" data-act="del" data-id="${esc(m.id)}">删除</button>
        </div>
      </div>`;
  }).join('');
  monitorBody.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'del') {
        await fetch('/api/monitors/' + id, { method: 'DELETE' });
      } else {
        const item = monitorBody.querySelector(`button[data-act="toggle"][data-id="${id}"]`);
        const cur = item && item.textContent === '暂停';
        await fetch('/api/monitors/' + id + '/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: !cur }),
        });
      }
      loadMonitors();
    });
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw 注册失败', e));
}

addHTML('bot', '<div>你好，我是火车票助手。可以直接问：</div><div class="hint">· 明天北京到上海二等座<br>· 盯一下下周五北京到杭州的二等座<br>· 每天8点北京到上海最便宜的票价</div>');
