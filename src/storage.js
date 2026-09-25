'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const ALLERGEN_PRIORITY = [
  '麸质谷物', '甲壳类', '鱼类', '鸡蛋', '花生',
  '大豆', '乳及乳制品', '坚果', '芹菜', '芥末',
  '芝麻', '二氧化硫及亚硫酸盐'
];

const SCHEMA_VERSION = 1;

function emptyDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    seq: 0,
    allergens: ALLERGEN_PRIORITY.slice(),
    equipments: [],
    entries: []
  };
}

function ensureInitialized() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2) + '\n', 'utf8');
    console.log('[storage] 已初始化数据文件:', DB_FILE);
  }
}

function load() {
  ensureInitialized();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  let db;
  try {
    db = JSON.parse(raw);
  } catch (err) {
    throw new Error('数据文件解析失败: ' + DB_FILE);
  }
  if (!db || typeof db !== 'object') throw new Error('数据文件内容无效');
  if (typeof db.seq !== 'number') db.seq = 0;
  if (!Array.isArray(db.allergens)) db.allergens = ALLERGEN_PRIORITY.slice();
  if (!Array.isArray(db.equipments)) db.equipments = [];
  if (!Array.isArray(db.entries)) db.entries = [];
  return db;
}

// 串行化写入：每次写入前再次读取磁盘上的最新内容，合并后原子替换。
// 单次变更失败（如校验错误）不得污染后续请求的串行链。
let writeChain = Promise.resolve();

function mutate(mutator) {
  const run = writeChain.then(() => {
    const db = load();
    const result = mutator(db);
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, DB_FILE);
    return result;
  });
  // 无论成功失败，链本身都复位为 resolved，避免一次错误永久阻塞后续写入
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function nextId(prefix, db) {
  db.seq += 1;
  return `${prefix}_${db.seq.toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function sortEntries(entries) {
  entries.sort((a, b) => {
    if (a.happenedAt !== b.happenedAt) return a.happenedAt < b.happenedAt ? -1 : 1;
    return a.tie - b.tie;
  });
  return entries;
}

module.exports = {
  DB_FILE,
  DATA_DIR,
  ALLERGEN_PRIORITY,
  emptyDb,
  ensureInitialized,
  load,
  mutate,
  nextId,
  sortEntries
};
