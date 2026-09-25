'use strict';

const path = require('path');
const express = require('express');

const storage = require('./src/storage');
const { simulate } = require('./src/simulator');
const { buildDemo } = require('./src/demo');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- 工具与校验 ---------------- */

function cleanText(value, field, max = 80) {
  if (typeof value !== 'string') throw httpError(400, `${field} 必须是字符串`);
  const v = value.trim();
  if (!v) throw httpError(400, `${field} 不能为空`);
  if (v.length > max) throw httpError(400, `${field} 长度不能超过 ${max} 个字符`);
  // 去掉危险控制字符（保留换行与制表符）
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function cleanNote(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw httpError(400, '备注必须是字符串');
  return value.trim().slice(0, 500);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeAllergenList(value, field) {
  if (!Array.isArray(value)) throw httpError(400, `${field} 必须是数组`);
  const out = [];
  for (const item of value) {
    const name = cleanText(item, `${field}项`, 30);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function normalizeHappenedAt(value) {
  let v = cleanText(value, '时间', 16);
  if (v.length === 19) v = v.slice(0, 16); // 兼容带秒的输入
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
    throw httpError(400, '时间格式应为 YYYY-MM-DDTHH:MM');
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw httpError(400, '时间不是有效的日期时间');
  return v;
}

function validateBatchBody(body, db, partial = false) {
  const patch = {};
  if (!partial || body.happenedAt !== undefined) patch.happenedAt = normalizeHappenedAt(body.happenedAt);
  if (!partial || body.name !== undefined) patch.name = cleanText(body.name, '批次名称', 60);
  if (!partial || body.note !== undefined) patch.note = cleanNote(body.note);
  if (!partial || body.allergens !== undefined) patch.allergens = normalizeAllergenList(body.allergens, '配方过敏原');
  if (!partial || body.steps !== undefined) {
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
      throw httpError(400, '至少需要一个加工步骤（设备）');
    }
    if (body.steps.length > 30) throw httpError(400, '加工步骤不能超过 30 个');
    patch.steps = body.steps.map((s, i) => {
      const equipmentId = cleanText(s && s.equipmentId, `第 ${i + 1} 步设备`, 80);
      if (!db.equipments.some((e) => e.id === equipmentId)) {
        throw httpError(400, `第 ${i + 1} 步设备不存在，请先创建设备`);
      }
      return { equipmentId };
    });
  }
  return patch;
}

function validateCleaningBody(body, db, partial = false) {
  const patch = {};
  if (!partial || body.happenedAt !== undefined) patch.happenedAt = normalizeHappenedAt(body.happenedAt);
  if (!partial || body.name !== undefined) patch.name = cleanText(body.name, '清洗记录名称', 60);
  if (!partial || body.note !== undefined) patch.note = cleanNote(body.note);
  if (!partial || body.equipmentId !== undefined) {
    patch.equipmentId = cleanText(body.equipmentId, '清洗设备', 80);
    if (!db.equipments.some((e) => e.id === patch.equipmentId)) {
      throw httpError(400, '清洗设备不存在，请先创建设备');
    }
  }
  if (!partial || body.removedAllergens !== undefined) {
    patch.removedAllergens = normalizeAllergenList(body.removedAllergens, '本次清洗移除的过敏原');
  }
  return patch;
}

function publicEntry(entry) {
  return entry; // 存储结构即接口结构
}

function buildView(db) {
  storage.sortEntries(db.entries);
  return {
    allergens: db.allergens,
    equipments: db.equipments,
    entries: db.entries.map(publicEntry),
    simulation: simulate(db)
  };
}

function findEntry(db, id) {
  const entry = db.entries.find((e) => e.id === id);
  if (!entry) throw httpError(404, '记录不存在');
  return entry;
}

function mergeAllergens(db, names) {
  for (const name of names) {
    if (!db.allergens.includes(name)) db.allergens.push(name);
  }
}

/* ---------------- 路由：整体视图 ---------------- */

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/state', (_req, res, next) => {
  try {
    res.json(buildView(storage.load()));
  } catch (err) {
    next(err);
  }
});

/* ---------------- 路由：过敏原主数据 ---------------- */

app.post('/api/allergens', (req, res, next) => {
  storage
    .mutate((db) => {
      const name = cleanText(req.body && req.body.name, '过敏原名称', 30);
      if (db.allergens.includes(name)) throw httpError(409, '该过敏原已存在');
      db.allergens.push(name);
      return buildView(db);
    })
    .then((view) => res.status(201).json(view))
    .catch(next);
});

app.delete('/api/allergens/:name', (req, res, next) => {
  storage
    .mutate((db) => {
      const name = req.params.name;
      const idx = db.allergens.indexOf(name);
      if (idx === -1) throw httpError(404, '过敏原不存在');
      db.allergens.splice(idx, 1);
      return buildView(db);
    })
    .then((view) => res.json(view))
    .catch(next);
});

/* ---------------- 路由：设备 ---------------- */

app.post('/api/equipments', (req, res, next) => {
  storage
    .mutate((db) => {
      const name = cleanText(req.body && req.body.name, '设备名称', 40);
      const note = cleanNote(req.body && req.body.note);
      if (db.equipments.some((e) => e.name === name)) throw httpError(409, '同名设备已存在');
      const equipment = { id: storage.nextId('eq', db), name, note };
      db.equipments.push(equipment);
      return buildView(db);
    })
    .then((view) => res.status(201).json(view))
    .catch(next);
});

app.patch('/api/equipments/:id', (req, res, next) => {
  storage
    .mutate((db) => {
      const equipment = db.equipments.find((e) => e.id === req.params.id);
      if (!equipment) throw httpError(404, '设备不存在');
      if (req.body && req.body.name !== undefined) {
        const name = cleanText(req.body.name, '设备名称', 40);
        if (db.equipments.some((e) => e.id !== equipment.id && e.name === name)) {
          throw httpError(409, '同名设备已存在');
        }
        equipment.name = name;
      }
      if (req.body && req.body.note !== undefined) equipment.note = cleanNote(req.body.note);
      return buildView(db);
    })
    .then((view) => res.json(view))
    .catch(next);
});

app.delete('/api/equipments/:id', (req, res, next) => {
  storage
    .mutate((db) => {
      const idx = db.equipments.findIndex((e) => e.id === req.params.id);
      if (idx === -1) throw httpError(404, '设备不存在');
      const used = db.entries.some(
        (en) =>
          en.equipmentId === req.params.id ||
          (en.steps || []).some((s) => s.equipmentId === req.params.id)
      );
      if (used) throw httpError(409, '该设备已被批次或清洗记录引用，无法删除；可改名后继续使用');
      db.equipments.splice(idx, 1);
      return buildView(db);
    })
    .then((view) => res.json(view))
    .catch(next);
});

/* ---------------- 路由：时间线记录（批次 / 清洗） ---------------- */

app.post('/api/entries', (req, res, next) => {
  storage
    .mutate((db) => {
      const kind = req.body && req.body.kind;
      if (kind !== 'batch' && kind !== 'cleaning') throw httpError(400, '记录类型必须是 batch 或 cleaning');

      // 批次录入的新过敏原自动并入主数据
      if (kind === 'batch' && Array.isArray(req.body.allergens)) {
        mergeAllergens(db, normalizeAllergenList(req.body.allergens, '配方过敏原'));
      }

      const entry = {
        id: storage.nextId('ent', db),
        kind,
        happenedAt: '',
        tie: db.seq
      };
      if (kind === 'batch') {
        Object.assign(entry, validateBatchBody(req.body, db));
        entry.note = entry.note || '';
      } else {
        Object.assign(entry, validateCleaningBody(req.body, db));
        entry.note = entry.note || '';
      }
      db.entries.push(entry);
      return buildView(db);
    })
    .then((view) => res.status(201).json(view))
    .catch(next);
});

app.put('/api/entries/:id', (req, res, next) => {
  storage
    .mutate((db) => {
      const entry = findEntry(db, req.params.id);
      const body = req.body || {};
      if (body.kind !== undefined && body.kind !== entry.kind) {
        throw httpError(400, '不能修改记录类型');
      }

      if (entry.kind === 'batch') {
        if (Array.isArray(body.allergens)) {
          mergeAllergens(db, normalizeAllergenList(body.allergens, '配方过敏原'));
        }
        Object.assign(entry, validateBatchBody(body, db, true));
      } else {
        Object.assign(entry, validateCleaningBody(body, db, true));
      }
      return buildView(db);
    })
    .then((view) => res.json(view))
    .catch(next);
});

app.delete('/api/entries/:id', (req, res, next) => {
  storage
    .mutate((db) => {
      const idx = db.entries.findIndex((e) => e.id === req.params.id);
      if (idx === -1) throw httpError(404, '记录不存在');
      db.entries.splice(idx, 1);
      return buildView(db);
    })
    .then((view) => res.json(view))
    .catch(next);
});

// 同一时间点内上下调整顺序（交换 tie）
app.post('/api/entries/:id/move', (req, res, next) => {
  storage
    .mutate((db) => {
      storage.sortEntries(db.entries);
      const idx = db.entries.findIndex((e) => e.id === req.params.id);
      if (idx === -1) throw httpError(404, '记录不存在');
      const dir = req.body && req.body.dir;
      const target = dir === 'up' ? idx - 1 : dir === 'down' ? idx + 1 : -1;
      if (target < 0 || target >= db.entries.length) throw httpError(400, '已到边界，无法移动');
      const a = db.entries[idx];
      const b = db.entries[target];
      if (a.happenedAt !== b.happenedAt) {
        throw httpError(400, '只能在相同时间点的记录之间调整顺序；如需跨时间调整请修改时间');
      }
      const t = a.tie;
      a.tie = b.tie;
      b.tie = t;
      return buildView(db);
    })
    .then((view) => res.json(view))
    .catch(next);
});

/* ---------------- 路由：演示数据 ---------------- */

app.post('/api/demo', (_req, res, next) => {
  storage
    .mutate((db) => {
      const demo = buildDemo((prefix) => storage.nextId(prefix, db));
      db.allergens = demo.allergens;
      db.equipments = demo.equipments;
      db.entries = demo.entries;
      return buildView(db);
    })
    .then((view) => res.status(201).json(view))
    .catch(next);
});

/* ---------------- 错误处理 ---------------- */

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

storage.ensureInitialized();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`过敏原残留追踪服务已启动: http://localhost:${PORT}`);
    console.log(`数据文件: ${storage.DB_FILE}`);
  });
}

module.exports = app;
