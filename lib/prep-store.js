/* 청구 준비 저장소 (백그라운드 전용, background.js 가 importScripts)
 * eClass 패널의 카드미청구 거래 행에서 미리 고른 청구종류(청구서 세목 빠른 선택 항목)와 끌어다 놓은 첨부 파일을 보관한다.
 *  메타: storage.local.claimPrep = { [key]: { key, appr(승인번호), card4(카드 뒤 4자리), prjNo, shop, amount, usedDate,
 *                                            type(청구종류 표시이름 | ''), ptcl(청구내역·적요 글 | ''), files: [{ id, name, mime, size, ts }], ts, attached: { ts, n } | null, missingSince?,
 *                                            run: { state: running|saved|applied|failed, stage, mode, ts, tabId, msg, saved, reqNo, reqCnt } | null (백그라운드 청구서 작성·신청 상태, background.js prepRun/prepRunResult) } }
 *        key = KRX_FMT.prepKey(승인번호, 카드번호) = "승인번호|뒤4자리". 패널(lib/prep.js)·ERP 청구서(content/rnd-claim.js)가 같은 키로 찾는다
 *  파일 내용: 확장 출처의 IndexedDB(krext › prepFiles, keyPath id)에 Blob 으로. 콘텐츠스크립트는 페이지 출처라 이 DB 를 못 보므로 메시지로 base64 를 주고받는다
 *  정리: 거래가 미청구 목록에서 사라지면(내역 추가 = 임시저장 뒤 등) missingSince 를 찍고 7일 뒤 지운다 — 그동안 패널의 "신청 대기" 목록에 남아 신청 버튼을 준다. 신청까지 끝난(run.state applied) 항목은 하루 뒤 지움.
 *  (cleanup, background refresh 마다). 메타에 없는 고아 Blob 도 10분 지나면 지움 */
