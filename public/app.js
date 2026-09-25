'use strict';

let state = null;
const selectedBatchAllergens = new Set();
const selectedCleanAllergens = new Set();
let batchSteps = []; // [{equipmentId}]

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtTime(t) {
  return t ? t.replace('T', ' ') : '';
}

/* ---------------- 标签页切换 ---------------- */

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const name = tab.dataset.tab;
    $$('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  });
});

function switchTab(name) {
  $(`.tab[data-tab="${name}"]`).click();
}

/* ---------------- 过敏原勾选器 ---------------- */

function renderAllergenPicker(el, selected) {
  el.innerHTML = '';
  state.allergens.forEach((name) => {
    const chip = document.createElement('span');
    chip.className = 'allergen-chip' + (selected.has(name) ? ' on' : '');
    chip.textContent = name;
    chip.addEventListener('click', () => {
      if (selected.has(name)) selected.delete(name);
      else selected.add(name);
      renderAllergenPicker(el, selected);
    });
    el.appendChild(chip);
  });
}

/* ---------------- 批次步骤编辑 ---------------- */

function renderBatchSteps() {
  const ol = $('#batch-steps');
  ol.innerHTML = '';
  batchSteps.forEach((step, i) => {
    const li = document.createElement('li');
    li.className = 'step-item';

    const no = document.createElement('span');
    no.className = 'step-no';
    no.textContent = i + 1;

    const sel = document.createElement('select');
    state.equipments.forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.name;
      if (e.id === step.equipmentId) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!state.equipments.some((e) => e.id === step.equipmentId) && state.equipments[0]) {
      step.equipmentId = state.equipments[0].id;
      sel.value = step.equipmentId;
    }
    sel.addEventListener('change', () => { step.equipmentId = sel.value; });

    const move = document.createElement('span');
    move.className = 'step-move';
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'icon-btn move';
    up.textContent = '↑';
    up.disabled = i === 0;
    up.addEventListener('click', () => {
      [batchSteps[i - 1], batchSteps[i]] = [batchSteps[i], batchSteps[i - 1]];
      renderBatchSteps();
    });
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'icon-btn move';
    down.textContent = '↓';
    down.disabled = i === batchSteps.length - 1;
    down.addEventListener('click', () => {
      [batchSteps[i + 1], batchSteps[i]] = [batchSteps[i], batchSteps[i + 1]];
      renderBatchSteps();
    });
    move.append(up, down);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      batchSteps.splice(i, 1);
      renderBatchSteps();
    });

    li.append(no, sel, move, del);
    ol.appendChild(li);
  });
}

function renderCleaningEquipmentSelect() {
  const sel = $('#form-cleaning select[name="equipmentId"]');
  const cur = sel.value;
  sel.innerHTML = '';
  state.equipments.forEach((e) => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.name;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

/* ---------------- 主数据列表 ---------------- */

function renderAllergenList() {
  const ul = $('#allergen-list');
  ul.innerHTML = '';
  state.allergens.forEach((name) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = name;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      if (!confirm(`从主数据删除过敏原「${name}」？\n历史记录中已出现的该过敏原不会被移除。`)) return;
      try {
        state = await api('DELETE', '/api/allergens/' + encodeURIComponent(name));
        renderAll();
        toast('已删除过敏原');
      } catch (err) { toast(err.message, true); }
    });
    li.append(span, del);
    ul.appendChild(li);
  });
}

