const webpush = require('web-push');
const config = require('./config');
const db = require('./db');

let publicKey = '';

function initVapid() {
  let v = db.getVapid();
  if (!v) {
    v = webpush.generateVAPIDKeys();
    db.saveVapid(v);
    console.log('[push] 已生成新的 VAPID 密钥');
  }
  const pub = config.vapidPublicKey || v.publicKey;
  const priv = config.vapidPrivateKey || v.privateKey;
  webpush.setVapidDetails(config.vapidSubject, pub, priv);
  publicKey = pub;
  return { publicKey: pub };
}

function getPublicKey() {
  return publicKey;
}

function addSubscription(sub) {
  const list = db.getSubscriptions();
  if (!list.some((s) => s.endpoint === sub.endpoint)) {
    list.push(sub);
    db.saveSubscriptions(list);
  }
  return list.length;
}

function removeSubscription(endpoint) {
  let list = db.getSubscriptions();
  list = list.filter((s) => s.endpoint !== endpoint);
  db.saveSubscriptions(list);
}

async function pushAll(payload) {
  const list = db.getSubscriptions();
  const results = [];
  for (const sub of list) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      results.push({ endpoint: sub.endpoint, ok: true });
    } catch (e) {
      results.push({ endpoint: sub.endpoint, ok: false, err: e.statusCode || e.message });
      if (e.statusCode === 410 || e.statusCode === 404) {
        removeSubscription(sub.endpoint);
      }
    }
  }
  return results;
}

module.exports = { initVapid, getPublicKey, addSubscription, removeSubscription, pushAll };