const KRX_PREP_STORE = (() => {
  const DB = 'krext', STORE = 'prepFiles', VER = 1, META = 'claimPrep';
  const MISSING_TTL = 7 * 24 * 3600 * 1000;
  const APPLIED_TTL = 24 * 3600 * 1000;   // 신청까지 끝난 항목
  const ORPHAN_TTL = 10 * 60 * 1000;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => { const db = r.result; db.onclose = () => { dbp = null; }; db.onversionchange = () => { try { db.close(); } catch (e) {} dbp = null; }; res(db); };
      r.onerror = () => { dbp = null; rej(r.error || new Error('IndexedDB 열기 실패')); };
      r.onblocked = () => { dbp = null; rej(new Error('IndexedDB 열기 차단')); };
    });
    return dbp;
  }
  const req = (mode, fn) => open().then((db) => new Promise((res, rej) => {
    let t;
    try { t = db.transaction(STORE, mode); } catch (e) { dbp = null; rej(e); return; }
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const put = (rec) => req('readwrite', (s) => s.put(rec));
  const get = (id) => req('readonly', (s) => s.get(id));
  const del = (id) => req('readwrite', (s) => s.delete(id));
  /* 모든 레코드의 { id, ts } (Blob 은 읽지 않음) */
  const index = () => open().then((db) => new Promise((res, rej) => {
    const out = [];
    let t;
    try { t = db.transaction(STORE, 'readonly'); } catch (e) { dbp = null; rej(e); return; }
    const r = t.objectStore(STORE).openCursor();
    r.onsuccess = () => { const c = r.result; if (!c) { res(out); return; } out.push({ id: c.key, ts: (c.value && c.value.ts) || 0 }); c.continue(); };
    r.onerror = () => rej(r.error);
  }));

  function b64ToBytes(b64) {
    const bin = atob(String(b64 || '').replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function blobToB64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  async function loadMeta() { try { return (await chrome.storage.local.get(META))[META] || {}; } catch (e) { return {}; } }
  async function saveMeta(m) { await chrome.storage.local.set({ [META]: m }); }
  /* 항목을 만들거나 가져오며 거래 정보(승인번호·카드·과제·가맹점·금액·사용일)를 갱신 */
  function ensure(m, key, meta) {
    const e = m[key] || (m[key] = { key, type: '', files: [], ts: Date.now(), attached: null });
    if (!Array.isArray(e.files)) e.files = [];
    if (typeof e.ptcl !== 'string') e.ptcl = '';
    for (const k of ['appr', 'card4', 'prjNo', 'shop', 'amount', 'usedDate']) if (meta && meta[k] != null && meta[k] !== '') e[k] = meta[k];
    if (!e.appr || !e.card4) { const [a, c] = String(key).split('|'); if (!e.appr) e.appr = a || ''; if (!e.card4) e.card4 = c || ''; }
    delete e.missingSince;
    return e;
  }
  const isEmpty = (e) => !e || (!e.type && !e.ptcl && !(e.files || []).length);
  /* 내용이 바뀌면 지난 작성 결과 표시는 지운다 — 단, 이미 내역 추가(임시저장)·신청된 결과는 거래 상태라 남긴다 */
  const resetRun = (e) => { if (e.run && e.run.state !== 'running' && !e.run.saved && e.run.state !== 'done' && e.run.state !== 'saved' && e.run.state !== 'applied') e.run = null; };

  async function setType(key, meta, type) {
    const m = await loadMeta();
    const e = ensure(m, key, meta);
    e.type = String(type || '').trim();
    e.ts = Date.now();
    resetRun(e);
    if (isEmpty(e)) delete m[key];
    await saveMeta(m);
    return m[key] || null;
  }
  /* 청구내역(적요) 글: 청구서 폼의 청구내역 칸(#REQ_PTCL, 화면 필수값)에 그대로 넣는다 */
  async function setPtcl(key, meta, text) {
    const m = await loadMeta();
    const e = ensure(m, key, meta);
    e.ptcl = String(text || '').trim();
    e.ts = Date.now();
    resetRun(e);
    if (isEmpty(e)) delete m[key];
    await saveMeta(m);
    return m[key] || null;
  }
  /* 백그라운드 탭 자동 작성·신청("청구서 작성" / "작성+신청" / "신청") 상태: { state: running | saved | applied | failed, stage, mode, ts, tabId, msg, saved, reqNo, reqCnt } (이전 버전은 done = saved) */
  async function setRun(key, run) {
    const m = await loadMeta();
    const e = m[key];
    if (!e) return null;
    e.run = run || null;
    await saveMeta(m);
    return e;
  }
  /* files: [{ name, mime, size, b64 }] → Blob 저장 + 메타 files 추가. 파일이 새로 들어오면 attached 표시는 지운다 (다시 첨부 대상) */
  async function addFiles(key, meta, files) {
    const m = await loadMeta();
    const e = ensure(m, key, meta);
    for (const f of files || []) {
      if (!f || !f.name) continue;
      const bytes = b64ToBytes(f.b64);
      const id = newId();
      const mime = String(f.mime || '') || 'application/octet-stream';
      await put({ id, key, name: String(f.name), mime, size: bytes.length, blob: new Blob([bytes], { type: mime }), ts: Date.now() });
      e.files.push({ id, name: String(f.name), mime, size: bytes.length, ts: Date.now() });
    }
    e.ts = Date.now();
    e.attached = null;
    resetRun(e);
    await saveMeta(m);
    return m[key] || null;
  }
  async function removeFile(key, id) {
    const m = await loadMeta();
    const e = m[key];
    if (!e) return null;
    e.files = (e.files || []).filter((f) => f.id !== id);
    try { await del(id); } catch (x) {}
    if (isEmpty(e)) delete m[key];
    await saveMeta(m);
    return m[key] || null;
  }
  async function clear(key) {
    const m = await loadMeta();
    const e = m[key];
    if (!e) return false;
    for (const f of e.files || []) { try { await del(f.id); } catch (x) {} }
    delete m[key];
    await saveMeta(m);
    return true;
  }
  async function clearAll() {
    const m = await loadMeta();
    for (const e of Object.values(m)) for (const f of e.files || []) { try { await del(f.id); } catch (x) {} }
    try { for (const r of await index()) { try { await del(r.id); } catch (x) {} } } catch (x) {}
    await saveMeta({});
    return true;
  }
  /* 승인번호(+카드 뒤 4자리)로 찾기. 키가 정확히 맞는 항목 → 승인번호만 맞는 항목. withFiles 면 Blob 을 base64 로 실어 보낸다 (Blob 이 사라진 파일은 missing) */
  async function getEntry(appr, card4, withFiles) {
    const m = await loadMeta();
    const a = String(appr || '').trim(), c = String(card4 || '').replace(/\D/g, '').slice(-4);
    const e = (a && (m[`${a}|${c}`] || Object.values(m).find((x) => x && String(x.appr || '') === a))) || null;
    if (!e) return { entry: null, files: [] };
    const files = [];
    if (withFiles) for (const f of e.files || []) {
      let rec = null;
      try { rec = await get(f.id); } catch (x) {}
      if (!rec || !rec.blob) { files.push({ id: f.id, name: f.name, mime: f.mime, size: f.size, missing: true }); continue; }
      files.push({ id: f.id, name: f.name, mime: f.mime || rec.mime, size: f.size, b64: await blobToB64(rec.blob) });
    }
    return { entry: e, files };
  }
  async function markAttached(key, n) {
    const m = await loadMeta();
    const e = m[key];
    if (!e) return null;
    e.attached = { ts: Date.now(), n: Number(n) || (e.files || []).length };
    await saveMeta(m);
    return e;
  }
  /* currentKeys: 지금 미청구 목록에 있는 거래 키. 없는 항목은 missingSince 를 찍고 7일 지나면 삭제(신청 대기 목록에 그동안 남음). 신청까지 끝난 항목은 하루 지나면 삭제. 메타에 없는 고아 Blob 은 10분 지나면 삭제 */
  async function cleanup(currentKeys) {
    const m = await loadMeta();
    const now = Date.now();
    let changed = false;
    for (const [k, e] of Object.entries(m)) {
      if (e.run && e.run.state === 'applied' && now - (e.run.ts || 0) > APPLIED_TTL) {
        for (const f of e.files || []) { try { await del(f.id); } catch (x) {} }
        delete m[k]; changed = true; continue;
      }
      if (currentKeys.has(k)) { if (e.missingSince) { delete e.missingSince; changed = true; } continue; }
      if (!e.missingSince) { e.missingSince = now; changed = true; continue; }
      if (now - e.missingSince > MISSING_TTL) {
        for (const f of e.files || []) { try { await del(f.id); } catch (x) {} }
        delete m[k]; changed = true;
      }
    }
    if (changed) await saveMeta(m);
    try {
      const known = new Set(Object.values(m).flatMap((e) => (e.files || []).map((f) => f.id)));
      for (const r of await index()) if (!known.has(r.id) && now - (r.ts || 0) > ORPHAN_TTL) { try { await del(r.id); } catch (x) {} }
    } catch (x) {}
  }
  /* 저장 현황 (설정 페이지): 항목 수 · 파일 수 · 용량 */
  async function stats() {
    const m = await loadMeta();
    let files = 0, bytes = 0;
    for (const e of Object.values(m)) for (const f of e.files || []) { files++; bytes += Number(f.size) || 0; }
    return { entries: Object.keys(m).length, files, bytes };
  }
  /* 승인번호(+카드 뒤 4자리)로 키 찾기 (ERP 청구서가 보고할 때 키를 모르는 경우) */
  async function keyFor(appr, card4) {
    const r = await getEntry(appr, card4, false);
    return r.entry ? r.entry.key : '';
  }
  return { META, loadMeta, setType, setPtcl, setRun, addFiles, removeFile, clear, clearAll, getEntry, keyFor, markAttached, cleanup, stats };
})();