function renderEquipmentList() {
  const ul = $('#equipment-list');
  ul.innerHTML = '';
  state.equipments.forEach((e) => {
    const used = state.entries.some(
      (en) => en.equipmentId === e.id || (en.steps || []).some((s) => s.equipmentId === e.id)
    );
    const li = document.createElement('li');
    const left = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = e.name;
    left.appendChild(name);
    if (e.note) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = e.note;
      left.appendChild(meta);
    }
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '删除';
    if (used) {
      del.disabled = true;
      del.title = '已被记录引用';
      del.style.opacity = '0.4';
      del.style.cursor = 'not-allowed';
    }
    del.addEventListener('click', async () => {
      if (used) return;
      if (!confirm(`删除设备「${e.name}」？`)) return;
      try {
        state = await api('DELETE', `/api/equipments/${e.id}`);
        renderAll();
        toast('已删除设备');
      } catch (err2) { toast(err2.message, true); }
    });
    li.append(left, del);
    ul.appendChild(li);
  });
}

/* ---------------- 设备残留卡片 ---------------- */

function renderEquipmentGrid() {
  const grid = $('#equipment-grid');
  grid.innerHTML = '';
  if (!state.equipments.length) {
    grid.innerHTML = '<div class="empty-hint">还没有设备，请先在左侧「设备」标签页添加。</div>';
    return;
  }
  state.equipments.forEach((e) => {
    const sim = state.simulation.equipments.find((x) => x.id === e.id) || { residue: [] };
    const card = document.createElement('div');
    card.className = 'panel equip-card ' + (sim.residue.length ? 'dirty' : 'clean');

    const h = document.createElement('h3');
    h.textContent = e.name;
    const badge = document.createElement('span');
    badge.className = sim.residue.length ? 'dirty-badge' : 'clean-badge';
    badge.textContent = sim.residue.length ? `${sim.residue.length} 项残留` : '已清洁';
    h.appendChild(badge);
    card.appendChild(h);

    const tags = document.createElement('div');
    tags.className = 'residue-tags';
    if (!sim.residue.length) {
      const empty = document.createElement('span');
      empty.className = 'empty-residue';
      empty.textContent = '当前无可检测残留';
      tags.appendChild(empty);
    } else {
      sim.residue.forEach((r) => {
        const chip = document.createElement('span');
        chip.className = 'tag link-tag';
        chip.innerHTML = `${escapeHtml(r.allergen)} <span class="src">溯源</span>`;
        chip.title = '点击展开来源链';
        chip.addEventListener('click', () => {
          const box = card.querySelector('.tree-box');
          box.classList.toggle('hidden');
        });
        tags.appendChild(chip);
      });
    }
    card.appendChild(tags);

    if (sim.residue.length) {
      const box = document.createElement('div');
      box.className = 'tree-box hidden';
      sim.residue.forEach((r) => {
        const cap = document.createElement('div');
        cap.className = 'final-row';
        cap.innerHTML = `<span class="label-text">${escapeHtml(r.allergen)} 来源：</span>`;
        cap.appendChild(buildTree(r.nodeId));
        box.appendChild(cap);
      });
      card.appendChild(box);
    }

    grid.appendChild(card);
  });
}

/* ---------------- 溯源树 ---------------- */

function nodeBadgeHtml(node) {
  const map = {
    recipe: ['配方', 'recipe'],
    contact: ['继承', 'contact'],
    deposit: ['沉积', 'deposit'],
    survive: ['清洗未移除', 'survive'],
    clean: ['清洗', 'clean']
  };
  const [text, cls] = map[node.type] || [node.type, ''];
  return `<span class="type-badge ${cls}">${text}</span>`;
}

function buildTree(rootId) {
  const nodes = state.simulation.nodes;
  const rootUl = document.createElement('ul');
  rootUl.className = 'tree';
  const seenInPath = new Set();

  function renderNode(nodeId, containerUl, pathSet) {
    const node = nodes[nodeId];
    const li = document.createElement('li');
    const line = document.createElement('div');
    line.className = 'node-line';
    if (!node) {
      line.textContent = '（来源节点缺失）';
      li.appendChild(line);
      containerUl.appendChild(li);
      return;
    }
    line.innerHTML = `${nodeBadgeHtml(node)}<span class="node-label">${escapeHtml(node.label)}</span>`;
    li.appendChild(line);

    const parents = node.parents || [];
    if (pathSet.has(nodeId)) {
      const note = document.createElement('span');
      note.className = 'loop-note';
      note.textContent = '（上游已展开）';
      line.appendChild(note);
    } else if (parents.length) {
      const childUl = document.createElement('ul');
      const nextSet = new Set(pathSet);
      nextSet.add(nodeId);
      parents.forEach((pid) => renderNode(pid, childUl, nextSet));
      li.appendChild(childUl);
    }
    containerUl.appendChild(li);
  }

  renderNode(rootId, rootUl, seenInPath);
  return rootUl;
}

