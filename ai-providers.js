'use strict';

export const PROVIDERS = {
  llmshare: { label: 'llmshare（多奇團購閘道）', base: 'https://llm-share.duotify.com/v1', model: 'glm-5.2' },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  gemini: { label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-flash-lite' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  ollama: { label: 'Ollama（本機）', base: 'http://localhost:11434/v1', model: 'llama3.2', keyless: true },
  custom: { label: '自訂（OpenAI 相容）', base: '', model: '' },
};

const AI_KEY = 'mycelium-ai';

export function loadAiConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_KEY));
    return raw && raw.tasks ? raw : { tasks: {} };
  } catch (e) {
    return { tasks: {} };
  }
}

export function saveAiConfig(cfg) {
  localStorage.setItem(AI_KEY, JSON.stringify(cfg));
}

export function taskConfig(task) {
  const cfg = loadAiConfig();
  const t = cfg.tasks[task];
  // settings.js's save-all-fieldsets handler writes an entry for every task even
  // when its fields were left blank, so "present but incomplete" must still fall
  // through to tasks.default — only a config with both base and model counts as configured.
  if (t && t.base && t.model) return t;
  return cfg.tasks.default || null;
}

export function setTaskConfig(task, providerCfg) {
  const cfg = loadAiConfig();
  cfg.tasks[task] = providerCfg;
  saveAiConfig(cfg);
}

export async function chat(task, messages) {
  const c = taskConfig(task);
  if (!c || !c.base || !c.model) throw new Error(`請先在「設定」分頁設定 ${task} 任務要用的 AI。`);
  const url = c.base.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c.key ? { authorization: 'Bearer ' + c.key } : {}) },
    body: JSON.stringify({ model: c.model, messages }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e0 = Array.isArray(d) ? d[0] || {} : d;
    throw new Error((e0.error && e0.error.message) || `HTTP ${res.status}`);
  }
  const m = d.choices && d.choices[0] && d.choices[0].message;
  if (!m || typeof m.content !== 'string') throw new Error('模型沒有回傳文字內容。');
  return m.content;
}
