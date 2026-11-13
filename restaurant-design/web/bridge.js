/* The opaque-origin viewer can request only restaurant operations from its trusted parent. */
(() => {
  const bootstrap = window.__restaurantBootstrap;
  const scene = bootstrap.view === 'scene';
  const pending = new Map();
  const pointers = new Set();
  let sequence = 0;
  let project = bootstrap.project;
  let selection = [];
  let issues = [];
  let mutations = 0;
  let selecting = 0;
  let polling = false;
  let selectionEpoch = 0;
  let editEpoch = 0;
  let proposalEpoch = 0;
  let generation = 0;
  let mutationQueue = Promise.resolve();
  let selectionQueue = Promise.resolve();
  let errorText = '';
  let rejectedIssues = [];
  let history = null;
  let proposal = null;
  let sceneStatus;
  if (bootstrap.view) document.body.dataset.restaurantView = bootstrap.view;
  if (bootstrap.embedded) document.body.dataset.restaurantEmbedded = '';

  const messages = {
    title: ['助手设计工作台', 'Assistant design workspace'],
    ids: ['构件 ID（逗号分隔）', 'Item IDs (comma-separated)'],
    applySelection: ['同步选择', 'Select items'],
    addCurrent: ['加入当前构件', 'Add current item'],
    clearSelection: ['清除选择', 'Clear selection'],
    additive: ['点选时追加选择', 'Add items when clicking'],
    groupName: ['组合名称', 'Group name'],
    createGroup: ['建立组合', 'Create group'],
    groups: ['已有组合', 'Saved groups'],
    chooseGroup: ['选择一个组合', 'Choose a group'],
    dx: ['水平位移 X（mm）', 'Horizontal shift X (mm)'],
    dy: ['垂直位移 Y（mm）', 'Vertical shift Y (mm)'],
    move: ['移动所选构件 / 组合', 'Move selected items / group'],
    issues: ['当前布置问题', 'Current layout issues'],
    noIssues: ['没有发现已配置规则中的冲突。', 'No conflicts found under the configured rules.'],
    scope: ['建筑底图已锁定。检查结果用于方案布置，不代表消防或施工审定。', 'The building plan is locked. These checks support layout design, not fire or construction approval.'],
    pickHelp: ['在平面或三维中点选构件，也可直接输入构件 ID。建立组合后可整体移动。', 'Pick items in either view or enter their IDs. Create a group to move them together.'],
    revision: ['已保存版本', 'Saved revision'],
    saving: ['正在保存修改…', 'Saving changes…'],
    selecting: ['正在同步选择…', 'Updating selection…'],
    nameRequired: ['请输入组合名称。', 'Enter a group name.'],
    selectionRequired: ['请先选择构件。', 'Select items first.'],
    finiteShift: ['请输入有效的毫米位移。', 'Enter a valid shift in millimetres.'],
    locked: ['首版保留建筑底图，不能拆改墙体。', 'The building plan is fixed in this version; walls cannot be demolished.'],
    currentRequired: ['请先点选一个家具构件。', 'Pick a furniture item first.'],
    failed: ['请求未完成，请检查连接后重试。', 'The request did not complete. Check the connection and try again.'],
    exportName: ['餐厅方案', 'restaurant-plan'],
    preview: ['待确认的布置预览', 'Layout preview awaiting confirmation'],
    pullout: ['拉椅空间', 'Chair pull-out space'],
  };
  const text = key => {
    const pair = messages[key];
    return LANG === 'en' ? pair[1] : LANG === 'zht' ? s2t(pair[0]) : pair[0];
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const labelNodes = [];
  const element = (tag, label, className) => {
    const node = document.createElement(tag);
    if (label) {
      node.textContent = text(label);
      labelNodes.push([node, label]);
    }
    if (className) node.className = className;
    return node;
  };
  const button = (key, handler) => {
    const node = element('button', key, 'btn');
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  const inputLabel = (key, input) => {
    const label = element('label');
    label.append(element('span', key), input);
    return label;
  };

  const pane = element('details');
  pane.id = 'restaurant-workbench';
  pane.open = true;
  pane.append(element('summary', 'title'));
  const status = element('div', null, 'restaurant-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  pane.append(status);
  const error = element('div', null, 'restaurant-status restaurant-error');
  error.setAttribute('role', 'alert');
  pane.append(error, element('p', 'pickHelp', 'restaurant-help'));

  const idsInput = element('input');
  idsInput.id = 'restaurant-item-ids';
  idsInput.autocomplete = 'off';
  pane.append(inputLabel('ids', idsInput));
  const selectionRow = element('div', null, 'restaurant-row');
  selectionRow.append(
    button('applySelection', () => setSelection(parseIds())),
    button('addCurrent', () => {
      if (ui.sel?.kind !== 'furn') return showError(text('currentRequired'));
      setSelection([...selection, ui.sel.id]);
    }),
    button('clearSelection', () => setSelection([])),
  );
  pane.append(selectionRow);
  const additive = element('input');
  additive.type = 'checkbox';
  const additiveLabel = element('label', null, 'restaurant-inline');
  additiveLabel.append(additive, element('span', 'additive'));
  pane.append(additiveLabel);

  const groupInput = element('input');
  groupInput.id = 'restaurant-group-name';
  pane.append(inputLabel('groupName', groupInput));
  const groupRow = element('div', null, 'restaurant-row');
  groupRow.append(button('createGroup', () => {
    const itemIds = parseIds();
    if (!itemIds.length) return showError(text('selectionRequired'));
    const name = groupInput.value.trim();
    if (!name) return showError(text('nameRequired'));
    enqueue('group', () => ({ expectedRevision: project.revision, name, itemIds }));
  }));
  pane.append(groupRow);
  const groupsInput = element('select');
  groupsInput.id = 'restaurant-groups';
  groupsInput.addEventListener('change', () => {
    const group = project.groups.find(candidate => candidate.id === groupsInput.value);
    if (group) setSelection(group.itemIds);
  });
  pane.append(inputLabel('groups', groupsInput));

  const dxInput = element('input');
  dxInput.id = 'restaurant-dx';
  dxInput.type = 'number';
  dxInput.value = '300';
  const dyInput = element('input');
  dyInput.id = 'restaurant-dy';
  dyInput.type = 'number';
  dyInput.value = '0';
  const moveRow = element('div', null, 'restaurant-row');
  moveRow.append(inputLabel('dx', dxInput), inputLabel('dy', dyInput));
  pane.append(moveRow);
  const moveButton = button('move', () => {
    const itemIds = parseIds();
    if (!itemIds.length) return showError(text('selectionRequired'));
    const dxMm = Number(dxInput.value), dyMm = Number(dyInput.value);
    if (!dxInput.value.trim() || !dyInput.value.trim() || !Number.isFinite(dxMm) || !Number.isFinite(dyMm)) return showError(text('finiteShift'));
    enqueue('move', () => ({ expectedRevision: project.revision, itemIds, dxMm, dyMm }));
  });
  moveButton.id = 'restaurant-move';
  const moveActions = element('div', null, 'restaurant-row');
  moveActions.append(moveButton);
  pane.append(moveActions, element('p', 'scope', 'restaurant-help'));
  const issueSection = element('details');
  issueSection.append(element('summary', 'issues'));
  const issueList = element('ul', null, 'restaurant-issues');
  issueSection.append(issueList);
  pane.append(issueSection);
  document.querySelector('aside.right').prepend(pane);

  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  overlay.id = 'restaurant-selection';
  svg.append(overlay);
  const previewOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  previewOverlay.id = 'restaurant-preview';
  svg.append(previewOverlay);
  if (scene) {
    sceneStatus = element('p', null, 'restaurant-scene-status');
    sceneStatus.setAttribute('role', 'status');
    $('#stage').append(sceneStatus);
  }

  function showError(message, details = []) {
    errorText = message;
    rejectedIssues = Array.isArray(details) ? details : [];
    renderStatus();
  }

  function clearError() {
    errorText = '';
    rejectedIssues = [];
  }

  function describeIssue(issue) {
    const itemIds = Array.isArray(issue?.itemIds) ? issue.itemIds.join(', ') : '';
    const obstacle = typeof issue?.obstacleId === 'string' ? ' / ' + issue.obstacleId : '';
    return itemIds + obstacle + ': ' + String(issue?.message || '');
  }

  function parseIds() {
    return [...new Set(idsInput.value.split(/[\s,，]+/u).filter(Boolean))];
  }

  function request(method, payload) {
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ channel: 'restaurant', id, method, payload }, '*');
    });
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.channel !== 'restaurant') return;
    if (message.method === 'proposal-changed') {
      proposalEpoch++;
      void poll();
      return;
    }
    if (typeof message.id !== 'string') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.result?.ok === true) entry.resolve(message.result.value);
    else {
      const cause = new Error(message.result?.error?.message || text('failed'));
      cause.issues = message.result?.error?.details?.issues;
      entry.reject(cause);
    }
  });

  function interactionActive() {
    return pointers.size > 0 || drag !== null || libDrag !== null
      || (document.hasFocus() && document.activeElement?.matches('input,select,textarea'));
  }

  function drawSelection() {
    overlay.replaceChildren();
    for (const id of selection) {
      const item = state.furniture.find(candidate => candidate.id === id);
      if (!item) continue;
      const rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectangle.setAttribute('x', String(-item.w / 2));
      rectangle.setAttribute('y', String(-item.d / 2));
      rectangle.setAttribute('width', String(item.w));
      rectangle.setAttribute('height', String(item.d));
      rectangle.setAttribute('transform', 'translate(' + item.cx + ' ' + item.cy + ') rotate(' + item.rot + ')');
      overlay.append(rectangle);
    }
  }

  function drawPreview() {
    previewOverlay.replaceChildren();
    if (!proposal) return;
    const affected = new Set(proposal.issues.flatMap(issue => issue.itemIds));
    for (const envelope of proposal.chairEnvelopes) {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', envelope.polygon.map(point => point.join(',')).join(' '));
      polygon.setAttribute('data-item-id', envelope.itemId);
      if (affected.has(envelope.itemId)) polygon.classList.add('conflict');
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      label.textContent = text('pullout') + ' · ' + envelope.itemId;
      polygon.append(label);
      previewOverlay.append(polygon);
    }
  }

  function renderStatus() {
    status.textContent = proposal ? text('preview')
      : mutations ? text('saving') : selecting ? text('selecting') : text('revision') + ' ' + project.revision;
    if (sceneStatus) sceneStatus.textContent = proposal ? text('preview') : '';
    error.textContent = [errorText, ...rejectedIssues.map(describeIssue)].filter(Boolean).join('\n');
    const locked = scene || Boolean(proposal) || mutations > 0;
    for (const node of pane.querySelectorAll('button,input,select')) node.disabled = locked;
    const canUndo = history ? history.canUndo : project.revision > 0;
    const canRedo = history ? history.canRedo : project.revision > 0;
    $('#undo').disabled = locked || !canUndo;
    $('#redo').disabled = locked || !canRedo;
    $('#undo').style.opacity = $('#undo').disabled ? '.4' : '1';
    $('#redo').style.opacity = $('#redo').disabled ? '.4' : '1';
  }

  function renderWorkspace() {
    if (document.activeElement !== idsInput) idsInput.value = selection.join(', ');
    const chosenGroup = groupsInput.value;
    if (document.activeElement !== groupsInput) {
      groupsInput.replaceChildren();
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = text('chooseGroup');
      groupsInput.append(empty);
      for (const group of project.groups) {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name + ' (' + group.itemIds.length + ')';
        groupsInput.append(option);
      }
      groupsInput.value = chosenGroup;
    }
    issueList.replaceChildren();
    if (!issues.length) {
      const line = element('li');
      line.textContent = text('noIssues');
      issueList.append(line);
    }
    else for (const issue of issues) {
      const line = element('li');
      line.textContent = describeIssue(issue);
      issueList.append(line);
    }
    drawSelection();
    drawPreview();
    renderStatus();
  }

  function showLayout() {
    const accepted = clone(project.state);
    if (proposal) {
      const removed = new Set(proposal.removedItemIds);
      accepted.furniture = accepted.furniture.filter(item => !removed.has(item.id)).concat(clone(proposal.addedItems));
      ui.sel = null;
      ui.mA = ui.mCur = null;
      ui.layers.furn = true;
      $('[data-layer="furn"]')?.classList.add('on');
      const showSceneFurniture = $('[data-t="furn"]:not(.on)');
      showSceneFurniture?.click();
      setTool('select');
    }
    state = accepted;
    document.body.toggleAttribute('data-restaurant-preview', Boolean(proposal));
    validateSel();
    undoStack.length = redoStack.length = 0;
    renderAll();
  }

  function applySnapshot(snapshot, preserveLocal = false, acceptSelection = true, forceLayout = false) {
    if (snapshot.project.revision < project.revision) return;
    const changed = snapshot.project.revision !== project.revision;
    const next = snapshot.proposal?.baseRevision === snapshot.project.revision ? snapshot.proposal : null;
    const previewChanged = next?.id !== proposal?.id;
    project = snapshot.project;
    issues = snapshot.issues;
    history = snapshot.history || null;
    if (acceptSelection) selection = snapshot.selection;
    if (!preserveLocal && (changed || previewChanged || forceLayout)) {
      proposal = next;
      showLayout();
    }
    renderWorkspace();
  }

  function setSelection(itemIds) {
    if (scene || proposal) return;
    selection = [...new Set(itemIds)];
    idsInput.value = selection.join(', ');
    const epoch = ++selectionEpoch;
    const requested = [...selection];
    selecting++;
    renderWorkspace();
    selectionQueue = selectionQueue.then(async () => {
      try {
        const snapshot = await request('select', { itemIds: requested });
        if (selectionEpoch === epoch) {
          clearError();
          if (mutations > 0 || interactionActive()) {
            selection = snapshot.selection;
            renderWorkspace();
          } else applySnapshot(snapshot);
        }
      } catch (cause) {
        if (selectionEpoch === epoch) showError(cause.message);
      } finally {
        selecting--;
        renderStatus();
      }
    });
  }

  function enqueue(method, payload) {
    if (scene || proposal) return;
    const epoch = ++editEpoch;
    const queuedGeneration = generation;
    mutations++;
    clearError();
    renderStatus();
    mutationQueue = mutationQueue.then(async () => {
      try {
        if (queuedGeneration !== generation) return;
        const snapshot = await request(method, payload());
        applySnapshot(snapshot, editEpoch !== epoch || pointers.size > 0, selecting === 0);
      } catch (cause) {
        generation++;
        showError(cause.message, cause.issues);
        try {
          const snapshot = await request('state');
          applySnapshot(snapshot, false, selecting === 0, true);
        } catch {
          // A failed refresh keeps the last accepted project available for rollback.
          showLayout();
        }
      } finally {
        mutations--;
        renderWorkspace();
      }
    });
  }

  const originalSelect = select;
  select = selected => {
    if (scene || proposal) return;
    originalSelect(selected);
    const ids = selected?.kind === 'furn' ? [selected.id] : [];
    setSelection(additive.checked && ids.length ? [...selection, ...ids] : ids);
  };
  undo = () => enqueue('undo', () => ({ expectedRevision: project.revision }));
  redo = () => enqueue('redo', () => ({ expectedRevision: project.revision }));
  $('#undo').onclick = () => undo();
  $('#redo').onclick = () => redo();
  const originalUpdateHeader = updateHeader;
  updateHeader = () => { originalUpdateHeader(); renderStatus(); };
  const originalSetLang = setLang;
  setLang = language => {
    originalSetLang(language);
    for (const [node, key] of labelNodes) node.textContent = text(key);
    renderWorkspace();
    window.parent.postMessage({ channel: 'restaurant', method: 'language', language: LANG }, '*');
  };
  const originalSetTool = setTool;
  setTool = tool => {
    if ((scene || proposal) && tool !== 'select') return;
    if (tool === 'demolish') return showError(text('locked'));
    originalSetTool(tool);
  };
  const originalMutate = mutate;
  mutate = action => {
    if (scene || proposal) return;
    originalMutate(action);
  };
  for (const node of document.querySelectorAll('[data-tool="demolish"]')) node.hidden = true;
  $('#reset').hidden = true;
  $('#importJson').hidden = true;
  $('#fileIn').onchange = null;
  $('#exportJson').onclick = () => {
    if (scene || proposal) return;
    download(text('exportName') + '-r' + project.revision + '.json',
      new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  };

  window.RestaurantBridge = {
    save() {
      if (scene || proposal) return showLayout();
      const snapshot = clone(state);
      enqueue('save', () => ({ expectedRevision: project.revision, state: snapshot }));
    },
    locked() { showError(text('locked')); },
  };

  document.addEventListener('pointerdown', event => {
    if (mutations > 0 || (proposal && event.target.closest('[data-fid], #gSel, aside.lib, #panel, #fab'))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if ($('#stage').contains(event.target)) pointers.add(event.pointerId);
  }, true);
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const navigationKey = ['escape', 'tab', 'enter', ' ', 'w', 'a', 's', 'd', 'e', 'shift'].includes(key);
    if (mutations > 0 || (bootstrap.view === 'plan' && key === 't') || ((scene || proposal) && !navigationKey)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  const release = event => pointers.delete(event.pointerId);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', () => pointers.clear());

  async function poll() {
    if (polling || mutations || selecting || interactionActive()) return;
    polling = true;
    const epoch = editEpoch, picked = selectionEpoch, proposalAtStart = proposalEpoch;
    try {
      const snapshot = await request('state');
      if (!mutations && !selecting && !interactionActive() && editEpoch === epoch && selectionEpoch === picked
        && proposalEpoch === proposalAtStart) {
        applySnapshot(snapshot);
      }
    } catch (cause) {
      showError(cause.message);
    } finally {
      polling = false;
      if (proposalEpoch !== proposalAtStart) void poll();
    }
  }
  renderWorkspace();
  poll();
  window.parent.postMessage({ channel: 'restaurant', method: 'language', language: LANG }, '*');
  setInterval(poll, bootstrap.pollIntervalMs);
})();