/* ---------------- 时间线 ---------------- */

function renderTimeline() {
  const tl = $('#timeline');
  const empty = $('#empty-hint');
  tl.innerHTML = '';
  const entries = state.entries;
  empty.classList.toggle('hidden', entries.length > 0);

  // 模拟结果按 entryId 索引
  const sim = state.simulation;
  const batchById = new Map(sim.batches.map((b) => [b.id, b]));
  const cleanById = new Map(sim.cleanings.map((c) => [c.id, c]));

  entries.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = 'panel tl-card';

    const head = document.createElement('div');
    head.className = 'tl-head';

    const time = document.createElement('div');
    time.className = 'tl-time';
    time.textContent = fmtTime(entry.happenedAt);

    const icon = document.createElement('div');
    icon.className = 'tl-icon ' + entry.kind;
    icon.textContent = entry.kind === 'batch' ? '🍪' : '🧽';

    const body = document.createElement('div');
    body.className = 'tl-body';
    const title = document.createElement('div');
    title.className = 'tl-title';
    title.textContent = entry.name;
    body.appendChild(title);
    if (entry.note) {
      const note = document.createElement('div');
      note.className = 'tl-note';
      note.textContent = entry.note;
      body.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'tl-actions';
    const up = document.createElement('button');
    up.className = 'icon-btn move';
    up.title = '同时间上移';
    up.textContent = '↑';
    up.addEventListener('click', () => moveEntry(entry.id, 'up'));
    const down = document.createElement('button');
    down.className = 'icon-btn move';
    down.title = '同时间下移';
    down.textContent = '↓';
    down.addEventListener('click', () => moveEntry(entry.id, 'down'));
    const edit = document.createElement('button');
    edit.className = 'icon-btn move';
    edit.title = '编辑';
    edit.textContent = '✎';
    edit.addEventListener('click', () => startEdit(entry));
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = '删除';
    del.textContent = '✕';
    del.addEventListener('click', () => deleteEntry(entry));
    actions.append(up, down, edit, del);

    head.append(time, icon, body, actions);
    card.appendChild(head);

    if (entry.kind === 'batch') {
      const b = batchById.get(entry.id);
      if (b) card.appendChild(buildBatchDetail(entry, b));
    } else {
      const c = cleanById.get(entry.id);
      if (c) card.appendChild(buildCleaningDetail(entry, c));
    }

    tl.appendChild(card);
  });
}

