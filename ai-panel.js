'use strict';
import { chat } from './ai-providers.js';
import { buildContext } from './ai-context.js';
import { getAllRecords, putRecord } from './db.js';
import { esc } from './util.js';
import { renderExtractPanel } from './extract.js';

const SYSTEM_BASE = '你是小說創作助理，以下是這部作品目前的設定資料，回答時要以此為準，發現前後矛盾要明確指出：\n\n';

const DEFAULT_PROMPTS = {
  consistency: '請檢查目前的設定資料有沒有前後矛盾的地方，逐項列出。',
  plot: '請根據目前的設定，發想接下來的劇情或反轉走向。',
};

async function runChatTask(projectId, task, userPrompt, logEl) {
  logEl.insertAdjacentHTML('beforeend', `<div class="ai-msg user">${esc(userPrompt)}</div>`);
  await putRecord(projectId, 'chatlogs', { task, role: 'user', content: userPrompt, createdAt: Date.now() });
  logEl.insertAdjacentHTML('beforeend', '<div class="ai-msg pending">思考中…</div>');
  const pendingEl = logEl.lastElementChild;
  try {
    const context = await buildContext(projectId);
    const reply = await chat(task, [
      { role: 'system', content: SYSTEM_BASE + context },
      { role: 'user', content: userPrompt },
    ]);
    pendingEl.remove();
    logEl.insertAdjacentHTML('beforeend', `<div class="ai-msg assistant">${esc(reply)}</div>`);
    await putRecord(projectId, 'chatlogs', { task, role: 'assistant', content: reply, createdAt: Date.now() });
  } catch (e) {
    pendingEl.remove();
    logEl.insertAdjacentHTML('beforeend', `<div class="ai-msg error">錯誤：${esc(e.message)}</div>`);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function renderChatControls(projectId, container, logEl) {
  container.innerHTML = `<textarea id="ai-input" placeholder="輸入問題…（一致性檢查/反轉發想留空會用預設問句）"></textarea><button id="ai-send" type="button">送出</button>`;
  const sendBtn = container.querySelector('#ai-send');
  sendBtn.addEventListener('click', async () => {
    const task = document.querySelector('#ai-task').value;
    const input = container.querySelector('#ai-input');
    const prompt = input.value.trim() || DEFAULT_PROMPTS[task] || '';
    if (!prompt) return;
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '送出中…';
    try {
      await runChatTask(projectId, task, prompt, logEl);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '送出';
    }
  });
}

function renderControls(projectId, controls, logEl) {
  const task = document.querySelector('#ai-task').value;
  if (task === 'extract') {
    renderExtractPanel(projectId, controls);
  } else {
    renderChatControls(projectId, controls, logEl);
  }
}

export async function renderAiTab(projectId, container) {
  const logs = await getAllRecords(projectId, 'chatlogs');
  container.innerHTML = `
    <div class="ai-log" id="ai-log">
      ${logs.sort((a, b) => a.createdAt - b.createdAt).map((l) => `<div class="ai-msg ${l.role}">${esc(l.content)}</div>`).join('')}
    </div>
    <div class="ai-task-select">
      <select id="ai-task">
        <option value="chat">自由問答</option>
        <option value="consistency">一致性檢查</option>
        <option value="plot">劇情/反轉發想</option>
        <option value="extract">抽取圖資料</option>
      </select>
    </div>
    <div id="ai-controls"></div>
  `;
  const logEl = container.querySelector('#ai-log');
  const controls = container.querySelector('#ai-controls');
  renderControls(projectId, controls, logEl);
  container.querySelector('#ai-task').addEventListener('change', () => renderControls(projectId, controls, logEl));
}
