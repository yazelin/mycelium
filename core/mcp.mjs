// MCP server：stdio、換行分隔的 JSON-RPC 2.0。stdout 只寫 JSON-RPC 行，日誌一律走 stderr。
import readline from 'node:readline';

const VERSION = '0.1.0';
const AUD_READ = "audiences 必填。公開場合只給 ['public']；跟某人私下對話時給 ['public','person:<對方 id>']。";
const PUBLIC_ONLY = '人物名稱、摘要與合併視為公開資訊，只能根據公開資訊寫。私下得知的事（含「某兩人是同一人」）請用 remember 記成 audience 為 person:<對象> 的事實，不要寫進摘要、也不要合併。';
const NARROW = '較私下的資訊不能改動較公開的事實：只有寫入範圍與舊事實相同，或寫入範圍是 public，才能取代（supersedes）或讓它失效。';
const AUD_WRITE = "可見範圍標籤：'public'、'person:<人物 id>'、'group:<名稱>'、'role:<名稱>'。";

const S = { type: 'string' };
const space = { type: 'string', description: '空間 id（必填）' };
const audiences = { type: 'array', items: S, description: AUD_READ };
const obj = (properties, required) => ({ type: 'object', properties, required });

const TOOLS = [
  {
    name: 'log_episode',
    description: '記錄一段原始對話或事件（情節片段）。事實的來源紀錄；之後 remember 可用 sourceEpisode 指回它。',
    inputSchema: obj({ space, at: { ...S, description: '發生時間（日期或章節）' }, source: { ...S, description: '來源，例如平台或對話名稱' },
      audience: { ...S, description: AUD_WRITE }, body: { ...S, description: '內容' }, entityIds: { type: 'array', items: S } },
    ['space', 'at', 'source', 'audience', 'body']),
    run: (st, a) => ({ episodeId: st.logEpisode(a.space, a) }),
  },
  {
    name: 'upsert_entity',
    description: `建立或更新人物／地點／物件。不帶 entityId 為新建（type、name 必填），會回傳可能重複的候選（每個候選帶 entityId＝命中的那一列、resolvedId＝合併後的人物；person: 標籤用 entityId，主體與關係用 resolvedId）；帶 entityId 為更新名稱或摘要。回傳的候選或同類事實要自己判斷，系統不會自動合併。${PUBLIC_ONLY}`,
    // 「新建時 type、name 必填」寫在說明裡、由 Store 檢查；不用頂層 anyOf，有些模型 API 的工具 schema 不接受。
    inputSchema: obj({ space, type: { ...S, description: '種類，例如 person（新建時必填）' }, name: { ...S, description: '名稱（新建時必填）' },
      summary: S, entityId: { ...S, description: '要更新的人物 id' },
      audiences: { type: 'array', items: S, description: "找重複候選時能比對哪些可見範圍的別名，預設 ['public']。跟某人私下對話時給 ['public','person:<對方 id>']。" } }, ['space']),
    run: (st, a) => st.upsertEntity(a.space, a),
  },
  {
    name: 'add_alias',
    description: '替人物加別名、綽號或平台帳號（isHandle）。私下得知的綽號請把 audience 設成 person:<對象>。',
    inputSchema: obj({ space, entityId: S, alias: S, platform: S, isHandle: { type: 'boolean' }, audience: { ...S, description: AUD_WRITE } },
      ['space', 'entityId', 'alias']),
    run: (st, a) => ({ aliasId: st.addAlias(a.space, a.entityId, a.alias, a) }),
  },
  {
    name: 'remember',
    description: `記下一筆事實（主詞、謂詞、受詞）。受詞三選一：objectEntity、objectText、objectFact。回傳的候選或同類事實要自己判斷，系統不會自動合併；舊的要取代就用 supersedes 或 invalidate。${NARROW}${AUD_WRITE}`,
    inputSchema: obj({ space, subjectId: S, predicate: S, objectEntity: S, objectText: S, objectFact: S, validFrom: S, validTo: S,
      audience: { ...S, description: AUD_WRITE }, sourceEpisode: S, confidence: { type: 'number' }, author: S, supersedes: { type: 'array', items: S } },
    ['space', 'subjectId', 'predicate', 'validFrom', 'audience', 'author']),
    run: (st, a) => st.remember(a.space, a),
  },
  {
    name: 'invalidate',
    description: `把一筆事實標為從某時間起失效（不刪除）。事實改變時用，例如人物搬家、換武器。${NARROW}`,
    inputSchema: obj({ space, factId: S, at: { ...S, description: '失效時間' }, by: { ...S, description: '取代它的事實 id（可省）' },
      audience: { ...S, description: `這次根據的資訊來自哪個可見範圍，預設 'public'。${AUD_WRITE}` } }, ['space', 'factId', 'at']),
    run: (st, a) => { st.invalidate(a.space, a.factId, a.at, a.by, a.audience ?? 'public'); return { ok: true }; },
  },
  {
    name: 'merge_entities',
    description: `確定兩個人物是同一人時，把 fromId 併入 toId（可用 unmerge 復原）。${PUBLIC_ONLY}`,
    inputSchema: obj({ space, fromId: S, toId: S, reason: S }, ['space', 'fromId', 'toId']),
    run: (st, a) => ({ mergeId: st.mergeEntities(a.space, a.fromId, a.toId, a.reason) }),
  },
  {
    name: 'unmerge',
    description: '復原一次合併（給 mergeId）。',
    inputSchema: obj({ space, mergeId: S }, ['space', 'mergeId']),
    run: (st, a) => { st.unmerge(a.space, a.mergeId); return { ok: true }; },
  },
  {
    name: 'recall',
    description: `開口前先喚醒記憶：依文字或人物名稱取回相關人物、事實與片段，並附一段可直接放進上下文的摘要。${AUD_READ}`,
    inputSchema: obj({ space, text: S, names: { type: 'array', items: S }, at: S, audiences, hops: { type: 'integer' }, maxChars: { type: 'integer' } }, ['space', 'audiences']),
    run: (st, a) => st.recall(a.space, a),
  },
  {
    name: 'get_entity',
    description: `取得單一人物的完整資料（別名、事實、關係）。${AUD_READ}`,
    inputSchema: obj({ space, entityId: S, at: S, audiences }, ['space', 'entityId', 'audiences']),
    run: (st, a) => st.getEntity(a.space, a.entityId, a),
  },
  {
    name: 'search',
    description: `全文搜尋人物、別名、事實與片段。${AUD_READ}`,
    inputSchema: obj({ space, query: S, audiences, limit: { type: 'integer' } }, ['space', 'query', 'audiences']),
    run: (st, a) => st.search(a.space, a.query, a),
  },
  {
    name: 'timeline',
    description: `依時間排列事實與片段，可限定某個人物。${AUD_READ}`,
    inputSchema: obj({ space, entityId: S, audiences }, ['space', 'audiences']),
    run: (st, a) => st.timeline(a.space, a),
  },
  {
    name: 'neighbors',
    description: `列出與某人物有關係的其他人物（可指定跳數）。${AUD_READ}`,
    inputSchema: obj({ space, entityId: S, hops: { type: 'integer' }, at: S, audiences }, ['space', 'entityId', 'audiences']),
    run: (st, a) => st.neighbors(a.space, a.entityId, a),
  },
  {
    name: 'list_spaces',
    description: '列出所有空間（story 或 social）。不確定 space id 時先呼叫。',
    inputSchema: obj({}, []),
    run: (st) => st.listSpaces(),
  },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(store, msg) {
  const { id, method, params } = msg;
  const isNote = id === undefined || id === null;
  if (method === 'initialize') {
    return ok(id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mycelium', version: VERSION } });
  }
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') {
    return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return ok(id, { isError: true, content: [{ type: 'text', text: `找不到工具：${params?.name}` }] });
    try {
      const args = params.arguments ?? {};
      if (tool.inputSchema.required.length) {
        const miss = tool.inputSchema.required.filter((k) => args[k] == null);
        if (miss.length) throw new Error(`缺少必填參數：${miss.join('、')}`);
      }
      const result = await tool.run(store, args);
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }] });
    } catch (e) {
      return ok(id, { isError: true, content: [{ type: 'text', text: `錯誤：${e.message}` }] });
    }
  }
  if (isNote) return null; // 未知通知（含 notifications/initialized）不回應
  return fail(id, -32601, `未知的方法：${method}`);
}

export async function runMcp(store, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const send = (m) => output.write(JSON.stringify(m) + '\n');
  // 依序處理每一行，前一個完成才處理下一個
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      let msg;
      try { msg = JSON.parse(line); } catch { return send(fail(null, -32700, '無法解析 JSON')); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send(fail(null, -32600, '無效的請求'));
      try {
        const res = await handle(store, msg);
        if (res && msg.id !== undefined && msg.id !== null) send(res);
      } catch (e) {
        process.stderr.write(`mcp 內部錯誤：${e.stack ?? e}\n`);
        if (msg.id !== undefined && msg.id !== null) send(fail(msg.id, -32603, `內部錯誤：${e.message}`));
      }
    });
  });
  await new Promise((resolve) => rl.once('close', resolve));
  await chain;
}
