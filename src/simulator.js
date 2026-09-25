'use strict';

const { ALLERGEN_PRIORITY, sortEntries } = require('./storage');

function allergenRank(name) {
  const i = ALLERGEN_PRIORITY.indexOf(name);
  return i === -1 ? Infinity : i;
}

// 过敏原排序：标准十二类按法定优先级，自定义过敏原按名称
function sortAllergenNames(names) {
  return names.slice().sort((a, b) => {
    const ra = allergenRank(a);
    const rb = allergenRank(b);
    if (ra !== rb) return ra === Infinity ? 1 : rb === Infinity ? -1 : ra - rb;
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * 推演引擎：按时间顺序重放全部批次与清洗记录。
 *
 * 设备残留模型：每台设备对每种过敏原只保留"最新一次沉积"的溯源节点；
 * 批次接触设备时继承这些节点，并把自身携带的过敏原重新沉积（覆盖为新节点）；
 * 清洗仅删除被选中的过敏原，其余残留原样保留。
 *
 * nodes 构成有向无环图（边均指向时间更早的节点），前端沿 parents 展开来源链。
 */
function simulate(db) {
  const entries = sortEntries(db.entries.slice());
  const equipMap = new Map(db.equipments.map((e) => [e.id, e]));

  const nodes = {};
  let nodeCounter = 0;
  function addNode(node) {
    nodeCounter += 1;
    node.id = `n${nodeCounter}`;
    node.parents = node.parents || [];
    nodes[node.id] = node;
    return node.id;
  }

  // equipmentId -> Map(allergen -> nodeId)
  const residue = new Map();
  function stateOf(equipmentId) {
    if (!residue.has(equipmentId)) residue.set(equipmentId, new Map());
    return residue.get(equipmentId);
  }

  const batches = [];
  const cleanings = [];
  const warnings = [];

  for (const entry of entries) {
    if (entry.kind === 'batch') {
      const carried = new Map(); // allergen -> 当前持有的溯源节点（保留最早获得处）
      const intrinsicSet = new Set(entry.allergens || []);

      // 第 0 步：配方自带过敏原
      for (const allergen of sortAllergenNames(dedupe(entry.allergens || []))) {
        const nid = addNode({
          type: 'recipe',
          label: `配方自带 · ${allergen}`,
          allergen,
          batchId: entry.id,
          batchName: entry.name,
          at: entry.happenedAt
        });
        carried.set(allergen, nid);
      }

      const steps = [];
      entry.steps.forEach((step, stepIndex) => {
        const equipment = equipMap.get(step.equipmentId);
        const equipmentName = equipment ? equipment.name : '（已删除的设备）';
        if (!equipment) {
          warnings.push(`批次「${entry.name}」第 ${stepIndex + 1} 步引用的设备已不存在，该步跳过沉积与继承`);
        }

        const st = stateOf(step.equipmentId);
        const inherited = [];

        // 1) 继承设备接触前的全部残留；为每条继承创建"接触"节点
        for (const allergen of sortAllergenNames([...st.keys()])) {
          const contactId = addNode({
            type: 'contact',
            label: `接触「${equipmentName}」继承 · ${allergen}`,
            allergen,
            batchId: entry.id,
            batchName: entry.name,
            equipmentId: step.equipmentId,
            equipmentName,
            stepIndex,
            at: entry.happenedAt,
            parents: [st.get(allergen)]
          });
          inherited.push({ allergen, nodeId: contactId });
          if (!carried.has(allergen)) carried.set(allergen, contactId);
        }

        // 2) 把批次携带的全部过敏原沉积到设备（覆盖旧残留）
        const deposits = [];
        if (equipment) {
          for (const allergen of sortAllergenNames([...carried.keys()])) {
            const depositId = addNode({
              type: 'deposit',
              label: `在「${equipmentName}」留下残留 · ${allergen}`,
              allergen,
              batchId: entry.id,
              batchName: entry.name,
              equipmentId: step.equipmentId,
              equipmentName,
              stepIndex,
              at: entry.happenedAt,
              parents: [carried.get(allergen)]
            });
            st.set(allergen, depositId);
            deposits.push({ allergen, nodeId: depositId });
          }
        }

        steps.push({
          stepIndex,
          equipmentId: step.equipmentId,
          equipmentName,
          equipmentExists: Boolean(equipment),
          inherited,
          deposits
        });
      });

      const finalAllergens = sortAllergenNames([...carried.keys()]).map((allergen) => ({
        allergen,
        nodeId: carried.get(allergen),
        intrinsic: intrinsicSet.has(allergen)
      }));

      batches.push({
        id: entry.id,
        name: entry.name,
        at: entry.happenedAt,
        note: entry.note || '',
        finalAllergens,
        steps
      });
    } else if (entry.kind === 'cleaning') {
      const equipment = equipMap.get(entry.equipmentId);
      const equipmentName = equipment ? equipment.name : '（已删除的设备）';
      const st = stateOf(entry.equipmentId);

      const removed = [];
      const cleanParents = [];
      for (const allergen of sortAllergenNames([...st.keys()])) {
        const prevNode = st.get(allergen);
        if ((entry.removedAllergens || []).includes(allergen)) {
          removed.push(allergen);
          cleanParents.push(prevNode);
          st.delete(allergen);
        } else {
          // 未被选中的过敏原原样保留，但来源链穿过本清洗事件
          const surviveId = addNode({
            type: 'survive',
            label: `清洗「${equipmentName}」未移除 · ${allergen}`,
            allergen,
            equipmentId: entry.equipmentId,
            equipmentName,
            at: entry.happenedAt,
            cleaningId: entry.id,
            parents: [prevNode]
          });
          st.set(allergen, surviveId);
          cleanParents.push(surviveId);
        }
      }

      const remaining = sortAllergenNames([...st.keys()]);
      const cleanNodeId = addNode({
        type: 'clean',
        label: `清洗「${equipmentName}」` + (removed.length ? ` · 移除 ${removed.join('、')}` : ' · 无残留可移除'),
        equipmentId: entry.equipmentId,
        equipmentName,
        removed,
        at: entry.happenedAt,
        cleaningId: entry.id,
        // 挂接本次清洗涉及的来源：被移除过敏原的沉积链 + 穿过清洗继续存在的链
        parents: cleanParents
      });

      cleanings.push({
        id: entry.id,
        at: entry.happenedAt,
        equipmentId: entry.equipmentId,
        equipmentName,
        note: entry.note || '',
        selected: sortAllergenNames(dedupe(entry.removedAllergens || [])),
        removed,
        remaining,
        nodeId: cleanNodeId
      });
    }
  }

  // 汇总设备当前残留
  const equipments = db.equipments.map((e) => {
    const st = residue.get(e.id);
    return {
      id: e.id,
      name: e.name,
      residue: st
        ? sortAllergenNames([...st.keys()]).map((allergen) => ({ allergen, nodeId: st.get(allergen) }))
        : []
    };
  });

  return { nodes, batches, cleanings, equipments, warnings };
}

module.exports = { simulate, sortAllergenNames, dedupe };
