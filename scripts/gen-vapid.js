const webpush = require('web-push');
const db = require('../src/db');

const v = webpush.generateVAPIDKeys();
db.saveVapid(v);
console.log('已生成 VAPID 密钥并写入 data/vapid.json');
console.log('Public Key :', v.publicKey);
console.log('Private Key:', v.privateKey);
