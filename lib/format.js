/* 공통 포맷 헬퍼 (서비스워커 / 콘텐츠스크립트 / 페이지 공용) */
(function (g) {
  const F = {};
  F.pad2 = (n) => String(n).padStart(2, '0');
  F.ymd = (d) => `${d.getFullYear()}${F.pad2(d.getMonth() + 1)}${F.pad2(d.getDate())}`;
  F.addMonths = (d, m) => { const x = new Date(d.getTime()); x.setMonth(x.getMonth() + m); return x; };
  F.digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  F.num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
  F.money = (v) => F.num(v).toLocaleString('ko-KR');
  F.fmtDate = (s) => { const d = F.digits(s); return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : String(s || ''); };
  F.fmtTime = (s) => { let d = F.digits(s); if (!d) return ''; d = d.padStart(6, '0').slice(0, 6); return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`; };
  /* yyyyMMdd + HHmmss → epoch ms (파싱 불가 시 NaN) */
  F.toTime = (ymd, hms) => {
    const d = F.digits(ymd), t = F.digits(hms).padStart(6, '0').slice(0, 6);
    if (d.length < 8) return NaN;
    return new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime();
  };
  F.fmtClock = (ts) => { const d = new Date(ts); return `${F.pad2(d.getMonth() + 1)}-${F.pad2(d.getDate())} ${F.pad2(d.getHours())}:${F.pad2(d.getMinutes())}`; };
  /* 카드번호 뒷 n자리 (기본 8자리, 4자리마다 하이픈) */
  F.cardTail = (cardNo, n) => {
    const d = F.digits(cardNo);
    const t = d.slice(-(n || 8));
    if (t.length <= 4) return t;
    return t.slice(0, t.length - 4) + '-' + t.slice(-4);
  };
  /* 설정의 카드 필터 목록과 일치하는지 (뒷자리 기준) */
  F.matchCard = (cardNo, list) => {
    const d = F.digits(cardNo);
    if (!d) return false;
    return (list || []).some((e) => { const x = F.digits(e); return x && d.endsWith(x); });
  };
  F.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  F.parseList = (text) => String(text || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  g.KRX_FMT = F;
})(typeof self !== 'undefined' ? self : this);
