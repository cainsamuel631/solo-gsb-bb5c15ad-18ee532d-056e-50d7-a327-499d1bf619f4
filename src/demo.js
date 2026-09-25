'use strict';

const { ALLERGEN_PRIORITY } = require('./storage');

// 一键载入演示数据：覆盖 配方自带 → 设备传播 → 部分清洗 → 跨批次继承 的完整场景
function buildDemo(nextId) {
  let tie = 0;
  const entryId = () => {
    const id = nextId('ent');
    tie += 1;
    return { id, tie };
  };
  const mk = (obj) => ({ ...entryId(), ...obj });

  const equipments = [
    { id: nextId('eq'), name: '搅拌机A', note: '共用设备' },
    { id: nextId('eq'), name: '成型机B', note: '' },
    { id: nextId('eq'), name: '油炸锅C', note: '共用设备' },
    { id: nextId('eq'), name: '传送带D', note: '' }
  ];
  const [eA, eB, eC, eD] = equipments;

  const entries = [
    mk({
      kind: 'batch',
      happenedAt: '2026-09-24T08:00',
      name: '花生酱饼干批次 #B101',
      note: '含花生的配方，先行生产',
      allergens: ['麸质谷物', '鸡蛋', '花生'],
      steps: [
        { equipmentId: eA.id },
        { equipmentId: eB.id },
        { equipmentId: eC.id }
      ]
    }),
    mk({
      kind: 'cleaning',
      happenedAt: '2026-09-24T09:30',
      equipmentId: eA.id,
      name: '班后清洗（搅拌机A）',
      note: '只清除了可见花生残留，未做深度清洗',
      removedAllergens: ['花生']
    }),
    mk({
      kind: 'cleaning',
      happenedAt: '2026-09-24T09:45',
      equipmentId: eB.id,
      name: '班后清洗（成型机B）',
      note: '全面深度清洗',
      removedAllergens: ['麸质谷物', '鸡蛋', '花生']
    }),
    mk({
      kind: 'batch',
      happenedAt: '2026-09-24T10:30',
      name: '无麸质米饼批次 #B102',
      note: '配方本身不含任何过敏原，用于验证交叉接触结果',
      allergens: [],
      steps: [
        { equipmentId: eA.id },
        { equipmentId: eB.id },
        { equipmentId: eC.id },
        { equipmentId: eD.id }
      ]
    }),
    mk({
      kind: 'cleaning',
      happenedAt: '2026-09-24T12:00',
      equipmentId: eC.id,
      name: '班中清洗（油炸锅C）',
      note: '只换了油，设备表面残留未处理',
      removedAllergens: []
    })
  ];

  return { allergens: ALLERGEN_PRIORITY.slice(), equipments, entries };
}

module.exports = { buildDemo };
