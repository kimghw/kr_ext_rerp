/* 청구 준비 (카드미청구 거래 행 밑 "↳" 둘째 줄의 "청구종류 · 청구내역(적요) · 첨부 · 청구서 작성" 요소) 입력 처리. eClass 콘텐츠스크립트 / 팝업 공용
 * 거래마다 청구종류(청구서 세목 빠른 선택 항목: 연구실 운영비, 회의비 …)를 고르고 청구내역(청구서 폼의 적요 글, 화면 필수값)을 적고 첨부 파일을 끌어다 놓거나(첨부 구역 클릭 → 파일 선택 창) 두면,
 * 그 거래 행을 클릭해 R&D ERP 청구서(카드)를 열 때(rexpe_0083_01 + krext_appr) content/rnd-claim.js 가 청구내역 폼에서 세목·청구종류를 고르고 청구내역을 적고 파일을 첨부 목록에 넣는다.
 * 저장은 백그라운드(lib/prep-store.js)가 한다: 메타 storage.local.claimPrep(이 모듈이 읽어 state.prep 에 둠), 파일 내용은 확장 IndexedDB(메시지로 base64 전달).
 * 렌더러(render.js)는 state.prep(키 → 항목) / state.prepBusy / state.prepNote / state.prepDraft(적는 중인 청구내역) 를 읽는다.
 * 드롭 구역: data-prep-key 가 붙은 행(거래 행과 그 밑 준비 줄. data-prep-meta 에 거래 정보 JSON). select[data-prep-type] 청구종류, input[data-prep-ptcl] 청구내역(input 마다 state.prepDraft 에 보관, change 에 저장, Enter 저장·Esc 되돌림), data-act: prep-toggle(data-key=과제번호|card:…, 묶음의 요소 보이기/숨기기 → state.prepOpen) · prep-pick(data-key, 첨부 구역 클릭 → 파일 선택 창; 팝업은 창이 닫혀 버려 렌더러가 붙이지 않음) · prep-file-del(data-key/data-id) · prep-clear(data-key) · prep-run · prep-tab */
