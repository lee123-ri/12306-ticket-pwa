const express = require('express');
const path = require('path');
const config = require('./config');
const push = require('./push');
const monitor = require('./monitor');
const routes = require('./routes');

const app = express();
app.use(express.json());

push.initVapid();

app.use('/api', routes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`12306-ticket-pwa 运行中: ${config.baseUrl}`);
  console.log(`DeepSeek 自然语言解析: ${config.deepseek.apiKey ? '已启用' : '未配置，使用规则兜底'}`);
  monitor.start();
});
