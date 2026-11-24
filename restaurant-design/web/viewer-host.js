/* The viewer can read and edit a layout through the bridge. Proposal confirmation belongs to this page. */
(() => {
  const get = id => document.getElementById(id);
  const frame = get('restaurant-frame');
  const scene = frame.dataset.view === 'scene';
  const panel = get('restaurant-proposal');
  const title = get('restaurant-proposal-title');
  const size = get('restaurant-proposal-size');
  const issues = get('restaurant-proposal-issues');
  const apply = get('restaurant-proposal-apply');
  const cancel = get('restaurant-proposal-cancel');
  const notice = get('restaurant-proposal-notice');
  const edits = new Set(['group', 'move', 'save', 'undo', 'redo']);
  let proposal = null;
  let project = null;
  let language = 'zh';
  let notification = null;
  let confirming = false;
  let sent = 0;
  let observed = 0;
  let revision = -1;

  const labels = {
    title: ['布置预览', '佈置預覽', 'Layout preview'],
    seats: ['座位', '座位', 'Seats'],
    table: ['餐桌', '餐桌', 'Table'],
    chair: ['座椅', '座椅', 'Chair'],
    candidateTable: ['四人餐桌', '四人餐桌', 'Four-seat table'],
    pullout: ['拉椅空间', '拉椅空間', 'Chair pull-out'],
    apply: ['确认应用', '確認套用', 'Apply layout'],
    cancel: ['取消预览', '取消預覽', 'Cancel preview'],
    blocked: ['预览存在空间冲突。', '預覽存在空間衝突。', 'The preview has layout conflicts.'],
    locked: ['请先确认或取消当前预览。', '請先確認或取消目前預覽。', 'Apply or cancel the current preview first.'],
    stale: ['预览已失效，已恢复最新保存的布局。', '預覽已失效，已恢復最新儲存的佈置。', 'The preview expired. The latest saved layout is shown.'],
    applied: ['已应用布局并保存。', '已套用佈置並儲存。', 'Layout applied and saved.'],
    cancelled: ['已取消预览。', '已取消預覽。', 'Preview cancelled.'],
    requestFailed: ['操作未完成，请重试。', '操作未完成，請重試。', 'The action could not be completed. Try again.'],
    furniture: ['家具重叠', '家具重疊', 'Furniture overlap'],
    wall: ['墙体冲突', '牆體衝突', 'Wall collision'],
    window: ['窗户冲突', '窗戶衝突', 'Window collision'],
    door: ['门扇开启冲突', '門扇開啟衝突', 'Door swing collision'],
    keepout: ['占用保留区域', '佔用保留區域', 'Keepout obstruction'],
    bounds: ['超出底图范围', '超出底圖範圍', 'Outside plan bounds'],
    'chair-clearance': ['拉椅空间受阻', '拉椅空間受阻', 'Chair pull-out obstructed'],
    obstacleWall: ['墙段', '牆段', 'Wall'],
    obstacleWindow: ['窗户', '窗戶', 'Window'],
    obstacleDoor: ['门', '門', 'Door'],
    obstacleBounds: ['底图边界', '底圖邊界', 'Plan bounds'],
  };
  const text = key => labels[key]?.[{ zh: 0, zht: 1, en: 2 }[language]];
  const shortId = id => id.length > 22 ? '…' + id.slice(-10) : id;

  function itemLabel(id) {
    const chairs = proposal.addedItems.filter(item => item.type === 'chair');
    const chair = chairs.findIndex(item => item.id === id);
    if (chair >= 0) return text('chair') + ' ' + (chair + 1);
    if (proposal.addedItems.some(item => item.id === id)) return text('candidateTable');
    const item = project.state.furniture.find(candidate => candidate.id === id);
    return item?.name ? item.name + ' (' + shortId(id) + ')' : shortId(id);
  }

  function obstacleLabel(id) {
    if (id === 'plan bounds') return text('obstacleBounds');
    const keepout = project.keepouts.find(candidate => candidate.id === id);
    if (keepout) return keepout.name;
    const indexed = /^(wall|window|door):(\d+)$/.exec(id);
    if (!indexed) return shortId(id);
    const [, kind, index] = indexed;
    const label = { wall: 'obstacleWall', window: 'obstacleWindow', door: 'obstacleDoor' }[kind];
    return text(label) + ' ' + index;
  }

  function renderProposal() {
    if (scene) return;
    panel.hidden = proposal === null;
    panel.setAttribute('aria-label', text('title'));
    notice.hidden = notification === null;
    notice.textContent = notification === null ? '' : (text(notification) || notification);
    apply.textContent = text('apply');
    cancel.textContent = text('cancel');
    if (!proposal) return;
    const { beforeSeats, afterSeats, template } = proposal;
    title.textContent = text('title') + ' · ' + text('seats') + ' ' + beforeSeats + ' → ' + afterSeats;
    size.textContent = text('table') + ' ' + template.tableWidthMm + ' × ' + template.tableDepthMm + ' mm · '
      + text('chair') + ' ' + template.chairWidthMm + ' × ' + template.chairDepthMm + ' mm · '
      + text('pullout') + ' ' + template.chairPulloutMm + ' mm';
    issues.replaceChildren();
    for (const issue of proposal.issues) {
      const line = document.createElement('li');
      const affected = issue.itemIds.map(itemLabel);
      if (issue.obstacleId) affected.push(obstacleLabel(issue.obstacleId));
      const overlap = issue.overlapMm > 0 ? ' · ' + (Math.round(issue.overlapMm * 10) / 10 || '<0.1') + ' mm' : '';
      line.textContent = (text(issue.kind) || issue.message) + ' · ' + affected.join(' / ') + overlap;
      issues.append(line);
    }
    if (!proposal.canApply && !proposal.issues.length) {
      const line = document.createElement('li');
      line.textContent = text('blocked');
      issues.append(line);
    }
    apply.disabled = confirming || !proposal.canApply;
    cancel.disabled = confirming;
  }

  function observe(snapshot, order) {
    if (scene || snapshot.project.revision < revision
      || (snapshot.project.revision === revision && order < observed)) return;
    observed = order;
    revision = snapshot.project.revision;
    project = snapshot.project;
    const next = snapshot.proposal?.baseRevision === revision ? snapshot.proposal : null;
    if (next?.id !== proposal?.id) {
      notification = proposal && !next ? 'stale' : null;
      proposal = next;
    }
    renderProposal();
  }

  async function call(method, payload) {
    const order = ++sent;
    try {
      const response = method === 'state'
        ? await fetch('/api/restaurant.state', { credentials: 'same-origin', cache: 'no-store' })
        : await fetch('/restaurant-rpc/' + method, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
        });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const body = await response.json();
      const result = method === 'state' ? { ok: true, value: body } : body.result;
      if (!result || typeof result.ok !== 'boolean') throw new Error('Invalid restaurant response');
      if (result.ok) observe(result.value, order);
      return result;
    } catch (error) {
      return { ok: false, error: { code: 'REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async function decide(event, method) {
    if (!event.isTrusted || confirming || !proposal || (method === 'applyProposal' && !proposal.canApply)) return;
    confirming = true;
    notification = null;
    renderProposal();
    const proposalId = proposal.id;
    const result = await call(method, { proposalId });
    confirming = false;
    if (result.ok) {
      observed = ++sent;
      if (proposal?.id === proposalId) proposal = null;
      notification = method === 'applyProposal' ? 'applied' : 'cancelled';
    } else {
      await call('state');
      notification = proposal ? (result.error?.message || 'requestFailed') : 'stale';
    }
    renderProposal();
    frame.contentWindow.postMessage({ channel: 'restaurant', method: 'proposal-changed' }, '*');
  }

  if (!scene) {
    apply.addEventListener('click', event => { void decide(event, 'applyProposal'); });
    cancel.addEventListener('click', event => { void decide(event, 'cancelProposal'); });
  }
  window.addEventListener('message', async event => {
    if (event.source !== frame.contentWindow) return;
    const message = event.data;
    if (!message || message.channel !== 'restaurant') return;
    if (message.method === 'language') {
      if (['zh', 'zht', 'en'].includes(message.language)) {
        language = message.language;
        document.documentElement.lang = { zh: 'zh-CN', zht: 'zh-TW', en: 'en' }[language];
        renderProposal();
      }
      return;
    }
    if (typeof message.id !== 'string') return;
    const { method } = message;
    if (method !== 'state' && (scene || (method !== 'select' && !edits.has(method)))) return;
    const result = (proposal || confirming) && edits.has(method)
      ? { ok: false, error: { code: 'PROPOSAL_PENDING', message: text('locked') } }
      : await call(method, message.payload);
    frame.contentWindow.postMessage({ channel: 'restaurant', id: message.id, result }, '*');
  });
})();