function buildBatchDetail(entry, b) {
  const det = document.createElement('details');
  det.className = 'tl-detail';
  const sum = document.createElement('summary');
  sum.textContent = `查看加工步骤、最终过敏原与传播来源链（${b.finalAllergens.length} 种过敏原）`;
  det.appendChild(sum);

  // 步骤条
  const strip = document.createElement('div');
  strip.className = 'steps-strip';
  b.steps.forEach((s, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'step-arrow';
      arrow.textContent = '→';
      strip.appendChild(arrow);
    }
    const pill = document.createElement('span');
    pill.className = 'step-pill';
    const gained = s.inherited.map((x) => x.allergen);
    pill.innerHTML = `<strong>${i + 1}. ${escapeHtml(s.equipmentName)}</strong>` +
      (gained.length ? ` <span class="gained">+${gained.map(escapeHtml).join('、')}</span>` : '');
    pill.title = gained.length ? `此步继承：${gained.join('、')}` : '此步无新继承';
    strip.appendChild(pill);
  });
  det.appendChild(strip);

  // 最终过敏原
  const finalRow = document.createElement('div');
  finalRow.className = 'final-row';
  finalRow.innerHTML = '<span class="label-text">批次最终过敏原：</span>';
  if (!b.finalAllergens.length) {
    finalRow.innerHTML += '<span class="tag">无</span>';
  } else {
    b.finalAllergens.forEach((a) => {
      const tag = document.createElement('span');
      tag.className = 'tag ' + (a.intrinsic ? 'intrinsic' : 'acquired link-tag');
      tag.innerHTML = escapeHtml(a.allergen) + (a.intrinsic ? ' · 配方自带' : ' · 交叉获得 <span class="src">溯源</span>');
      if (!a.intrinsic) {
        const box = document.createElement('div');
        box.className = 'tree-box hidden';
        box.style.width = '100%';
        tag.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!box.parentNode) {
            box.appendChild(buildTree(a.nodeId));
            finalRow.appendChild(box);
          }
          box.classList.toggle('hidden');
        });
      }
      finalRow.appendChild(tag);
    });
  }
  det.appendChild(finalRow);

  // 配方自带也允许看链（链长为单个配方节点）；完整来源链总览
  const allChains = document.createElement('details');
  allChains.className = 'tl-detail';
  allChains.style.border = 'none';
  allChains.style.padding = '4px 0 0';
  allChains.style.background = 'transparent';
  const allSum = document.createElement('summary');
  allSum.textContent = '逐步展开每种过敏原的完整传播来源链';
  allChains.appendChild(allSum);
  b.finalAllergens.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'final-row';
    row.style.marginTop = '8px';
    row.innerHTML = `<span class="label-text">${escapeHtml(a.allergen)}${a.intrinsic ? '（配方自带）' : '（交叉获得）'}：</span>`;
    row.appendChild(buildTree(a.nodeId));
    allChains.appendChild(row);
  });
  det.appendChild(allChains);

  return det;
}

function buildCleaningDetail(entry, c) {
  const det = document.createElement('details');
  det.className = 'tl-detail';
  const sum = document.createElement('summary');
  const selCount = (c.selected || []).length;
  sum.textContent = `查看清洗结果（勾选移除 ${selCount} 项，实际移除 ${c.removed.length} 项，残留 ${c.remaining.length} 项）`;
  det.appendChild(sum);

  const row = document.createElement('div');
  row.className = 'clean-summary';
  row.innerHTML = '<span class="label-text">已移除：</span>';
  if (c.removed.length) {
    c.removed.forEach((a) => row.insertAdjacentHTML('beforeend', `<span class="tag removed-tag">${escapeHtml(a)}</span>`));
  } else {
    row.insertAdjacentHTML('beforeend', '<span class="empty-residue">无残留被移除</span>');
  }
  det.appendChild(row);

  const row2 = document.createElement('div');
  row2.className = 'clean-summary';
  row2.innerHTML = '<span class="label-text">清洗后仍残留：</span>';
  if (c.remaining.length) {
    c.remaining.forEach((a) => row2.insertAdjacentHTML('beforeend', `<span class="tag kept-tag">${escapeHtml(a)}</span>`));
    const chainBox = document.createElement('div');
    chainBox.style.width = '100%';
    c.nodeId && chainBox.appendChild(buildTree(c.nodeId));
    det.appendChild(row2);
    const chainDet = document.createElement('details');
    chainDet.className = 'tl-detail';
    chainDet.style.border = 'none';
    chainDet.style.padding = '4px 0 0';
    chainDet.style.background = 'transparent';
    chainDet.innerHTML = '<summary>展开残留穿过本次清洗的来源链</summary>';
    chainDet.appendChild(chainBox);
    det.appendChild(chainDet);
  } else {
    row2.insertAdjacentHTML('beforeend', '<span class="empty-residue">无</span>');
    det.appendChild(row2);
  }
  return det;
}