(function (g) {
  const F = g.KRX_FMT;
  const KEY = 'claimPrep';
  const MAX_FILE_MB = 15;   // 파일 하나 상한 (메시지로 base64 를 넘기므로 너무 큰 파일은 받지 않음)
  const DENY_EXT = new Set(['exe', 'bat', 'sh', 'java', 'jsp', 'htm', 'html', 'js', 'class', 'ini', 'php', 'jsv']);   // 파일등록 팝업이 무조건 거부하는 종류 (content/rnd-claim.js 와 동일)
  const extOf = (name) => { const s = String(name || ''); const i = s.lastIndexOf('.'); return i < 0 ? null : s.slice(i + 1).toLowerCase(); };

  /* 청구서 세목 빠른 선택 목록("표시이름=항목명=청구종류") → [{ label, kw, type }] (content/rnd-claim.js parsePicks 와 동일) */
  function parsePicks(list) {
    return (Array.isArray(list) ? list : String(list || '').split(/\r?\n/)).map((line) => {
      const s = String(line || '').trim();
      if (!s || s.startsWith('#')) return null;
      const parts = s.split('=').map((x) => x.trim());
      return parts[0] ? { label: parts[0], kw: parts[1] || parts[0], type: parts[2] || '' } : null;
    }).filter(Boolean);
  }
  const fmtSize = (n) => { n = Number(n) || 0; return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`; };

  async function load() { try { return (await chrome.storage.local.get(KEY))[KEY] || {}; } catch (e) { return {}; } }
  const send = (msg) => new Promise((res, rej) => {
    try { chrome.runtime.sendMessage(msg).then((r) => { if (r && r.error) rej(new Error(r.error)); else res(r); }, rej); }
    catch (e) { rej(e); }
  });
  const readB64 = (f) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
    fr.onerror = () => rej(fr.error || new Error('파일 읽기 실패'));
    fr.readAsDataURL(f);
  });
  const metaOf = (row) => { try { return JSON.parse((row && row.dataset.prepMeta) || '{}'); } catch (e) { return {}; } };

  /* 패널(host)에 위임 리스너를 붙인다. draw() 는 렌더러 호출. state.prep 은 미리 load() 로 채워 둔다 */
  function bind(host, state, draw) {
    if (!state.prep) state.prep = {};
    let noteTimer = 0;
    const note = (key, msg, err) => {
      state.prepNote = { key, msg, err: !!err }; draw();
      clearTimeout(noteTimer); noteTimer = setTimeout(() => { state.prepNote = null; draw(); }, err ? 8000 : 3500);
    };
    const apply = (key, r) => { if (r && r.entry) state.prep[key] = r.entry; else delete state.prep[key]; draw(); };
    const errMsg = (e) => { const m = String((e && e.message) || e); return /context invalidated/i.test(m) ? '확장 프로그램이 업데이트되었습니다. 페이지를 새로고침하세요' : m; };
    const hasFiles = (ev) => { try { return Array.from(ev.dataTransfer.types || []).includes('Files'); } catch (e) { return false; } };
    const rowOf = (ev) => (ev.target && ev.target.closest) ? ev.target.closest('[data-prep-key]') : null;
    const pair = (row) => { const k = row.dataset.prepKey; return Array.from(host.querySelectorAll('[data-prep-key]')).filter((r) => r.dataset.prepKey === k); };   // 거래 행 + 준비 줄
    const clearOver = () => { for (const r of host.querySelectorAll('.krext-prep-over')) r.classList.remove('krext-prep-over'); };

    /* 드래그 앤 드롭: 거래 행이나 준비 줄에 파일을 놓으면 저장. 패널 안 다른 곳에 놓아도 브라우저가 파일을 열며 화면을 떠나지 않게 기본 동작만 막는다 */
    host.addEventListener('dragover', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      const row = rowOf(ev);
      ev.dataTransfer.dropEffect = row ? 'copy' : 'none';
      if (row && !row.classList.contains('krext-prep-over')) { clearOver(); for (const r of pair(row)) r.classList.add('krext-prep-over'); }
      else if (!row) clearOver();
    });
    host.addEventListener('dragleave', (ev) => {
      const row = rowOf(ev); if (!row) return;
      const to = ev.relatedTarget;
      if (!to || !pair(row).some((r) => r.contains(to))) clearOver();
    });
    host.addEventListener('drop', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); ev.stopPropagation();
      clearOver();
      const row = rowOf(ev); if (!row) return;
      addFiles(row, Array.from(ev.dataTransfer.files || []));
    });
    /* 파일 선택 창: 첨부 구역(data-act prep-pick)을 클릭하면 숨은 input[type=file] 을 연다. 고른 파일은 끌어다 놓은 것과 같은 경로(addFiles)로 저장.
     * input 은 패널 밖(body)에 둔다 — 패널은 그릴 때마다 innerHTML 이 갈려서 안에 두면 사라진다 */
    let picker = null, pickKey = '';
    const openPicker = (key) => {
      if (!picker) {
        picker = document.createElement('input');
        picker.type = 'file'; picker.multiple = true; picker.style.display = 'none';
        picker.addEventListener('change', () => {
          const files = Array.from(picker.files || []);
          picker.value = '';
          const row = host.querySelector(`[data-prep-key="${CSS.escape(pickKey)}"]`);   // 선택하는 동안 다시 그려졌을 수 있어 키로 다시 찾는다
          if (row && files.length) addFiles(row, files);
        });
        document.body.appendChild(picker);
      }
      pickKey = key;
      picker.click();
    };
    async function addFiles(row, files) {
      const key = row.dataset.prepKey, meta = metaOf(row);
      const ok = [], bad = [];
      for (const f of files) {
        const ext = extOf(f.name);
        if (ext == null || DENY_EXT.has(ext)) bad.push(`${f.name} (첨부할 수 없는 종류)`);
        else if (f.size > MAX_FILE_MB * 1048576) bad.push(`${f.name} (${MAX_FILE_MB}MB 초과)`);
        else if (!f.size) bad.push(`${f.name} (빈 파일)`);
        else ok.push(f);
      }
      if (bad.length) note(key, `제외: ${bad.join(', ')}`, true);
      if (!ok.length) return;
      state.prepBusy = { key, done: 0, total: ok.length }; draw();
      try {
        for (const f of ok) {   // 한 파일씩 (메시지 크기)
          const b64 = await readB64(f);
          const r = await send({ type: 'prepAddFiles', key, meta, files: [{ name: f.name, mime: f.type || '', size: f.size, b64 }] });
          if (r && r.entry) state.prep[key] = r.entry;
          state.prepBusy.done++; draw();
        }
        state.prepBusy = null;
        note(key, `${ok.length}개 파일 저장됨`);
      } catch (e) { state.prepBusy = null; note(key, `파일 저장 실패: ${errMsg(e)}`, true); }
    }

    /* 청구종류 select */
    host.addEventListener('change', (ev) => {
      const el = ev.target; if (!el || !el.dataset || !el.dataset.prepType) return;
      const key = el.dataset.prepType;
      send({ type: 'prepSetType', key, meta: metaOf(el.closest('[data-prep-key]')), value: el.value })
        .then((r) => apply(key, r), (e) => note(key, `저장 실패: ${errMsg(e)}`, true));
    });
    /* 청구내역(적요) 입력란: 적는 동안은 state.prepDraft 에만 두고(다른 이유로 다시 그려져도 글이 남게. 저장·다시 그리기는 안 함), 칸을 벗어나거나 Enter 면(change) 저장. Esc 는 저장된 글로 되돌림.
     * 저장 중이면 "청구서 작성"이 그 저장을 기다린다(ptclSaving): 버튼을 누르면 blur → change → 저장이 먼저 시작되므로 옛 글로 작성되지 않게 */
    let ptclSaving = null;
    const savedPtcl = (key) => String(((state.prep || {})[key] || {}).ptcl || '');
    host.addEventListener('input', (ev) => {
      const el = ev.target; if (!el || !el.dataset || !el.dataset.prepPtcl) return;
      state.prepDraft = { key: el.dataset.prepPtcl, value: el.value };
    });
    host.addEventListener('change', (ev) => {
      const el = ev.target; if (!el || !el.dataset || !el.dataset.prepPtcl) return;
      const key = el.dataset.prepPtcl, value = el.value.trim();
      state.prepDraft = null;
      if (value === savedPtcl(key)) { draw(); return; }
      const p = send({ type: 'prepSetPtcl', key, meta: metaOf(el.closest('[data-prep-key]')), value })
        .then((r) => apply(key, r), (e) => note(key, `저장 실패: ${errMsg(e)}`, true))
        .finally(() => { if (ptclSaving === p) ptclSaving = null; });
      ptclSaving = p;
    });
    host.addEventListener('keydown', (ev) => {
      const el = ev.target; if (!el || !el.dataset || !el.dataset.prepPtcl) return;
      if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); el.value = savedPtcl(el.dataset.prepPtcl); state.prepDraft = null; el.blur(); }
    });
    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act^="prep-"]'); if (!btn) return;
      ev.preventDefault(); ev.stopPropagation();
      const act = btn.dataset.act, key = btn.dataset.key;
      if (act === 'prep-file-del') send({ type: 'prepRemoveFile', key, id: btn.dataset.id }).then((r) => apply(key, r), (e) => note(key, `삭제 실패: ${errMsg(e)}`, true));
      else if (act === 'prep-clear') send({ type: 'prepClear', key }).then(() => apply(key, null), (e) => note(key, `삭제 실패: ${errMsg(e)}`, true));
      else if (act === 'prep-run') {   // 백그라운드 탭에서 청구서 작성 (background.js prepRun → ERP 청구서의 rnd-claim.js). 진행 상태는 claimPrep[key].run 으로 돌아온다
        btn.disabled = true;
        Promise.resolve(ptclSaving).catch(() => {}).then(() => send({ type: 'prepRun', key })).then((r) => {
          if (r && r.ok) note(key, '백그라운드 탭에서 청구서를 작성하는 중…');
          else { btn.disabled = false; note(key, `작성 시작 실패: ${(r && r.error) || '응답 없음'}`, true); }
        }, (e) => { btn.disabled = false; note(key, `작성 시작 실패: ${errMsg(e)}`, true); });
      }
      else if (act === 'prep-pick') openPicker(key);   // 첨부 구역 클릭 → 파일 선택 창 (사용자 클릭 안에서 열어야 함)
      else if (act === 'prep-toggle') {   // 과제(카드) 줄 끝 청구 아이콘: 그 묶음 거래 행의 청구 준비 요소 보이기/숨기기. 켤 때 묶음이 접혀 있으면 펼친다
        if (!state.prepOpen) state.prepOpen = new Set();
        if (state.prepOpen.has(key)) state.prepOpen.delete(key);
        else { state.prepOpen.add(key); if (state.expanded && !state.expanded.has(key)) state.expanded.add(key); }
        draw();
      }
      else if (act === 'prep-tab') send({ type: 'prepFocusTab', key }).then((r) => { if (!(r && r.ok)) note(key, (r && r.error) || '탭을 찾지 못했습니다', true); }, (e) => note(key, errMsg(e), true));
    });
    // 다른 창(팝업 ↔ eClass)이나 ERP 청구서(첨부 완료 표시)에서 바뀐 값 반영
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        try { if (area === 'local' && ch[KEY]) { state.prep = ch[KEY].newValue || {}; draw(); } } catch (e) {}
      });
    } catch (e) {}
  }

  g.KRX_PREP = { KEY, MAX_FILE_MB, parsePicks, fmtSize, load, bind };
})(typeof self !== 'undefined' ? self : this);
