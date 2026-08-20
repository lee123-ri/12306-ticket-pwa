const fs = require('fs');
const path = require('path');
const config = require('./config');

function file(name) {
  return path.join(config.dataDir, name);
}

function read(name, fallback) {
  const f = file(name);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function write(name, data) {
  const f = file(name);
  fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  getMonitors() {
    return read('monitors.json', []);
  },
  saveMonitors(list) {
    write('monitors.json', list);
  },
  getSubscriptions() {
    return read('subscriptions.json', []);
  },
  saveSubscriptions(list) {
    write('subscriptions.json', list);
  },
  getVapid() {
    return read('vapid.json', null);
  },
  saveVapid(v) {
    write('vapid.json', v);
  },
};