/* ---------------- 新增 / 编辑 / 删除 / 移动 ---------------- */

function resetBatchForm() {
  const form = $('#form-batch');
  form.reset();
  form.elements.id.value = '';
  $('.form-title-text', form).textContent = '新增批次';
  $('.btn-cancel-edit', form).classList.add('hidden');
  selectedBatchAllergens.clear();
  batchSteps = state.equipments.length ? [{ equipmentId: state.equipments[0].id }] : [];
  form.elements.happenedAt.value = nowLocal();
  renderBatchSteps();
  renderAllergenPicker($('[data-picker="batch-allergens"]'), selectedBatchAllergens);
}

function resetCleaningForm() {
  const form = $('#form-cleaning');
  form.reset();
  form.elements.id.value = '';
  $('.form-title-text', form).textContent = '新增清洗记录';
  $('.btn-cancel-edit', form).classList.add('hidden');
  selectedCleanAllergens.clear();
  form.elements.happenedAt.value = nowLocal();
  renderAllergenPicker($('[data-picker="clean-allergens"]'), selectedCleanAllergens);
  renderCleaningEquipmentSelect();
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function startEdit(entry) {
  if (entry.kind === 'batch') {
    switchTab('batch');
    const form = $('#form-batch');
    form.elements.id.value = entry.id;
    form.elements.happenedAt.value = entry.happenedAt;
    form.elements.name.value = entry.name;
    form.elements.note.value = entry.note || '';
    selectedBatchAllergens.clear();
    (entry.allergens || []).forEach((a) => selectedBatchAllergens.add(a));
    batchSteps = (entry.steps || []).map((s) => ({ equipmentId: s.equipmentId }));
    $('.form-title-text', form).textContent = '编辑批次';
    $('.btn-cancel-edit', form).classList.remove('hidden');
    renderBatchSteps();
    renderAllergenPicker($('[data-picker="batch-allergens"]'), selectedBatchAllergens);
  } else {
    switchTab('cleaning');
    const form = $('#form-cleaning');
    renderCleaningEquipmentSelect();
    form.elements.id.value = entry.id;
    form.elements.happenedAt.value = entry.happenedAt;
    form.elements.name.value = entry.name;
    form.elements.note.value = entry.note || '';
    form.elements.equipmentId.value = entry.equipmentId;
    selectedCleanAllergens.clear();
    (entry.removedAllergens || []).forEach((a) => selectedCleanAllergens.add(a));
    $('.form-title-text', form).textContent = '编辑清洗记录';
    $('.btn-cancel-edit', form).classList.remove('hidden');
    renderAllergenPicker($('[data-picker="clean-allergens"]'), selectedCleanAllergens);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteEntry(entry) {
  if (!confirm(`删除「${entry.name}」？删除后所有记录将立即重新推演，此操作不可撤销。`)) return;
  try {
    state = await api('DELETE', `/api/entries/${entry.id}`);
    renderAll();
    toast('已删除并重新推演');
  } catch (err) { toast(err.message, true); }
}

async function moveEntry(id, dir) {
  try {
    state = await api('POST', `/api/entries/${id}/move`, { dir });
    renderAll();
  } catch (err) { toast(err.message, true); }
}

/* ---------------- 表单提交 ---------------- */

$('#batch-add-step').addEventListener('click', () => {
  if (!state.equipments.length) {
    toast('请先在「设备」标签页添加设备', true);
    switchTab('equipment');
    return;
  }
  batchSteps.push({ equipmentId: state.equipments[0].id });
  renderBatchSteps();
});

$('#batch-add-allergen').addEventListener('click', async () => {
  const input = $('#batch-new-allergen');
  const name = input.value.trim();
  if (!name) return;
  if (!state.allergens.includes(name)) {
    try {
      state = await api('POST', '/api/allergens', { name });
    } catch (err) { toast(err.message, true); return; }
  }
  selectedBatchAllergens.add(name);
  input.value = '';
  renderAll();
  selectedBatchAllergens.add(name);
  renderAllergenPicker($('[data-picker="batch-allergens"]'), selectedBatchAllergens);
});

$('#form-batch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!batchSteps.length) { toast('至少添加一个设备步骤', true); return; }
  const payload = {
    kind: 'batch',
    happenedAt: f.elements.happenedAt.value,
    name: f.elements.name.value,
    note: f.elements.note.value,
    allergens: [...selectedBatchAllergens],
    steps: batchSteps.map((s) => ({ equipmentId: s.equipmentId }))
  };
  const id = f.elements.id.value;
  try {
    state = id
      ? await api('PUT', `/api/entries/${id}`, payload)
      : await api('POST', '/api/entries', payload);
    resetBatchForm();
    renderAll();
    toast(id ? '已修改并重新推演' : '已保存并完成推演');
  } catch (err) { toast(err.message, true); }
});

$('#form-cleaning').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    kind: 'cleaning',
    happenedAt: f.elements.happenedAt.value,
    name: f.elements.name.value,
    note: f.elements.note.value,
    equipmentId: f.elements.equipmentId.value,
    removedAllergens: [...selectedCleanAllergens]
  };
  const id = f.elements.id.value;
  try {
    state = id
      ? await api('PUT', `/api/entries/${id}`, payload)
      : await api('POST', '/api/entries', payload);
    resetCleaningForm();
    renderAll();
    toast(id ? '已修改并重新推演' : '已保存并完成推演');
  } catch (err) { toast(err.message, true); }
});

$('#form-equipment').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    state = await api('POST', '/api/equipments', { name: f.elements.name.value, note: '' });
    f.reset();
    renderAll();
    toast('已添加设备');
  } catch (err) { toast(err.message, true); }
});

$('#form-allergen').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    state = await api('POST', '/api/allergens', { name: f.elements.name.value });
    f.reset();
    renderAll();
    toast('已添加过敏原');
  } catch (err) { toast(err.message, true); }
});

$$('.btn-cancel-edit').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.closest('#form-batch')) resetBatchForm();
    else resetCleaningForm();
  });
});

$('#btn-resim').addEventListener('click', async () => {
  try {
    await refresh();
    toast('已按最新记录重新推演');
  } catch (err) { toast(err.message, true); }
});

$('#btn-demo').addEventListener('click', async () => {
  if (state.entries.length &&
      !confirm('载入演示数据将覆盖当前全部设备与记录，确定继续？')) return;
  try {
    state = await api('POST', '/api/demo');
    resetBatchForm();
    resetCleaningForm();
    renderAll();
    toast('演示数据已载入并完成推演');
  } catch (err) { toast(err.message, true); }
});

/* ---------------- 汇总渲染 ---------------- */

function renderWarnings() {
  const box = $('#warnings-box');
  const ws = state.simulation.warnings || [];
  box.innerHTML = '';
  if (!ws.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const div = document.createElement('div');
  div.className = 'warning-box';
  div.innerHTML = '⚠️ 推演告警<ul>' + ws.map((w) => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>';
  box.appendChild(div);
}

function renderAll() {
  renderAllergenPicker($('[data-picker="batch-allergens"]'), selectedBatchAllergens);
  renderAllergenPicker($('[data-picker="clean-allergens"]'), selectedCleanAllergens);
  renderBatchSteps();
  renderCleaningEquipmentSelect();
  renderAllergenList();
  renderEquipmentList();
  renderEquipmentGrid();
  renderTimeline();
  renderWarnings();
}

async function refresh() {
  state = await api('GET', '/api/state');
  renderAll();
}

refresh().then(() => {
  resetBatchForm();
  resetCleaningForm();
}).catch((err) => toast('初始化失败：' + err.message, true));
