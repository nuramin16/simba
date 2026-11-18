(function () {
'use strict';
/* =====================================================================
 * SIMBA — JavaScript.html  (SPA klien · Optimistic UI · Cache lokal)
 * - Navigasi 100% di sisi klien: tanpa reload, tanpa redirect, aman di iframe
 * - Semua data dimuat sekali (bootstrap) lalu disaring/dirender lokal (0 ms RTT)
 * - Penulisan: UI diperbarui dulu, server menyusul; gagal → otomatis dibatalkan
 * ===================================================================== */

/* ---------- 1. UTIL ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const z2 = n => ('0' + n).slice(-2);
const rp = n => { n = Math.round(Number(n) || 0); return (n < 0 ? '-' : '') + 'Rp ' + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate()); };
const tgl = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? (+m[3]) + ' ' + BLN[+m[2] - 1] + ' ' + m[1] : '–'; };
const uid = p => p + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const ic = (n, c) => '<span class="mi' + (c ? ' ' + c : '') + '" aria-hidden="true">' + n + '</span>';
const ini = s => String(s || '?').replace(/^(Bpk\.|Ibu|H\.|Hj\.)\s*/i, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const chip = (t, x) => '<span class="chip c-' + t + '">' + esc(x) + '</span>';
const byName = (a, b) => String(a.nama_kk).localeCompare(String(b.nama_kk));
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* ---------- 2. STATE & PENYIMPANAN ---------- */
const S = { token: null, user: null, perm: {}, pubPerm: {}, d: {}, ringkasan: null, cfg: {}, page: 'beranda', ui: {}, pending: 0, cf: null, prompt: false, blobUrl: null };
const IDX = { kk: {}, per: {} };
const KEY = { DaftarKK: 'kk', Pengurus: 'pengurus', Informasi: 'informasi', TeleponDarurat: 'darurat', PeriodeIuran: 'periode', IuranJimpitan: 'jimpitan', IuranAgustusan: 'agustusan', KasRT: 'kas', Notulensi: 'notulensi', InfoPertemuan: 'pertemuan', UsulanFasilitas: 'usulan' };
const IDF = { DaftarKK: 'id_kk', PeriodeIuran: 'id_periode' };
const mem = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* diabaikan */ } delete mem[k]; }
};
const ses = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return mem['s' + k] || null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { mem['s' + k] = v; } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* diabaikan */ } delete mem['s' + k]; }
};
const tokS = {
  get() { return store.get('simba.tok') || ses.get('simba.tok'); },
  del() { store.del('simba.tok'); ses.del('simba.tok'); },
  set(t, rem) { this.del(); (rem ? store : ses).set('simba.tok', t); }
};
let persistT = null;
function persist() {
  clearTimeout(persistT);
  persistT = setTimeout(() => {
    try { store.set('simba.boot', JSON.stringify({ user: S.user, perm: S.perm, pubPerm: S.pubPerm, d: S.d, ringkasan: S.ringkasan, cfg: S.cfg })); } catch (e) { /* kuota penuh: abaikan */ }
  }, 400);
}
const U = p => { p = p || S.page; return S.ui[p] || (S.ui[p] = {}); };
const can = (m, a) => (S.perm[m] || '').indexOf(a) > -1;

/* ---------- 3. PANGGILAN SERVER ---------- */
const GAS_URL = (window.SIMBA_CONFIG || {}).GAS_URL;
const _inflight = {};
/** Panggilan ke REST API GAS. Argumen pertama setelah nama aksi biasanya token sesi. */
function srv(fn) {
  const args = Array.prototype.slice.call(arguments, 1);
  if (!GAS_URL || /GANTI_/.test(GAS_URL)) return Promise.reject(new Error('GAS_URL belum diisi di js/config.js.'));
  const baca = fn === 'bootstrap' || fn === 'crmMuat';
  const key = baca ? fn + '|' + JSON.stringify(args) : null;
  if (key && _inflight[key]) return _inflight[key];   // permintaan kembar menumpang promise yang sama
  const kirim = (n) => {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 45000);
    // ATURAN CORS GAS: wajib text/plain agar tidak memicu preflight OPTIONS
    let req;
    if (fn === 'bootstrap' && n === 0 && window.__boot && (window.__bootKey || null) === (args[0] || null)) {   // unduhan sudah berjalan sejak <head>
      req = Promise.race([window.__boot, new Promise((_, no) => ctl.signal.addEventListener('abort', () => no(Object.assign(new Error('abort'), { name: 'AbortError' }))))]); window.__boot = null;
    } else req = fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: fn, args: args }), signal: ctl.signal, redirect: 'follow' }).then(r => r.json());
    return req
      .then(x => { if (x && x.ok) return x.data; throw new Error((x && x.msg) || 'Gagal memproses permintaan.'); })
      .catch(e => {
        if (e && e.name === 'AbortError') e = new Error('Server lambat merespons. Coba lagi.');
        else if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(e.message)) { if (baca && n < 2) return kirim(n + 1); e = new Error('Koneksi gagal. Periksa jaringan Anda.'); }
        throw e;
      })
      .finally(() => clearTimeout(to));
  };
  const p = kirim(0);
  if (key) { _inflight[key] = p; p.then(() => { delete _inflight[key]; }, () => { delete _inflight[key]; }); }
  return p;
}

/* ---------- 4. DATA TURUNAN ---------- */
function rebuild() {
  IDX.kk = {}; (S.d.kk || []).forEach(k => IDX.kk[k.id_kk] = k);
  IDX.per = {}; (S.d.periode || []).forEach(p => IDX.per[p.id_periode] = p);
}
const kkNama = id => (IDX.kk[id] || {}).nama_kk || '(KK dihapus)';
function periodeAktif(jenis) {
  const ps = (S.d.periode || []).filter(p => p.jenis === jenis);
  if (!ps.length) return null;
  const b = ps.filter(p => p.status === 'Buka'), pool = (b.length ? b : ps).slice().sort((a, c) => String(c.tanggal_mulai).localeCompare(String(a.tanggal_mulai)));
  return pool[0];
}
function ringk(key, jenis, kkA) {
  const per = periodeAktif(jenis); if (!per) return null;
  const paid = {}; let total = 0;
  (S.d[key] || []).forEach(r => { if (r.id_periode === per.id_periode) { paid[r.id_kk] = 1; total += r.jumlah; } });
  const bayar = kkA.filter(k => paid[k.id_kk]).length;
  return { id: per.id_periode, label: per.label, total: total, bayar: bayar, belum: kkA.length - bayar, nominal: per.nominal || 0, status: per.status };
}
function kasSorted() {
  return (S.d.kas || []).map((r, i) => ({ r: r, i: i })).sort((a, b) => a.r.tanggal < b.r.tanggal ? -1 : a.r.tanggal > b.r.tanggal ? 1 : a.i - b.i).map(x => x.r);
}
function recalcKas() { let s = 0; kasSorted().forEach(r => { s += r.jenis === 'Masuk' ? r.jumlah : -r.jumlah; r.saldo_setelah = s; }); return s; }
function hitung() {
  if (!S.user) return S.ringkasan || { saldo: 0, masukBulan: 0, keluarBulan: 0, kasAgustusan: 0, kkAktif: 0, jimpitan: null, agustusan: null, tx: [] };
  const kkA = (S.d.kk || []).filter(k => k.status === 'Aktif'), bulan = today().slice(0, 7), ks = kasSorted();
  let saldo = 0, masuk = 0, keluar = 0, ags = 0;
  ks.forEach(r => { const m = r.jenis === 'Masuk'; saldo += m ? r.jumlah : -r.jumlah; r.saldo_setelah = saldo; if (String(r.tanggal).slice(0, 7) === bulan) { if (m) masuk += r.jumlah; else keluar += r.jumlah; } });
  (S.d.agustusan || []).forEach(r => ags += r.jumlah);
  return { saldo: saldo, masukBulan: masuk, keluarBulan: keluar, kasAgustusan: ags, kkAktif: kkA.length, jimpitan: ringk('jimpitan', 'Jimpitan', kkA), agustusan: ringk('agustusan', 'Agustusan', kkA), tx: ks.slice(-5).reverse() };
}
function nextMeet() {
  const l = (S.d.pertemuan || []).slice().sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal))), t = today();
  return l.find(x => x.tanggal >= t) || l[l.length - 1] || null;
}

/* ---------- 5. KOMPONEN UI DASAR ---------- */
function toast(m, t) {
  const r = $('#toastRoot'), e = document.createElement('div');
  e.className = 'toast t-' + (t || 'ok');
  e.innerHTML = ic(t === 'err' ? 'error' : t === 'warn' ? 'info' : 'check_circle') + '<span>' + esc(m) + '</span>';
  r.appendChild(e);
  setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 300); }, t === 'err' ? 5200 : 2800);
}
function openModal(inner, cls) {
  $('#modalRoot').innerHTML = '<div class="mback" data-act="mback"><div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + inner + '</div></div>';
  document.body.classList.add('noscroll');
}
function closeModal() {
  $('#modalRoot').innerHTML = '';
  document.body.classList.remove('noscroll'); S.kkOpen = null;
  if (S.blobUrl) { URL.revokeObjectURL(S.blobUrl); S.blobUrl = null; }
  if (S.cf) { const f = S.cf; S.cf = null; f(false); }
}
function askConfirm(msg, o) {
  o = o || {};
  return new Promise(res => {
    S.cf = res;
    openModal('<div class="mh"><h3>' + esc(o.title || 'Konfirmasi') + '</h3></div><div class="mb"><p>' + esc(msg) + '</p><div class="mact"><button type="button" class="btn btn-soft" data-act="cfNo">Batal</button><button type="button" class="btn ' + (o.danger ? 'btn-danger' : 'btn-pri') + '" data-act="cfYes">' + esc(o.ok || 'Ya, lanjutkan') + '</button></div></div>', 'sm');
  });
}
function fieldHTML(f, v) {
  const id = 'f_' + f.k, val = v != null && v !== '' ? v : (f.def != null ? f.def : ''), req = f.req ? ' required' : '';
  let inp;
  if (f.type === 'select') {
    inp = '<select id="' + id + '" name="' + f.k + '"' + req + '>' + (f.opts || []).map(o => { const a = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(a[0]) + '"' + (String(a[0]) === String(val) ? ' selected' : '') + '>' + esc(a[1]) + '</option>'; }).join('') + '</select>';
  } else if (f.type === 'textarea') {
    inp = '<textarea id="' + id + '" name="' + f.k + '" rows="' + (f.rows || 4) + '" maxlength="3500"' + req + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + '>' + esc(val) + '</textarea>';
  } else if (f.type === 'file') {
    inp = '<input type="file" id="' + id + '" name="' + f.k + '" accept="' + (f.accept || '') + '">';
  } else if (f.type === 'checkbox') {
    return '<div class="field"><label class="chk"><input type="checkbox" id="' + id + '" name="' + f.k + '"' + (val === '1' || val === true ? ' checked' : '') + '><span>' + esc(f.l) + '</span></label></div>';
  } else {
    inp = '<input id="' + id + '" name="' + f.k + '" type="' + (f.type || 'text') + '" value="' + esc(val) + '"' + req + (f.type === 'number' ? ' inputmode="numeric" min="' + (f.min == null ? 0 : f.min) + '" step="any"' : '') + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + ' autocomplete="off">';
  }
  return '<div class="field"><label for="' + id + '">' + esc(f.l) + (f.req ? ' <i class="rq">*</i>' : '') + '</label>' + inp + (f.help ? '<div class="help">' + esc(f.help) + '</div>' : '') + '<div class="err" data-err="' + f.k + '"></div></div>';
}
function formModal(o) {
  openModal('<div class="mh"><h3>' + esc(o.title) + '</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><form id="mform" class="mb" novalidate>' +
    (o.note ? '<p class="help note">' + esc(o.note) + '</p>' : '') + o.fields.map(f => fieldHTML(f, (o.values || {})[f.k])).join('') +
    '<div class="mact"><button type="button" class="btn btn-soft" data-act="mclose">Batal</button><button type="submit" class="btn btn-pri">' + esc(o.submit || 'Simpan') + '</button></div></form>', o.cls || '');
  const form = $('#mform');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = {}; let bad = false;
    o.fields.forEach(f => {
      const el = form.elements[f.k]; if (!el) return;
      let x = f.type === 'checkbox' ? (el.checked ? '1' : '') : f.type === 'file' ? (el.files && el.files[0]) : String(el.value).trim();
      const er = $('[data-err="' + f.k + '"]', form); let msg = '';
      if (f.req && (x === '' || x == null)) msg = 'Wajib diisi.';
      else if (f.type === 'number' && x !== '') { const n = Number(x); if (isNaN(n)) msg = 'Harus berupa angka.'; else if (n < (f.min == null ? 0 : f.min)) msg = 'Minimal ' + (f.min == null ? 0 : f.min) + '.'; x = n; }
      if (er) er.textContent = msg;
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) bad = true; v[f.k] = x;
    });
    if (bad) { const first = $('[aria-invalid=true]', form); if (first) first.focus(); return; }
    closeModal();
    try { await o.onSubmit(v); } catch (er) { toast(er.message, 'err'); }
  });
  setTimeout(() => { const f = $('input:not([type=hidden]):not([type=checkbox]),select,textarea', form); if (f) f.focus(); }, 80);
}
function b64blob(b64, mime) { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime }); }
function showFile(r) {
  const url = URL.createObjectURL(b64blob(r.b64, r.mime)), img = /^image\//.test(r.mime);
  openModal('<div class="mh"><h3>' + esc(r.nama) + '</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><div class="mb"><div class="viewer">' + (img ? '<img alt="Bukti" src="' + url + '">' : '<iframe title="Pratinjau berkas" src="' + url + '"></iframe>') + '</div><div class="mact"><a class="btn btn-pri" href="' + url + '" download="' + esc(r.nama) + '">' + ic('download') + 'Unduh</a></div></div>', 'lg');
  S.blobUrl = url;
}
async function pdf(jenis, p) {
  toast('Menyiapkan PDF…', 'warn');
  try { showFile(await srv('cetakPdf', S.token || null, jenis, p || {})); } catch (e) { toast(e.message, 'err'); }
}
function fileB64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    if (/^image\//.test(file.type)) {
      fr.onload = () => {
        const im = new Image();
        im.onload = () => { const s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res({ mime: 'image/jpeg', b64: c.toDataURL('image/jpeg', 0.8).split(',')[1], nama: file.name.replace(/\.\w+$/, '') + '.jpg' }); };
        im.onerror = () => rej(new Error('Gambar tidak dapat dibaca.')); im.src = fr.result;
      };
    } else if (file.type === 'application/pdf') {
      if (file.size > 5 * 1024 * 1024) return rej(new Error('Ukuran berkas melebihi 5 MB.'));
      fr.onload = () => res({ mime: 'application/pdf', b64: String(fr.result).split(',')[1], nama: file.name });
    } else return rej(new Error('Hanya berkas jpg, png atau pdf.'));
    fr.onerror = () => rej(new Error('Berkas tidak dapat dibaca.')); fr.readAsDataURL(file);
  });
}

/* ---------- 6. MUTASI OPTIMISTIS (UI dulu, server menyusul) ---------- */
let Q = Promise.resolve();
function sync(fn) {
  S.pending++; pend();
  Q = Q.then(fn).catch(() => { }).then(() => { S.pending--; pend(); });
  return Q;
}
function pend() { const e = $('#sync'); if (e) e.classList.toggle('on', S.pending > 0); }
function soft() { const y = window.scrollY; renderChrome(); renderPage(); window.scrollTo(0, y); }
function after(tabel) { rebuild(); if (tabel === 'KasRT' || tabel === 'IuranAgustusan') recalcKas(); soft(); persist(); }
function mutate(tabel, op, rec, opt) {
  opt = opt || {};
  const key = KEY[tabel], idf = IDF[tabel] || 'id', A = () => (S.d[key] || (S.d[key] = []));
  const i = A().findIndex(x => x[idf] === rec[idf]); let prev = null;
  if (op === 'add') { if (i < 0) A().push(Object.assign({}, rec)); }
  else if (op === 'upd' && i >= 0) { prev = Object.assign({}, A()[i]); Object.assign(A()[i], rec); }
  else if (op === 'del' && i >= 0) { prev = A()[i]; A().splice(i, 1); }
  after(tabel);
  const rollback = () => {
    const j = A().findIndex(x => x[idf] === rec[idf]);
    if (op === 'add') { if (j >= 0) A().splice(j, 1); } else if (op === 'upd') { if (j >= 0 && prev) A()[j] = prev; } else if (prev) A().push(prev);
    after(tabel);
  };
  return sync(async () => {
    try {
      const r = await srv('simpan', S.token, tabel, op, Object.assign({}, rec, opt.force ? { _force: true } : {}));
      if (r.dup) { rollback(); if (await askConfirm('Catatan untuk KK dan periode ini sudah ada. Tetap catat lagi?')) mutate(tabel, op, rec, { force: true }); return; }
      if (r.kas) S.d.kas = r.kas;
      if (r.rec && op !== 'del') { const j = A().findIndex(x => x[idf] === r.rec[idf]); if (j >= 0) Object.assign(A()[j], r.rec); }
      after(tabel);
    } catch (e) { rollback(); toast(e.message, 'err'); if (/sesi/i.test(e.message)) sesiHabis(); }
  });
}

/* ---------- 7. KONFIGURASI CRUD GENERIK ---------- */
const CRUD = {
  kk: {
    tabel: 'DaftarKK', key: 'kk', mod: 'kk', pre: 'KK', idf: 'id_kk', judul: 'Kepala Keluarga', q: ['nama_kk', 'no_wa'], filter: { k: 'status', l: 'status', opts: ['Aktif', 'Nonaktif'] },
    sort: (a, b) => (a.urutan || 1e9) - (b.urutan || 1e9) || byName(a, b),
    hint: 'Geser baris lewat ikon ⋮⋮ (komputer), tekan tombol ▲ ▼, atau klik nomor untuk memindahkannya ke nomor lain.',
    rowAttr: r => canReorder() ? ' draggable="true" data-kkid="' + esc(r.id_kk) + '"' : '',
    cols: [['no', 'No', r => { const n = RANK[r.id_kk] || '–'; return can('kk', 'U') ? '<button type="button" class="nobadge" data-act="kkNo" data-id="' + esc(r.id_kk) + '" title="Klik untuk memindahkan ke nomor lain" aria-label="Nomor ' + n + ', klik untuk memindahkan">' + (canReorder() ? ic('drag_indicator') : '') + n + '</button>' : '<span class="nobadge">' + n + '</span>'; }],
      ['nama_kk', 'Nama Kepala Keluarga', r => '<div class="tdn"><span class="avatar">' + ini(r.nama_kk) + '</span><b>' + esc(r.nama_kk) + '</b>' + (S.user && S.user.id_kk === r.id_kk ? chip('info', 'KK Anda') : '') + (r.status !== 'Aktif' ? chip('mute', r.status) : '') + '</div>'],
      ['jumlah_keluarga', 'Anggota', r => r.jumlah_keluarga ? r.jumlah_keluarga + ' jiwa' : '–'], ['no_wa', 'No. WhatsApp', r => esc(r.no_wa || '–')]],
    extra: [
      { act: 'kkDetail', ic: 'groups', t: 'Detail & anggota keluarga', need: 'L', row: r => can('kk', 'U') || (S.user && S.user.id_kk === r.id_kk) },
      { act: 'kkUp', ic: 'keyboard_arrow_up', t: 'Naikkan nomor', need: 'U', cond: () => canReorder() },
      { act: 'kkDown', ic: 'keyboard_arrow_down', t: 'Turunkan nomor', need: 'U', cond: () => canReorder() }],
    fields: [{ k: 'nama_kk', l: 'Nama Kepala Keluarga', req: 1 }, { k: 'jumlah_keluarga', l: 'Jumlah anggota keluarga (opsional)', type: 'number', min: 0, help: 'Terisi otomatis bila anggota keluarga dicatat.' }, { k: 'no_wa', l: 'No. WhatsApp (opsional)', type: 'tel', ph: '08xxxxxxxxxx' }, { k: 'status', l: 'Status', type: 'select', opts: ['Aktif', 'Nonaktif'] }]
  },
  pengurus: {
    tabel: 'Pengurus', key: 'pengurus', mod: 'pengurus', pre: 'PGR', judul: 'Pengurus', q: ['jabatan', 'nama'], sort: (a, b) => a.urutan - b.urutan,
    cols: [['urutan', 'No'], ['jabatan', 'Jabatan'], ['nama', 'Nama'], ['no_hp', 'No. HP', r => esc(r.no_hp || '–')]],
    fields: [{ k: 'jabatan', l: 'Jabatan', req: 1 }, { k: 'nama', l: 'Nama', req: 1 }, { k: 'no_hp', l: 'No. HP (opsional)', type: 'tel' }, { k: 'urutan', l: 'Urutan tampil', type: 'number', min: 0 }]
  },
  informasi: {
    tabel: 'Informasi', key: 'informasi', mod: 'informasi', pre: 'INF', judul: 'Informasi', q: ['judul', 'isi'], sort: (a, b) => String(b.tanggal).localeCompare(String(a.tanggal)),
    cols: [['tanggal', 'Tanggal', r => tgl(r.tanggal)], ['judul', 'Judul', r => '<b>' + esc(r.judul) + '</b>'], ['isi', 'Isi', r => esc(trunc(r.isi, 160))]],
    fields: [{ k: 'judul', l: 'Judul', req: 1 }, { k: 'isi', l: 'Isi informasi', type: 'textarea', req: 1, rows: 6 }, { k: 'tanggal', l: 'Tanggal', type: 'date', def: today() }]
  },
  darurat: {
    tabel: 'TeleponDarurat', key: 'darurat', mod: 'darurat', pre: 'TLP', judul: 'Nomor Darurat', q: ['nama_layanan', 'nomor'], sort: (a, b) => a.urutan - b.urutan,
    cols: [['nama_layanan', 'Layanan', r => '<b>' + esc(r.nama_layanan) + '</b>'], ['nomor', 'Nomor 1', r => '<a class="lnk" href="tel:' + esc(r.nomor) + '">' + esc(r.nomor) + '</a>'], ['keterangan', 'Ket. Nomor 1', r => esc(r.keterangan || '–')], ['nomor2', 'Nomor 2', r => r.nomor2 ? '<a class="lnk" href="tel:' + esc(r.nomor2) + '">' + esc(r.nomor2) + '</a>' : '–'], ['keterangan2', 'Ket. Nomor 2', r => esc(r.keterangan2 || '–')]],
    fields: [{ k: 'nama_layanan', l: 'Nama layanan', req: 1 }, { k: 'nomor', l: 'Nomor telepon 1', type: 'tel', req: 1 }, { k: 'keterangan', l: 'Keterangan Nomor 1 (opsional)', ph: 'mis. Pak Slamet, narahubung jaga malam' }, { k: 'nomor2', l: 'Nomor telepon 2 (opsional)', type: 'tel', help: 'Isi bila layanan memiliki lebih dari satu nomor.' }, { k: 'keterangan2', l: 'Keterangan Nomor 2 (opsional)', ph: 'mis. Bu Rina, narahubung cadangan' }, { k: 'urutan', l: 'Urutan tampil', type: 'number', min: 0 }]
  },
  pertemuan: {
    tabel: 'InfoPertemuan', key: 'pertemuan', mod: 'pertemuan', pre: 'PRT', judul: 'Info Pertemuan', q: ['tempat', 'agenda'], sort: (a, b) => String(b.tanggal).localeCompare(String(a.tanggal)),
    cols: [['tanggal', 'Tanggal', r => tgl(r.tanggal)], ['jam', 'Jam'], ['tempat', 'Tempat'], ['agenda', 'Agenda', r => esc(trunc(r.agenda, 120))]],
    fields: [{ k: 'tanggal', l: 'Tanggal pertemuan', type: 'date', req: 1, def: today() }, { k: 'jam', l: 'Jam', ph: '19.30' }, { k: 'tempat', l: 'Tempat' }, { k: 'agenda', l: 'Agenda', type: 'textarea' }]
  },
  periode: {
    tabel: 'PeriodeIuran', key: 'periode', mod: 'periode', pre: 'PRD', idf: 'id_periode', judul: 'Periode Iuran', q: ['label', 'jenis'], filter: { k: 'status', l: 'status', opts: ['Buka', 'Tutup'] },
    sort: (a, b) => String(b.tanggal_mulai).localeCompare(String(a.tanggal_mulai)),
    cols: [['jenis', 'Jenis', r => chip(r.jenis === 'Jimpitan' ? 'info' : 'warn', r.jenis)], ['label', 'Label', r => '<b>' + esc(r.label) + '</b>'], ['tanggal_mulai', 'Rentang', r => tgl(r.tanggal_mulai) + ' – ' + tgl(r.tanggal_selesai)], ['nominal', 'Nominal', r => r.nominal ? rp(r.nominal) : '–'], ['status', 'Status', r => chip(r.status === 'Buka' ? 'ok' : 'mute', r.status)]],
    extra: [{ act: 'perToggle', ic: 'lock', t: 'Tutup / buka periode', need: 'U' }],
    fields: [{ k: 'jenis', l: 'Jenis iuran', type: 'select', opts: ['Jimpitan', 'Agustusan'], req: 1 }, { k: 'label', l: 'Label periode', req: 1, ph: 'Jimpitan November 2026' }, { k: 'tanggal_mulai', l: 'Tanggal mulai', type: 'date', def: today() }, { k: 'tanggal_selesai', l: 'Tanggal selesai', type: 'date' }, { k: 'nominal', l: 'Nominal per KK (opsional)', type: 'number', min: 0 }, { k: 'status', l: 'Status', type: 'select', opts: ['Buka', 'Tutup'] }]
  }
};
let RANK = {};
const kkOrdered = () => (S.d.kk || []).slice().sort(CRUD.kk.sort);
const canReorder = () => can('kk', 'U') && !(U('kk').q) && !(U('kk').status);
function crudRows(n) {
  if (n === 'kk') { RANK = {}; kkOrdered().forEach((k, i) => { RANK[k.id_kk] = i + 1; }); }
  const c = CRUD[n], u = U(), q = String(u.q || '').toLowerCase(), f = c.filter;
  let rows = (S.d[c.key] || []).slice();
  if (q) rows = rows.filter(r => c.q.some(k => String(r[k] || '').toLowerCase().indexOf(q) > -1));
  if (f && u[f.k]) rows = rows.filter(r => r[f.k] === u[f.k]);
  return rows.sort(c.sort);
}
function empty(icn, t, s) { return '<div class="empty">' + ic(icn) + '<b>' + esc(t) + '</b>' + (s ? '<span>' + esc(s) + '</span>' : '') + '</div>'; }
function crudList(n) {
  const c = CRUD[n], rows = crudRows(n), idf = c.idf || 'id';
  if (!rows.length) return empty('search_off', 'Belum ada data', 'Data akan tampil di sini.');
  const aksi = can(c.mod, 'U') || can(c.mod, 'H') || (c.extra || []).some(e => can(c.mod, e.need));
  return '<div class="tblwrap"><table class="tbl"><thead><tr>' + c.cols.map(x => '<th' + (x[0] === 'no' ? ' class="no"' : '') + '>' + esc(x[1]) + '</th>').join('') + (aksi ? '<th class="ta-r">Aksi</th>' : '') + '</tr></thead><tbody>' +
    rows.map(r => '<tr' + (c.rowAttr ? c.rowAttr(r) : '') + '>' + c.cols.map(x => '<td' + (x[0] === 'no' ? ' class="no"' : '') + ' data-label="' + esc(x[1]) + '">' + (x[2] ? x[2](r) : esc(r[x[0]] == null || r[x[0]] === '' ? '–' : r[x[0]])) + '</td>').join('') +
      (aksi ? '<td class="ta-r nolabel"><div class="rowact">' +
        (c.extra || []).filter(e => can(c.mod, e.need) && (!e.cond || e.cond()) && (!e.row || e.row(r))).map(e => '<button type="button" class="iconbtn sm" data-act="' + e.act + '" data-n="' + n + '" data-id="' + esc(r[idf]) + '" title="' + esc(e.t) + '" aria-label="' + esc(e.t) + '">' + ic(e.ic) + '</button>').join('') +
        (can(c.mod, 'U') ? '<button type="button" class="iconbtn sm" data-act="crudEdit" data-n="' + n + '" data-id="' + esc(r[idf]) + '" title="Ubah" aria-label="Ubah">' + ic('edit') + '</button>' : '') +
        (can(c.mod, 'H') ? '<button type="button" class="iconbtn sm danger" data-act="crudDel" data-n="' + n + '" data-id="' + esc(r[idf]) + '" title="Hapus" aria-label="Hapus">' + ic('delete') + '</button>' : '') +
        '</div></td>' : '') + '</tr>').join('') + '</tbody></table></div>';
}
function crudView(n) {
  const c = CRUD[n], u = U(), f = c.filter;
  return '<div class="toolbar"><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari ' + esc(c.judul.toLowerCase()) + '…" aria-label="Cari"></div>' +
    (f ? '<select class="sel" data-f="' + f.k + '" aria-label="Filter ' + f.l + '"><option value="">Semua ' + f.l + '</option>' + f.opts.map(o => '<option value="' + o + '"' + (u[f.k] === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>' : '') +
    (can(c.mod, 'T') ? '<button type="button" class="btn btn-pri" data-act="crudAdd" data-n="' + n + '">' + ic('add') + 'Tambah</button>' : '') +
    '</div>' + (c.hint && can(c.mod, 'U') ? '<div class="hint" style="margin-bottom:12px">' + ic('info') + '<span>' + c.hint + '</span></div>' : '') + '<div class="card flush" id="lst">' + crudList(n) + '</div>';
}
function crudForm(n, rec) {
  const c = CRUD[n], idf = c.idf || 'id';
  const vals = rec || Object.assign({ status: c.fields.some(f => f.k === 'status') ? c.fields.find(f => f.k === 'status').opts[0] : undefined }, n === 'pengurus' || n === 'darurat' ? { urutan: (S.d[c.key] || []).length + 1 } : {});
  formModal({
    title: (rec ? 'Ubah ' : 'Tambah ') + c.judul, fields: c.fields, values: vals,
    onSubmit: async v => { if (rec) { const o = {}; o[idf] = rec[idf]; mutate(c.tabel, 'upd', Object.assign(o, v)); } else { const o = {}; o[idf] = uid(c.pre); mutate(c.tabel, 'add', Object.assign(o, v)); } }
  });
}

/* ---------- 8. KOMPONEN KARTU BERANDA ---------- */
function saldoCard(R) {
  return '<div class="balance"><div class="balrow"><div class="bal-l"><span>Saldo Kas RT</span>' + ic('account_balance') + '</div><div class="bal-v">' + rp(R.saldo) + '</div><span class="bchip">+' + rp(R.masukBulan) + ' masuk bulan ini</span></div>' +
    '<div class="balrow sec2"><div class="bal-l"><span>Kas Agustusan</span>' + ic('flag') + '</div><div class="bal-v">' + rp(R.kasAgustusan) + '</div><span class="bchip">Terkumpul semua periode</span></div></div>';
}
function aksiBtns() {
  return '<div class="aksi"><button type="button" class="btn btn-cyan" data-act="pdfKas">' + ic('picture_as_pdf') + (S.user ? 'Cetak PDF' : 'Cetak Rekap') + '</button>' +
    (can('undian', 'T') ? '<button type="button" class="btn btn-pri" data-act="go" data-p="undian">' + ic('shuffle') + 'Kocok Undian</button>' : '') + '</div>';
}
function txCard(R) {
  const tx = R.tx || [];
  return '<section class="card"><div class="card-h"><h3>Transaksi Kas Terbaru</h3><button type="button" class="lnk" data-act="go" data-p="kas">Semua</button></div>' +
    (tx.length ? '<ul class="txl">' + tx.map(t => { const m = t.jenis === 'Masuk'; return '<li class="tx"><span class="tx-ic ' + (m ? 'in' : 'out') + '">' + ic(m ? 'arrow_downward' : 'arrow_upward') + '</span><div class="tx-b"><b>' + esc(trunc(t.keterangan, 34)) + '</b><span>' + tgl(t.tanggal) + '</span></div><span class="amt ' + (m ? 'in' : 'out') + '">' + (m ? '+' : '-') + rp(t.jumlah) + '</span></li>'; }).join('') + '</ul>' : empty('receipt_long', 'Belum ada transaksi')) + '</section>';
}
function pertemuanCard() {
  const m = nextMeet();
  return '<div class="agenda"><div class="ag-l">' + ic('event') + 'Pertemuan RT Berikutnya</div>' + (m ? '<div class="ag-d">' + tgl(m.tanggal) + '</div><div class="ag-s">' + esc((m.jam ? m.jam + ' WIB' : '') + (m.tempat ? ' • ' + m.tempat : '')) + '</div><button type="button" class="btn btn-cyan btn-block" data-act="agenda">Lihat Agenda</button>' : '<div class="ag-s">Belum ada jadwal pertemuan.</div>') + '</div>';
}
function kpi(icn, tone, l, v, f) { return '<div class="kpi"><span class="kpi-ic t-' + tone + '">' + ic(icn) + '</span><div class="kpi-l">' + esc(l) + '</div><div class="kpi-v">' + v + '</div><div class="kpi-f">' + f + '</div></div>'; }
const ROLE_LBL = { warga: 'Warga', bendahara: 'Bendahara', sekretaris: 'Sekretaris', pengurus: 'Pengurus', admin: 'Administrator' };
const isAdmin = () => !!(S.user && (S.user.role === 'admin' || S.user.role === 'pengurus'));
function kpis(R) {
  const j = R.jimpitan, a = R.agustusan;
  return kpi('payments', 'blue', 'Jimpitan periode ini', j ? rp(j.total) : '–', j ? esc(j.label) : 'Belum ada periode') +
    kpi('flag', 'cyan', 'Agustusan periode ini', a ? rp(a.total) : '–', a ? esc(a.label) : 'Belum ada periode') +
    (isAdmin() ? kpi('check_circle', 'green', 'KK sudah membayar', j ? j.bayar + ' KK' : '–', j ? 'dari ' + R.kkAktif + ' KK aktif (Jimpitan)' : '&nbsp;') +
    kpi('pending_actions', 'amber', 'KK belum membayar', j ? '<span class="neg">' + j.belum + ' KK</span>' : '–', j ? 'Jimpitan ' + esc(j.label) : '&nbsp;') : '');
}
function resetBanner() {
  const n = isAdmin() ? (S.d.reset || []).length : 0; if (!n) return '';
  return '<div class="insight warn">' + ic('key') + '<span><b>' + n + ' permintaan reset sandi</b> menunggu. <button type="button" class="linkbtn" data-act="resetBuka">Buka</button></span></div>';
}
function insight(R) {
  const j = R.jimpitan; if (!isAdmin() || !j || !R.kkAktif) return '';
  const pct = Math.round(j.bayar / R.kkAktif * 100);
  return '<div class="insight">' + ic('lightbulb') + '<span><b>Sorotan:</b> ' + esc(j.label) + ' — ' + j.bayar + ' dari ' + R.kkAktif + ' KK sudah membayar (' + pct + '%)' + (j.belum ? ', ' + j.belum + ' KK belum.' : '. Semua KK sudah lunas.') + '</span></div>';
}
function banner() {
  return '<section class="banner"><div class="bn-t"><span class="eyebrow-w">Sistem Informasi Warga</span><h2>Sistem Informasi dan Manajemen Warga RT.06 RW.01 Bangsri</h2><p>Pantau saldo kas, iuran Jimpitan dan Agustusan, agenda pertemuan, serta notulensi secara terbuka dan tertib.</p><div class="bn-a"><button type="button" class="btn btn-cyan" data-act="go" data-p="notulensi">Lihat Notulensi Terbaru ' + ic('arrow_forward') + '</button></div></div>' +
    '<svg class="bn-art" viewBox="0 0 220 160" aria-hidden="true"><defs><linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fd8ff"/><stop offset="1" stop-color="#e9f4ff"/></linearGradient></defs><rect x="14" y="96" width="192" height="12" rx="6" fill="rgba(255,255,255,.25)"/><rect x="48" y="44" width="92" height="64" rx="10" fill="url(#gA)"/><path d="M40 52 94 14l54 38z" fill="#fff" opacity=".95"/><rect x="84" y="70" width="22" height="38" rx="4" class="a1"/><rect x="58" y="62" width="16" height="16" rx="3" class="a1" opacity=".45"/><rect x="116" y="62" width="16" height="16" rx="3" class="a1" opacity=".45"/><rect x="132" y="84" width="64" height="46" rx="8" fill="#fff" opacity=".95" transform="rotate(8 164 107)"/><path d="m134 92 30 20 30-20" fill="none" class="a2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" transform="rotate(8 164 107)"/><rect x="20" y="104" width="40" height="38" rx="6" class="a3"/><rect x="27" y="112" width="26" height="4" rx="2" fill="#fff"/><rect x="27" y="121" width="20" height="4" rx="2" fill="#fff" opacity=".7"/><rect x="27" y="130" width="24" height="4" rx="2" fill="#fff" opacity=".7"/></svg></section>';
}
function cardNotulensi() {
  const n = (S.d.notulensi || []).slice().sort((a, b) => String(b.tanggal_pertemuan).localeCompare(String(a.tanggal_pertemuan)))[0];
  return '<section class="card"><div class="card-h"><h3>' + ic('menu_book') + 'Notulensi Terbaru</h3></div>' + (n ? '<div class="muted sm">' + ic('event') + tgl(n.tanggal_pertemuan) + ' · ' + esc(n.tempat_pertemuan || '') + '</div><p class="clamp">' + esc(n.hasil_pembahasan) + '</p><button type="button" class="lnk" data-act="notView" data-id="' + esc(n.id) + '">Baca selengkapnya ' + ic('arrow_forward') + '</button>' : empty('menu_book', 'Belum ada notulensi')) + '</section>';
}
function cardPengurus() {
  const l = (S.d.pengurus || []).slice().sort((a, b) => a.urutan - b.urutan);
  return '<section class="card"><div class="card-h"><h3>' + ic('groups') + 'Struktur Pengurus</h3></div>' + (l.length ? '<ul class="list">' + l.map(p => '<li class="li"><span class="avatar">' + ini(p.nama) + '</span><div class="li-b"><b>' + esc(p.nama) + '</b><span>' + esc(p.jabatan) + '</span></div>' + (p.no_hp ? '<a class="iconbtn cyan" href="tel:' + esc(p.no_hp) + '" aria-label="Telepon ' + esc(p.nama) + '">' + ic('call') + '</a>' : '') + '</li>').join('') + '</ul>' : empty('groups', 'Belum ada data pengurus')) + '</section>';
}
function cardDarurat() {
  const l = (S.d.darurat || []).slice().sort((a, b) => a.urutan - b.urutan);
  const no = (n, k) => '<div class="nm2"><a class="lnk" href="tel:' + esc(n) + '">' + ic('call') + esc(n) + '</a>' + (k ? '<small>' + esc(k) + '</small>' : '') + '</div>';
  return '<section class="card"><div class="card-h"><h3>' + ic('emergency') + 'Nomor Darurat</h3></div>' + (l.length ? '<ul class="list">' + l.map(p => '<li class="li"><span class="avatar bad">' + ic('call') + '</span><div class="li-b"><b>' + esc(p.nama_layanan) + '</b>' + no(p.nomor, p.keterangan) + (p.nomor2 ? no(p.nomor2, p.keterangan2) : '') + '</div></li>').join('') + '</ul>' : empty('emergency', 'Belum ada nomor darurat')) + '</section>';
}

/* ---------- 9. REKAP IURAN ---------- */
function rekapRows(jenis, perId) {
  const key = jenis === 'Jimpitan' ? 'jimpitan' : 'agustusan', per = IDX.per[perId]; if (!per) return [];
  const m = {}; (S.d[key] || []).filter(r => r.id_periode === perId).forEach(r => (m[r.id_kk] = m[r.id_kk] || []).push(r));
  return (S.d.kk || []).filter(k => k.status === 'Aktif' || m[k.id_kk]).sort(byName).map(k => {
    const rs = m[k.id_kk] || [], last = rs.slice().sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal))).pop();
    return { kk: k, recs: rs, total: rs.reduce((s, r) => s + r.jumlah, 0), last: last, lunas: rs.length > 0 };
  });
}
function rekapTbl(rows, jenis, perId, limit) {
  const per = IDX.per[perId]; if (!per) return empty('event_busy', 'Belum ada periode iuran', 'Bendahara dapat membuat periode di tab Periode.');
  const mod = jenis === 'Jimpitan' ? 'jimpitan' : 'agustusan', boleh = can(mod, 'T') && (per.status === 'Buka' || isAdmin());
  if (!rows.length) return empty('search_off', 'Tidak ada data yang cocok');
  const lim = limit ? rows.slice(0, limit) : rows;
  return '<div class="tblwrap"><table class="tbl"><thead><tr><th>Nama KK</th><th>Tanggal</th><th class="ta-r">Jumlah</th><th>Status</th>' + (boleh || can(mod, 'H') ? '<th class="ta-r">Aksi</th>' : '') + '</tr></thead><tbody>' +
    lim.map(r => '<tr><td data-label="Nama KK"><div class="tdn"><span class="avatar">' + ini(r.kk.nama_kk) + '</span><b>' + esc(r.kk.nama_kk) + '</b></div></td><td data-label="Tanggal">' + (r.last ? tgl(r.last.tanggal) : '–') + '</td><td data-label="Jumlah" class="ta-r">' + (r.lunas ? rp(r.total) : '–') + '</td><td data-label="Status">' + (r.lunas ? chip('ok', 'Lunas') : chip('warn', 'Belum')) + '</td>' +
      (boleh || can(mod, 'H') ? '<td class="ta-r nolabel"><div class="rowact">' +
        (boleh && !r.lunas ? '<button type="button" class="btn btn-pri btn-sm" data-act="iuranCatat" data-j="' + jenis + '" data-per="' + perId + '" data-kk="' + esc(r.kk.id_kk) + '">Catat</button>' : '') +
        (boleh && r.lunas && can(mod, 'U') ? '<button type="button" class="iconbtn sm" data-act="iuranEdit" data-j="' + jenis + '" data-id="' + esc(r.last.id) + '" aria-label="Ubah">' + ic('edit') + '</button>' : '') +
        (r.lunas && can(mod, 'H') ? '<button type="button" class="iconbtn sm danger" data-act="iuranDel" data-j="' + jenis + '" data-id="' + esc(r.last.id) + '" aria-label="Hapus">' + ic('delete') + '</button>' : '') +
        '</div></td>' : '') + '</tr>').join('') + '</tbody></table></div>' + (limit && rows.length > limit ? '<div class="more"><button type="button" class="lnk" data-act="go" data-p="iuran">Lihat semua ' + rows.length + ' KK ' + ic('arrow_forward') + '</button></div>' : '');
}
function berandaRekap() {
  const u = U('beranda'); u.j = u.j || 'Jimpitan';
  const per = periodeAktif(u.j), pid = per ? per.id_periode : '', q = String(u.q || '').toLowerCase();
  let rows = rekapRows(u.j, pid); if (q) rows = rows.filter(r => r.kk.nama_kk.toLowerCase().indexOf(q) > -1);
  return '<div class="card-h wrap"><div><h3>Rekap Iuran</h3><span class="muted sm">' + (per ? esc(per.label) : 'Belum ada periode') + '</span></div><div class="toolbar tight"><div class="tabs mini">' +
    ['Jimpitan', 'Agustusan'].map(j => '<button type="button" class="tab' + (u.j === j ? ' on' : '') + '" data-act="berTab" data-j="' + j + '">' + j + '</button>').join('') + '</div><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" data-full="0" value="' + esc(u.q || '') + '" placeholder="Cari nama KK…" aria-label="Cari KK"></div><button type="button" class="btn btn-soft btn-sm" data-act="pdfIuran" data-per="' + pid + '">' + ic('picture_as_pdf') + 'Cetak PDF</button></div></div><div id="lst">' + rekapTbl(rows, u.j, pid, 8) + '</div>';
}
function berandaPublikKas(R) {
  const tx = R.tx || [];
  return '<div class="card-h"><div><h3>Riwayat Kas Terbaru</h3><span class="muted sm">Rincian iuran per KK hanya terlihat setelah masuk.</span></div><button type="button" class="btn btn-soft btn-sm" data-act="login">' + ic('login') + 'Masuk</button></div>' +
    (tx.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jenis</th><th class="ta-r">Jumlah</th></tr></thead><tbody>' + tx.map(t => '<tr><td data-label="Tanggal">' + tgl(t.tanggal) + '</td><td data-label="Keterangan">' + esc(t.keterangan) + '</td><td data-label="Jenis">' + chip(t.jenis === 'Masuk' ? 'info' : 'bad', 'Kas ' + t.jenis) + '</td><td data-label="Jumlah" class="ta-r">' + rp(t.jumlah) + '</td></tr>').join('') + '</tbody></table></div>' : empty('receipt_long', 'Belum ada transaksi'));
}

/* ---------- 10. HALAMAN ---------- */
const PG = {};
const NAV = [
  { id: 'beranda', ic: 'home', t: 'Beranda', show: () => true },
  { id: 'kk', ic: 'badge', t: 'Daftar KK', show: () => can('kk', 'L') },
  { id: 'iuran', ic: 'payments', t: 'Iuran', show: () => can('jimpitan', 'L') },
  { id: 'kas', ic: 'account_balance_wallet', t: 'Kas RT', show: () => true },
  { id: 'undian', ic: 'casino', t: 'Undian', show: () => can('undian', 'L') },
  { id: 'notulensi', ic: 'menu_book', t: 'Notulensi', show: () => true },
  { id: 'informasi', ic: 'info', t: 'Informasi', show: () => true },
  { id: 'usulan', ic: 'campaign', t: 'Usulan Fasilitas', show: () => can('usulan', 'L') },
  { id: 'crm', ic: 'forum', t: 'Kontak & WA', show: () => can('crm', 'L') },
  { id: 'pengguna', ic: 'manage_accounts', t: 'Pengguna', show: () => can('pengguna', 'L') },
  { id: 'profil', ic: 'account_circle', t: 'Profil', show: () => !!S.user }
];
const navVisible = () => NAV.filter(n => n.show());
const allowed = p => p === 'menu' || navVisible().some(n => n.id === p);
function head(eyebrow, h, sub, actions) { return '<div class="pagehead"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(h) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' + (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>'; }
function tabs(items, cur, act) { return '<div class="tabs" role="tablist">' + items.map(i => '<button type="button" role="tab" aria-selected="' + (cur === i[0]) + '" class="tab' + (cur === i[0] ? ' on' : '') + '" data-act="' + act + '" data-t="' + i[0] + '">' + (i[2] ? ic(i[2]) : '') + esc(i[1]) + '</button>').join('') + '</div>'; }

/* Beranda */
PG.beranda = {
  html() {
    const R = hitung();
    return head('Selamat datang, ' + (S.user ? S.user.nama : 'Warga'), 'Beranda') +
      '<div class="stack"><div class="onlymobile">' + saldoCard(R) + aksiBtns() + '</div>' + banner() + insight(R) + resetBanner() +
      '<div class="sec"><h2>Ringkasan Iuran <small>periode berjalan</small></h2>' + '</div>' +
      '<div class="kpigrid" id="kpis">' + kpis(R) + '</div><div class="onlymobile">' + pertemuanCard() + '</div>' +
      '<section class="card rekap">' + (S.user ? berandaRekap() : berandaPublikKas(R)) + '</section><div class="onlymobile">' + txCard(R) + '</div>' +
      '<div class="grid3">' + cardNotulensi() + cardPengurus() + cardDarurat() + '</div></div>';
  },
  list() { return null; }
};

/* Daftar KK */
PG.kk = {
  html() {
    const a = (S.d.kk || []).filter(k => k.status === 'Aktif'), jiwa = a.reduce((s, k) => s + (k.jumlah_keluarga || 0), 0);
    const mine = S.user && !isAdmin() && S.user.id_kk ? IDX.kk[S.user.id_kk] : null;
    return head('Data Warga', 'Daftar Kepala Keluarga', 'Sumber data tunggal untuk iuran, undian, dan kontak WhatsApp. Empat digit terakhir nomor WhatsApp disamarkan.') +
      (mine ? '<section class="card mykk"><div><b>Keluarga Anda: ' + esc(mine.nama_kk) + '</b><span class="s">Isi anggota keluarga, catat kelahiran atau kematian. Opsional.</span></div><button type="button" class="btn btn-pri" data-act="kkDetail" data-id="' + esc(mine.id_kk) + '">' + ic('family_restroom') + 'Kelola Anggota Keluarga</button></section><div style="height:16px"></div>' : '') +
      '<div class="grid3 kpis3">' + kpi('home', 'blue', 'KK aktif', a.length + ' KK', 'Terdaftar di RT.06') + kpi('group', 'cyan', 'Total jiwa', jiwa ? jiwa + ' jiwa' : '–', 'Dari jumlah keluarga terisi') + kpi('person_off', 'amber', 'KK nonaktif', ((S.d.kk || []).length - a.length) + ' KK', 'Tidak masuk form iuran') + '</div>' + crudView('kk');
  },
  list() { return crudList('kk'); }
};

/* Iuran */
PG.iuran = {
  html() {
    const u = U('iuran'); u.tab = u.tab || 'Jimpitan';
    const tb = tabs([['Jimpitan', 'Jimpitan', 'payments'], ['Agustusan', 'Agustusan', 'flag'], ['periode', 'Periode', 'calendar_month']], u.tab, 'iuranTab');
    if (u.tab === 'periode') return head('Pencatatan', 'Iuran Warga', 'Kelola periode Jimpitan (bulanan) dan Agustusan (mingguan).') + tb + crudView('periode');
    const pers = (S.d.periode || []).filter(p => p.jenis === u.tab).sort((a, b) => String(b.tanggal_mulai).localeCompare(String(a.tanggal_mulai)));
    if (!u.per || !IDX.per[u.per] || IDX.per[u.per].jenis !== u.tab) { const a = periodeAktif(u.tab); u.per = a ? a.id_periode : ''; }
    const per = IDX.per[u.per], mod = u.tab === 'Jimpitan' ? 'jimpitan' : 'agustusan';
    const s = per ? ringk(mod, u.tab, (S.d.kk || []).filter(k => k.status === 'Aktif')) : null;
    let tot = 0, bayar = 0, kkA = (S.d.kk || []).filter(k => k.status === 'Aktif').length;
    if (per) { const rs = rekapRows(u.tab, u.per); rs.forEach(r => { tot += r.total; if (r.lunas) bayar++; }); }
    return head('Pencatatan', 'Iuran Warga', 'Rekap sudah dan belum membayar per periode.') + tb +
      '<div class="toolbar"><select class="sel grow" data-f="per" data-full="1" aria-label="Pilih periode">' + (pers.length ? pers.map(p => '<option value="' + p.id_periode + '"' + (p.id_periode === u.per ? ' selected' : '') + '>' + esc(p.label) + (p.status === 'Tutup' ? ' (Tutup)' : '') + '</option>').join('') : '<option value="">Belum ada periode</option>') + '</select>' +
      '<div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari nama KK…" aria-label="Cari KK"></div>' +
      '<select class="sel" data-f="st" aria-label="Filter status"><option value="">Semua status</option><option value="L"' + (u.st === 'L' ? ' selected' : '') + '>Lunas</option><option value="B"' + (u.st === 'B' ? ' selected' : '') + '>Belum</option></select>' +
      '<button type="button" class="btn btn-soft" data-act="pdfIuran" data-per="' + u.per + '">' + ic('picture_as_pdf') + 'Cetak PDF</button>' +
      (can(mod, 'T') && per ? '<button type="button" class="btn btn-pri" data-act="iuranCatat" data-j="' + u.tab + '" data-per="' + u.per + '" data-kk="">' + ic('add') + 'Catat Iuran</button>' : '') + '</div>' +
      '<div class="grid3 kpis3">' + kpi('savings', 'blue', 'Terkumpul', rp(tot), per ? esc(per.label) + (per.status === 'Tutup' ? ' · Tutup' : '') : '&nbsp;') + (isAdmin() ? kpi('check_circle', 'green', 'Sudah membayar', bayar + ' KK', 'dari ' + kkA + ' KK aktif') + kpi('pending_actions', 'amber', 'Belum membayar', '<span class="neg">' + Math.max(0, kkA - bayar) + ' KK</span>', per && per.nominal ? 'Nominal ' + rp(per.nominal) + '/KK' : '&nbsp;') : (per && per.nominal ? kpi('payments', 'cyan', 'Nominal per KK', rp(per.nominal), 'Periode ' + esc(per.label)) : '')) + '</div>' +
      '<div class="card flush" id="lst">' + PG.iuran.list() + '</div>';
  },
  list() {
    const u = U('iuran'); if (u.tab === 'periode') return crudList('periode');
    let rows = rekapRows(u.tab, u.per), q = String(u.q || '').toLowerCase();
    if (q) rows = rows.filter(r => r.kk.nama_kk.toLowerCase().indexOf(q) > -1);
    if (u.st === 'L') rows = rows.filter(r => r.lunas); if (u.st === 'B') rows = rows.filter(r => !r.lunas);
    return rekapTbl(rows, u.tab, u.per, 0);
  }
};
function iuranForm(jenis, perId, kkId, rec) {
  const per = IDX.per[perId], tab = jenis === 'Jimpitan' ? 'IuranJimpitan' : 'IuranAgustusan', key = jenis === 'Jimpitan' ? 'jimpitan' : 'agustusan';
  const fields = [];
  if (!rec) fields.push({ k: 'id_kk', l: 'Kepala Keluarga', type: 'select', req: 1, opts: (S.d.kk || []).filter(k => k.status === 'Aktif').sort(byName).map(k => [k.id_kk, k.nama_kk]) });
  fields.push({ k: 'tanggal', l: 'Tanggal pembayaran', type: 'date', req: 1 }, { k: 'jumlah', l: 'Jumlah (Rp)', type: 'number', req: 1, min: 1 });
  formModal({
    title: (rec ? 'Ubah' : 'Catat') + ' Iuran ' + jenis, note: 'Periode: ' + (per ? per.label : '-') + (rec ? ' · ' + kkNama(rec.id_kk) : ''), fields: fields,
    values: { id_kk: kkId, tanggal: rec ? rec.tanggal : today(), jumlah: rec ? rec.jumlah : (per && per.nominal) || '' },
    onSubmit: async v => {
      if (rec) return mutate(tab, 'upd', { id: rec.id, tanggal: v.tanggal, jumlah: v.jumlah });
      const dup = (S.d[key] || []).some(r => r.id_periode === perId && r.id_kk === v.id_kk);
      if (dup && !(await askConfirm('KK ini sudah tercatat membayar pada periode ini. Tetap catat lagi?'))) return;
      mutate(tab, 'add', { id: uid(jenis === 'Jimpitan' ? 'JMP' : 'AGS'), id_periode: perId, id_kk: v.id_kk, tanggal: v.tanggal, jumlah: v.jumlah, dicatat_oleh: S.user.nama }, { force: dup });
    }
  });
}

/* Kas */
PG.kas = {
  html() {
    const R = hitung(), u = U('kas');
    if (!S.user) return head('Transparansi', 'Kas RT', 'Ringkasan saldo dan transaksi terbaru.') + '<div class="grid3 kpis3">' + kpi('account_balance', 'blue', 'Saldo kas', rp(R.saldo), 'Saat ini') + kpi('south_west', 'green', 'Masuk bulan ini', rp(R.masukBulan), '&nbsp;') + kpi('north_east', 'red', 'Keluar bulan ini', rp(R.keluarBulan), '&nbsp;') + '</div><section class="card">' + berandaPublikKas(R) + '</section>';
    u.tab = u.tab || 'semua';
    return head('Buku Kas', 'Kas RT', can('kas', 'T') ? 'Saldo dihitung otomatis dari seluruh transaksi.' : 'Riwayat kas masuk dan keluar RT. Warga hanya dapat melihat; pencatatan oleh Bendahara atau Administrator.', can('kas', 'T') ? '<button type="button" class="btn btn-pri" data-act="kasAdd">' + ic('add') + 'Catat Transaksi</button>' : '') +
      '<div class="grid4 kpis3">' + kpi('account_balance', 'blue', 'Saldo kas', rp(R.saldo), 'Saat ini') + kpi('south_west', 'green', 'Masuk bulan ini', rp(R.masukBulan), '&nbsp;') + kpi('north_east', 'red', 'Keluar bulan ini', rp(R.keluarBulan), '&nbsp;') + kpi('flag', 'cyan', 'Kas Agustusan', rp(R.kasAgustusan), 'Dana terpisah') + '</div>' +
      tabs([['semua', 'Semua Riwayat', 'receipt_long'], ['Masuk', 'Kas Masuk', 'south_west'], ['Keluar', 'Kas Keluar', 'north_east']], u.tab, 'kasTab') +
      '<div class="toolbar"><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari keterangan…" aria-label="Cari transaksi"></div>' +
      '<label class="dt">Dari <input class="inp" type="date" data-f="dari" value="' + esc(u.dari || '') + '"></label><label class="dt">Sampai <input class="inp" type="date" data-f="sampai" value="' + esc(u.sampai || '') + '"></label><button type="button" class="btn btn-soft" data-act="pdfKas">' + ic('picture_as_pdf') + 'Cetak PDF</button></div><div class="card flush" id="lst">' + PG.kas.list() + '</div>';
  },
  list() {
    const u = U('kas'); if (!S.user) return '';
    let r = kasSorted().slice().reverse(), q = String(u.q || '').toLowerCase();
    if (q) r = r.filter(x => String(x.keterangan).toLowerCase().indexOf(q) > -1); if (u.tab === 'Masuk' || u.tab === 'Keluar') r = r.filter(x => x.jenis === u.tab);
    if (u.dari) r = r.filter(x => x.tanggal >= u.dari); if (u.sampai) r = r.filter(x => x.tanggal <= u.sampai);
    if (!r.length) return empty('receipt_long', 'Tidak ada transaksi', 'Ubah filter atau catat transaksi baru.');
    const aksi = can('kas', 'U') || can('kas', 'H'), tot = r.reduce((a, x) => a + x.jumlah, 0);
    return '<div class="card-h pad"><span class="pill">' + r.length + ' transaksi</span>' + (u.tab === 'semua' ? '' : '<span class="pill">Total ' + (u.tab === 'Masuk' ? 'masuk ' : 'keluar ') + rp(tot) + '</span>') + '</div><div class="tblwrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jenis</th><th class="ta-r">Jumlah</th><th class="ta-r">Saldo</th><th>Bukti</th>' + (aksi ? '<th class="ta-r">Aksi</th>' : '') + '</tr></thead><tbody>' +
      r.map(x => '<tr><td data-label="Tanggal">' + tgl(x.tanggal) + '</td><td data-label="Keterangan">' + esc(x.keterangan) + '</td><td data-label="Jenis">' + chip(x.jenis === 'Masuk' ? 'info' : 'bad', 'Kas ' + x.jenis) + '</td><td data-label="Jumlah" class="ta-r amt ' + (x.jenis === 'Masuk' ? 'in' : 'out') + '">' + (x.jenis === 'Masuk' ? '+' : '-') + rp(x.jumlah) + '</td><td data-label="Saldo" class="ta-r">' + rp(x.saldo_setelah) + '</td><td data-label="Bukti">' + (x.id_berkas ? '<button type="button" class="btn btn-soft btn-sm" data-act="bukti" data-b="' + esc(x.id_berkas) + '">' + ic('attach_file') + 'Lihat</button>' : '–') + '</td>' +
        (aksi ? '<td class="ta-r nolabel"><div class="rowact">' + (can('kas', 'U') ? '<button type="button" class="iconbtn sm" data-act="kasEdit" data-id="' + esc(x.id) + '" aria-label="Ubah">' + ic('edit') + '</button>' : '') + (can('kas', 'H') ? '<button type="button" class="iconbtn sm danger" data-act="kasDel" data-id="' + esc(x.id) + '" aria-label="Hapus">' + ic('delete') + '</button>' : '') + '</div></td>' : '') + '</tr>').join('') + '</tbody></table></div>';
  }
};
function kasForm(old) {
  formModal({
    title: old ? 'Ubah Transaksi Kas' : 'Catat Transaksi Kas', values: old || { jenis: 'Keluar', tanggal: today() },
    fields: [{ k: 'jenis', l: 'Jenis', type: 'select', opts: ['Masuk', 'Keluar'], req: 1 }, { k: 'tanggal', l: 'Tanggal', type: 'date', req: 1 }, { k: 'keterangan', l: 'Keterangan', req: 1, ph: 'Contoh: Pembelian lampu gang' }, { k: 'jumlah', l: 'Jumlah (Rp)', type: 'number', req: 1, min: 1 }, { k: 'bukti', l: 'Bukti pengeluaran (opsional)', type: 'file', accept: 'image/jpeg,image/png,application/pdf', help: 'jpg, png atau pdf, maksimal 5 MB. Foto dikompres otomatis.' }],
    onSubmit: async v => {
      let idb = old ? old.id_berkas : '';
      if (v.bukti && v.bukti.size) { toast('Mengunggah bukti…', 'warn'); const b = await fileB64(v.bukti); idb = (await srv('unggahBukti', S.token, b.nama, b.mime, b.b64)).id_berkas; }
      const rec = { tanggal: v.tanggal, jenis: v.jenis, keterangan: v.keterangan, jumlah: v.jumlah, id_berkas: idb };
      if (old) mutate('KasRT', 'upd', Object.assign({ id: old.id }, rec)); else mutate('KasRT', 'add', Object.assign({ id: uid('KAS'), dicatat_oleh: S.user.nama, saldo_setelah: 0, ref_id: '' }, rec));
    }
  });
}

/* Undian */
PG.undian = {
  html() {
    const u = U('undian'), gl = S.d.giliran || [], belum = gl.filter(g => g.status === 'Belum').length;
    const kc = (S.d.kocokan || []).slice().sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || 0).slice(0, 20);
    return head('Pertemuan RT', 'Giliran & Kocokan Undian', 'KK yang sudah mendapat giliran tidak terpilih lagi sampai putaran direset.',
      can('undian', 'U') ? '<button type="button" class="btn btn-soft" data-act="undianIsi">' + ic('sync') + 'Isi dari Daftar KK</button><button type="button" class="btn btn-soft danger" data-act="undianReset">' + ic('restart_alt') + 'Reset Putaran</button>' : '') +
      '<div class="grid2 split"><section class="card"><div class="card-h"><h3>Urutan Giliran</h3><span class="sec2l">' + chip('ok', (gl.length - belum) + ' sudah') + chip(belum ? 'warn' : 'ok', belum + ' belum') + '</span></div><div class="toolbar tight"><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari nama KK…" aria-label="Cari"></div><select class="sel" data-f="st" aria-label="Status"><option value="">Semua</option><option value="Sudah"' + (u.st === 'Sudah' ? ' selected' : '') + '>Sudah</option><option value="Belum"' + (u.st === 'Belum' ? ' selected' : '') + '>Belum</option></select></div><div id="lst">' + PG.undian.list() + '</div></section>' +
      '<section class="card draw"><div class="card-h"><h3>Kocok Undian</h3></div><div class="drum" aria-live="polite"><span class="mi big' + (u.busy ? ' spin' : '') + '">casino</span><div class="slot" id="slot">' + (u.hasil ? esc(u.hasil.nama) : 'Siap dikocok') + '</div><div class="muted sm">' + (u.hasil ? 'Terpilih · ' + tgl(u.hasil.tgl) : belum + ' KK menunggu giliran') + '</div></div>' +
      (can('undian', 'T') ? '<div class="field"><label for="ket">Keterangan (opsional)</label><input id="ket" class="inp" data-f="ket" value="' + esc(u.ket || '') + '" placeholder="Contoh: Pertemuan bulan ini"></div><button type="button" class="btn btn-pri btn-block lg" data-act="kocok"' + (u.busy ? ' disabled' : '') + '>' + ic('shuffle') + (u.busy ? 'Mengocok…' : 'Kocok Otomatis') + '</button><button type="button" class="btn btn-soft btn-block" data-act="undianManual">' + ic('edit_note') + 'Catat Manual (kocok langsung)</button>' : '<p class="muted sm">Hanya Sekretaris atau Administrator yang dapat mengocok undian.</p>') + '</section></div>' +
      '<section class="card flush"><div class="card-h pad"><h3>Riwayat Kocokan</h3></div>' + (kc.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>KK Terpilih</th><th>Mode</th><th>Keterangan</th><th>Dicatat</th>' + (can('undian', 'U') ? '<th class="ta-r">Aksi</th>' : '') + '</tr></thead><tbody>' + kc.map(k => '<tr><td data-label="Tanggal">' + tgl(k.tanggal) + '</td><td data-label="KK Terpilih"><b>' + esc(kkNama(k.id_kk_terpilih)) + '</b></td><td data-label="Mode">' + chip(k.mode === 'Otomatis' ? 'ok' : 'warn', k.mode) + '</td><td data-label="Keterangan">' + esc(k.keterangan || '–') + '</td><td data-label="Dicatat">' + esc(k.dicatat_oleh) + '</td>' + (can('undian', 'U') ? '<td class="ta-r nolabel"><button type="button" class="btn btn-soft btn-sm danger" data-act="kocokanDel" data-id="' + esc(k.id) + '" title="Hapus bila pemenang menolak">' + ic('delete') + 'Hapus</button></td>' : '') + '</tr>').join('') + '</tbody></table></div>' : empty('history', 'Belum ada riwayat')) + '</section>';
  },
  list() {
    const u = U('undian'), q = String(u.q || '').toLowerCase();
    let r = (S.d.giliran || []).slice().sort((a, b) => a.urutan - b.urutan);
    if (q) r = r.filter(g => kkNama(g.id_kk).toLowerCase().indexOf(q) > -1); if (u.st) r = r.filter(g => g.status === u.st);
    if (!r.length) return empty('casino', 'Belum ada giliran', can('undian', 'U') ? 'Tekan "Isi dari Daftar KK".' : '');
    return '<ul class="list scroll">' + r.map(g => { const ok = g.status === 'Sudah'; return '<li class="li' + (ok ? ' done' : '') + '"><span class="avatar">' + (ok ? ic('check') : g.urutan) + '</span><div class="li-b"><b>' + esc(kkNama(g.id_kk)) + '</b><span>' + (ok ? 'Sudah mendapat · ' + tgl(g.tanggal_giliran) : 'Belum mendapat giliran') + '</span></div>' + chip(ok ? 'ok' : 'warn', ok ? 'Sudah mendapat' : 'Belum') + '</li>'; }).join('') + '</ul>';
  }
};
async function kocok() {
  const u = U('undian'); if (u.busy) return;
  const cand = (S.d.giliran || []).filter(g => g.status === 'Belum').map(g => kkNama(g.id_kk));
  if (!cand.length) return toast('Semua KK sudah mendapat giliran. Reset putaran terlebih dahulu.', 'warn');
  u.busy = true; u.hasil = null; renderPage();
  let i = 0; const t = setInterval(() => { const s = $('#slot'); if (s) s.textContent = cand[i++ % cand.length]; }, 90);
  try {
    const out = await Promise.all([srv('kocokUndian', S.token, u.ket || ''), new Promise(r => setTimeout(r, 1800))]), r = out[0];
    S.d.giliran = r.giliran; (S.d.kocokan = S.d.kocokan || []).push(r.kocokan); u.hasil = { nama: r.terpilih, tgl: r.kocokan.tanggal }; persist();
    toast('Terpilih: ' + r.terpilih);
  } catch (e) { toast(e.message, 'err'); }
  clearInterval(t); u.busy = false; renderPage();
}

/* Notulensi */
PG.notulensi = {
  html() {
    const u = U('notulensi');
    return head('Dokumentasi', 'Notulensi Pertemuan', 'Arsip hasil pembahasan pertemuan RT.', can('notulensi', 'T') ? '<button type="button" class="btn btn-pri" data-act="notAdd">' + ic('add') + 'Tulis Notulensi</button>' : '') +
      '<div class="toolbar"><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari isi atau tempat…" aria-label="Cari notulensi"></div><label class="dt">Dari <input class="inp" type="date" data-f="dari" value="' + esc(u.dari || '') + '"></label><label class="dt">Sampai <input class="inp" type="date" data-f="sampai" value="' + esc(u.sampai || '') + '"></label></div><div id="lst" class="grid3 docs">' + PG.notulensi.list() + '</div>';
  },
  list() {
    const u = U('notulensi'), q = String(u.q || '').toLowerCase();
    let r = (S.d.notulensi || []).slice().sort((a, b) => String(b.tanggal_pertemuan).localeCompare(String(a.tanggal_pertemuan)));
    if (q) r = r.filter(n => (n.hasil_pembahasan + ' ' + n.tempat_pertemuan).toLowerCase().indexOf(q) > -1);
    if (u.dari) r = r.filter(n => n.tanggal_pertemuan >= u.dari); if (u.sampai) r = r.filter(n => n.tanggal_pertemuan <= u.sampai);
    if (!r.length) return '<div class="span-all card">' + empty('menu_book', 'Tidak ada notulensi') + '</div>';
    return r.map(n => '<article class="card doc"><div class="doc-h">' + chip('info', tgl(n.tanggal_pertemuan)) + '<span class="muted sm">' + esc(n.tempat_pertemuan || '') + '</span></div><p class="clamp3">' + esc(n.hasil_pembahasan) + '</p><div class="doc-f"><button type="button" class="btn btn-soft btn-sm" data-act="notView" data-id="' + esc(n.id) + '">Baca</button><button type="button" class="btn btn-soft btn-sm" data-act="notPdf" data-id="' + esc(n.id) + '">' + ic('picture_as_pdf') + 'PDF</button>' +
      (can('notulensi', 'U') ? '<button type="button" class="iconbtn sm" data-act="notEdit" data-id="' + esc(n.id) + '" aria-label="Ubah">' + ic('edit') + '</button>' : '') + (can('notulensi', 'H') ? '<button type="button" class="iconbtn sm danger" data-act="notDel" data-id="' + esc(n.id) + '" aria-label="Hapus">' + ic('delete') + '</button>' : '') + '</div></article>').join('');
  }
};
function notForm(old) {
  formModal({
    title: old ? 'Ubah Notulensi' : 'Tulis Notulensi', cls: 'lg', values: old ? { tanggal_pertemuan: old.tanggal_pertemuan, tempat_pertemuan: old.tempat_pertemuan, hasil_pembahasan: old.hasil_pembahasan } : { tanggal_pertemuan: today() },
    fields: [{ k: 'tanggal_pertemuan', l: 'Tanggal pertemuan', type: 'date', req: 1 }, { k: 'tempat_pertemuan', l: 'Tempat pertemuan' }, { k: 'hasil_pembahasan', l: 'Hasil pembahasan', type: 'textarea', req: 1, rows: 9 }],
    onSubmit: async v => { if (old) mutate('Notulensi', 'upd', Object.assign({ id: old.id }, v)); else mutate('Notulensi', 'add', Object.assign({ id: uid('NTL'), dibuat_oleh: S.user.nama }, v)); }
  });
}

/* Informasi (konten RT) */
PG.informasi = {
  html() {
    const u = U('informasi'); u.tab = u.tab || 'informasi';
    return head('Lingkungan', 'Informasi RT', 'Informasi warga, struktur pengurus, nomor darurat, dan jadwal pertemuan.') + tabs([['informasi', 'Informasi Warga', 'info'], ['pengurus', 'Pengurus', 'groups'], ['darurat', 'Nomor Darurat', 'emergency'], ['pertemuan', 'Pertemuan', 'event']], u.tab, 'kontenTab') + crudView(u.tab);
  },
  list() { return crudList(U('informasi').tab || 'informasi'); }
};

/* Usulan fasilitas */
PG.usulan = {
  html() {
    const u = U('usulan');
    return head('Aspirasi Warga', 'Usulan Fasilitas', 'Sampaikan usulan untuk fasilitas lingkungan. Semua warga yang masuk dapat membaca.', can('usulan', 'T') ? '<button type="button" class="btn btn-pri" data-act="usulanAdd">' + ic('add') + 'Buat Usulan</button>' : '') +
      '<div class="toolbar"><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari usulan…" aria-label="Cari"></div><select class="sel" data-f="st" aria-label="Status"><option value="">Semua status</option>' + ['Baru', 'Diproses', 'Selesai'].map(s => '<option' + (u.st === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div><div id="lst" class="stack">' + PG.usulan.list() + '</div>';
  },
  list() {
    const u = U('usulan'), q = String(u.q || '').toLowerCase();
    let r = (S.d.usulan || []).slice().sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));
    if (q) r = r.filter(x => (x.judul + ' ' + x.uraian).toLowerCase().indexOf(q) > -1); if (u.st) r = r.filter(x => x.status === u.st);
    if (!r.length) return '<div class="card">' + empty('campaign', 'Belum ada usulan') + '</div>';
    return r.map(x => '<article class="card"><div class="card-h"><h3>' + esc(x.judul) + '</h3>' + chip(x.status === 'Selesai' ? 'ok' : x.status === 'Diproses' ? 'warn' : 'info', x.status) + '</div><p>' + esc(x.uraian) + '</p><div class="usl-m"><span class="muted sm">' + ic('event') + ' ' + tgl(x.tanggal) + '</span>' + (isAdmin() && x.pengusul ? '<span class="who" title="Hanya terlihat oleh Administrator">' + ic('person') + '<span>Diusulkan oleh <b>' + esc(x.pengusul) + '</b>' + (x.pengusul_kk ? ' · KK ' + esc(x.pengusul_kk) : '') + '</span><em>Hanya admin</em></span>' : '') + '</div>' + (x.tanggapan ? '<div class="reply">' + ic('reply') + '<span><b>Tanggapan:</b> ' + esc(x.tanggapan) + '</span></div>' : '') +
      (can('usulan', 'U') || can('usulan', 'H') ? '<div class="doc-f">' + (can('usulan', 'U') ? '<button type="button" class="btn btn-soft btn-sm" data-act="usulanTanggap" data-id="' + esc(x.id) + '">' + ic('rate_review') + 'Tanggapi</button>' : '') + (can('usulan', 'H') ? '<button type="button" class="iconbtn sm danger" data-act="usulanDel" data-id="' + esc(x.id) + '" aria-label="Hapus">' + ic('delete') + '</button>' : '') + '</div>' : '') + '</article>').join('');
  }
};

/* CRM Kontak & WhatsApp */
const hpOk = x => /^08\d{8,12}$/.test(String(x || ''));
PG.crm = {
  html() {
    const u = U('crm'); u.tab = u.tab || 'kontak';
    const wa = S.cfg && S.cfg.wa_aktif === '1';
    const info = isAdmin() ? (wa ? '' : '<div class="insight warn">' + ic('info') + '<span>Notifikasi WhatsApp belum aktif. Aktifkan di <b>Pengguna → Pengaturan</b> setelah mengisi token Fonnte.</span></div>') : '';
    let body = '';
    if (u.tab === 'kontak') {
      body = '<div class="toolbar"><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari nama atau nomor…" aria-label="Cari kontak"></div><select class="sel" data-f="seg" aria-label="Segmen"><option value="">Semua segmen</option><option' + (u.seg === 'Warga' ? ' selected' : '') + '>Warga</option><option' + (u.seg === 'Pengurus' ? ' selected' : '') + '>Pengurus</option></select>' +
        (can('crm', 'U') ? '<button type="button" class="btn btn-soft" data-act="crmSync">' + ic('sync') + 'Sinkron dari Daftar KK</button><button type="button" class="btn btn-soft" data-act="crmCek">' + ic('verified') + 'Cek nomor WA</button>' : '') + '</div><div class="card flush" id="lst">' + PG.crm.list() + '</div>';
    } else if (u.tab === 'kirim') {
      const per = (S.d.periode || []).slice().sort((a, b) => String(b.tanggal_mulai).localeCompare(String(a.tanggal_mulai)));
      u.sas = u.sas || 'warga'; if (!u.cper && per[0]) u.cper = per[0].id_periode;
      const n = crmPenerima(u).length;
      body = '<section class="card"><div class="card-h"><h3>Kirim Pesan WhatsApp</h3>' + chip(n ? 'info' : 'mute', n + ' penerima') + '</div>' + (can('crmkirim', 'T') ? '<div class="field"><label for="sas">Sasaran</label><select id="sas" class="sel" data-f="sas" data-full="1"><option value="warga"' + (u.sas === 'warga' ? ' selected' : '') + '>Semua warga (KK)</option><option value="pengurus"' + (u.sas === 'pengurus' ? ' selected' : '') + '>Pengurus</option><option value="semua"' + (u.sas === 'semua' ? ' selected' : '') + '>Semua kontak</option><option value="belum"' + (u.sas === 'belum' ? ' selected' : '') + '>KK yang belum membayar iuran…</option></select></div>' +
        (u.sas === 'belum' ? '<div class="field"><label for="cper">Periode iuran</label><select id="cper" class="sel" data-f="cper" data-full="1">' + per.map(p => '<option value="' + p.id_periode + '"' + (p.id_periode === u.cper ? ' selected' : '') + '>' + esc(p.jenis + ' · ' + p.label) + '</option>').join('') + '</select></div>' : '') +
        '<div class="field"><label for="cj">Judul (untuk catatan internal)</label><input id="cj" class="inp" data-f="cj" value="' + esc(u.cj || '') + '" placeholder="Pengingat iuran"></div><div class="field"><label for="cp">Isi pesan</label><textarea id="cp" class="inp" rows="5" data-f="cp" maxlength="1000" placeholder="Halo {nama}, mohon iuran {periode} segera dibayarkan. Terima kasih. — {rt}">' + esc(u.cp || '') + '</textarea><div class="help">Variabel: {nama} {rt} {periode}. Penerima yang opt-out atau nomornya tidak terdaftar WhatsApp dilewati.</div></div><button type="button" class="btn btn-pri" data-act="crmKirim"' + (n ? '' : ' disabled') + '>' + ic('send') + 'Antrikan Pengiriman</button>' : '<p class="muted">Anda tidak memiliki hak mengirim pesan.</p>') + '</section>';
    } else {
      const an = S.d.antrian || [], bl = S.d.blast || [];
      body = '<section class="card flush"><div class="card-h pad"><h3>Kiriman Massal</h3></div>' + (bl.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Judul</th><th>Sasaran</th><th class="ta-r">Terkirim</th><th>Status</th></tr></thead><tbody>' + bl.map(b => '<tr><td data-label="Tanggal">' + esc(String(b.tanggal).slice(0, 16)) + '</td><td data-label="Judul">' + esc(b.judul) + '</td><td data-label="Sasaran">' + esc(b.sasaran) + '</td><td data-label="Terkirim" class="ta-r">' + b.terkirim + '/' + b.total + (b.gagal ? ' · gagal ' + b.gagal : '') + '</td><td data-label="Status">' + chip(b.status === 'Selesai' ? 'ok' : 'warn', b.status) + '</td></tr>').join('') + '</tbody></table></div>' : empty('send', 'Belum ada kiriman')) + '</section>' +
        '<section class="card flush"><div class="card-h pad"><h3>Antrean Terbaru</h3><button type="button" class="btn btn-soft btn-sm" data-act="crmRefresh">' + ic('refresh') + 'Muat ulang</button></div>' + (an.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Tujuan</th><th>Event</th><th>Status</th></tr></thead><tbody>' + an.map(a => '<tr><td data-label="Waktu">' + esc(String(a.dibuat_pada).slice(5, 16)) + '</td><td data-label="Tujuan">' + esc(a.nama || a.tujuan) + '</td><td data-label="Event">' + esc(a.event) + '</td><td data-label="Status">' + chip(a.status === 'Terkirim' ? 'ok' : a.status === 'Gagal' ? 'bad' : 'warn', a.status) + (a.respon && a.status !== 'Terkirim' ? ' <span class="muted sm">' + esc(a.respon) + '</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : empty('inbox', 'Antrean kosong')) + '</section>';
    }
    return head('Komunikasi', 'Kontak & WhatsApp', 'CRM sederhana untuk warga dan pengurus, pengiriman lewat antrean agar tidak memperlambat aplikasi.') + info + tabs([['kontak', 'Kontak', 'contacts'], ['kirim', 'Kirim Pesan', 'send'], ['riwayat', 'Antrean & Riwayat', 'history']], u.tab, 'crmTab') + body;
  },
  list() {
    const u = U('crm'); if (u.tab && u.tab !== 'kontak') return '';
    const q = String(u.q || '').toLowerCase();
    let r = (S.d.crm || []).slice().sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
    if (q) r = r.filter(k => (k.nama + ' ' + k.no_wa + ' ' + (k.tag || '')).toLowerCase().indexOf(q) > -1); if (u.seg) r = r.filter(k => k.segmen === u.seg);
    if (!r.length) return empty('contacts', 'Belum ada kontak', can('crm', 'U') ? 'Isi No. WhatsApp pada Daftar KK lalu tekan Sinkron.' : '');
    return '<div class="tblwrap"><table class="tbl"><thead><tr><th>Nama</th><th>No. WhatsApp</th><th>Segmen</th><th>Status WA</th><th>Tag</th>' + (can('crm', 'U') ? '<th class="ta-r">Aksi</th>' : '') + '</tr></thead><tbody>' +
      r.map(k => '<tr><td data-label="Nama"><b>' + esc(k.nama) + '</b>' + (k.opt_out === 'YA' ? ' ' + chip('bad', 'Opt-out') : '') + '</td><td data-label="No. WhatsApp">' + esc(k.no_wa) + '</td><td data-label="Segmen">' + esc(k.segmen) + '</td><td data-label="Status WA">' + (k.status_wa ? chip(k.status_wa === 'Terdaftar' ? 'ok' : 'bad', k.status_wa) : chip('mute', 'Belum dicek')) + '</td><td data-label="Tag">' + esc(k.tag || '–') + '</td>' + (can('crm', 'U') ? '<td class="ta-r nolabel"><button type="button" class="iconbtn sm" data-act="crmEdit" data-id="' + esc(k.id) + '" aria-label="Ubah">' + ic('edit') + '</button></td>' : '') + '</tr>').join('') + '</tbody></table></div>';
  }
};
function crmPenerima(u) {
  let k = (S.d.crm || []).filter(x => hpOk(x.no_wa) && x.opt_out !== 'YA' && x.status_wa !== 'Tidak Terdaftar');
  if (u.sas === 'warga') k = k.filter(x => x.segmen === 'Warga'); else if (u.sas === 'pengurus') k = k.filter(x => x.segmen === 'Pengurus');
  else if (u.sas === 'belum') {
    const per = IDX.per[u.cper]; if (!per) return [];
    const paid = {}; (S.d[per.jenis === 'Jimpitan' ? 'jimpitan' : 'agustusan'] || []).forEach(r => { if (r.id_periode === per.id_periode) paid[r.id_kk] = 1; });
    k = k.filter(x => x.sumber === 'DaftarKK' && IDX.kk[x.ref_id] && IDX.kk[x.ref_id].status === 'Aktif' && !paid[x.ref_id]);
  }
  return k;
}

/* Pengguna (Administrator) */
PG.pengguna = {
  html() {
    const u = U('pengguna'); u.tab = u.tab || 'akun';
    let body = '';
    if (u.tab === 'akun') {
      body = '<div class="toolbar"><div class="inp-wrap">' + ic('search') + '<input class="inp" type="search" data-f="q" value="' + esc(u.q || '') + '" placeholder="Cari akun…" aria-label="Cari akun"></div><button type="button" class="btn btn-pri" data-act="userAdd">' + ic('person_add') + 'Tambah Akun</button></div><div class="card flush" id="lst">' + PG.pengguna.list() + '</div>';
    } else if (u.tab === 'reset') {
      body = PG.pengguna.resetHtml();
    } else if (u.tab === 'set') {
      const c = S.cfg || {}, m = (() => { try { return JSON.parse(c.matriks || '{}'); } catch (e) { return {}; } })();
      body = '<section class="card"><div class="card-h"><h3>Pengaturan Aplikasi</h3><button type="button" class="btn btn-soft btn-sm" data-act="setEdit">' + ic('edit') + 'Ubah</button></div><dl class="dl"><dt>Nama RT</dt><dd>' + esc(c.nama_rt || '') + '</dd><dt>Jimpitan masuk ke Kas RT</dt><dd>' + (c.jimpitan_kas === '1' ? 'Otomatis' : 'Manual oleh Bendahara') + '</dd><dt>Notifikasi WhatsApp</dt><dd>' + (c.wa_aktif === '1' ? chip('ok', 'Aktif') : chip('mute', 'Nonaktif')) + '</dd><dt>Token Fonnte</dt><dd>' + esc(c.token_mask || 'Belum diisi') + '</dd><dt>Ukuran batch / menit</dt><dd>' + esc(c.batch || '10') + ' pesan</dd><dt>Pengiriman otomatis (trigger)</dt><dd>' + (c.trigger ? chip('ok', 'Berjalan') : chip('warn', 'Belum dipasang')) + ' <button type="button" class="btn btn-soft btn-sm" data-act="trig" data-on="' + (c.trigger ? '0' : '1') + '">' + (c.trigger ? 'Matikan' : 'Pasang') + '</button></dd>' +
        (c.events || []).map(e => '<dt>Otomatis: ' + esc(e.label) + '</dt><dd>' + (m[e.k] ? chip('ok', 'Ya') : chip('mute', 'Tidak')) + '</dd>').join('') + '</dl></section>';
    } else {
      body = '<section class="card"><div class="card-h"><h3>Migrasi & Sinkronisasi dari Spreadsheet Lama</h3></div><p class="muted">Spreadsheet lama hanya dibaca, tidak diubah. Pencocokan memakai nama header dan ID; proses ini aman diulang (delta-sync). Akun pengguna tidak dimigrasikan, buat ulang di tab Akun.</p><div class="field"><label for="mgSrc">ID atau URL spreadsheet lama</label><input id="mgSrc" class="inp" placeholder="https://docs.google.com/spreadsheets/d/…" value="' + esc(u.src || '') + '" data-f="src"></div><div class="mact left"><button type="button" class="btn btn-soft" data-act="mgJalan" data-dry="1">' + ic('search') + 'Pindai (uji coba)</button><button type="button" class="btn btn-pri" data-act="mgJalan" data-dry="0">' + ic('move_down') + 'Impor Sekarang</button></div><div id="mgOut">' + (u.mg || '') + '</div></section>';
    }
    return head('Administrasi', 'Pengguna & Sistem', 'Akun, pengaturan, dan migrasi data.') + tabs([['akun', 'Akun', 'group'], ['reset', 'Reset Sandi' + ((S.d.reset || []).length ? ' (' + S.d.reset.length + ')' : ''), 'key'], ['set', 'Pengaturan', 'tune'], ['mig', 'Migrasi Data', 'cloud_sync']], u.tab, 'penTab') + body;
  },
  resetHtml() {
    const r = S.d.reset || [], norm = x => (S.d.users || []).find(y => y.id_user === x.id_user);
    return '<section class="card flush"><div class="card-h pad"><h3>Permintaan Reset Sandi</h3></div>' + (r.length ? '<ul class="list">' + r.map(x => '<li class="li rsrow"><span class="avatar bad">' + ic('key') + '</span><div class="li-b"><b>' + esc(x.nama || x.username) + '</b><span>@' + esc(x.username) + ' · ' + esc(String(x.tanggal || '').slice(0, 16)) + (x.catatan ? ' · “' + esc(x.catatan) + '”' : '') + '</span></div><div class="rsact"><button type="button" class="btn btn-pri btn-sm" data-act="resetBuat" data-id="' + esc(x.id_user) + '">' + ic('key') + 'Buat sandi sementara</button><button type="button" class="btn btn-soft btn-sm" data-act="resetTutup" data-id="' + esc(x.id) + '">Tutup</button></div></li>').join('') + '</ul>' : empty('key', 'Tidak ada permintaan', 'Warga yang lupa sandi akan muncul di sini.')) + '<p class="muted sm" style="padding:12px 16px">Warga yang nomor WhatsApp-nya tercatat dan Fonnte aktif akan menerima kode 6 digit otomatis. Jika tidak, buatkan sandi sementara lalu kirim lewat WhatsApp.</p></section>';
  },
  list() {
    const u = U('pengguna'); if (u.tab && u.tab !== 'akun') return '';
    const q = String(u.q || '').toLowerCase(); let r = (S.d.users || []).slice();
    if (q) r = r.filter(x => (x.nama + ' ' + x.username).toLowerCase().indexOf(q) > -1);
    if (!r.length) return empty('group', 'Tidak ada akun');
    return '<div class="tblwrap"><table class="tbl"><thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Status</th><th class="ta-r">Aksi</th></tr></thead><tbody>' + r.map(x => '<tr><td data-label="Nama"><div class="tdn"><span class="avatar">' + ini(x.nama) + '</span><b>' + esc(x.nama) + '</b></div></td><td data-label="Username">' + esc(x.username) + '</td><td data-label="Peran">' + chip('info', ROLE_LBL[x.role] || x.role) + '</td><td data-label="Status">' + chip(x.status === 'Aktif' ? 'ok' : 'mute', x.status) + '</td><td class="ta-r nolabel"><div class="rowact"><button type="button" class="iconbtn sm" data-act="userEdit" data-id="' + esc(x.id_user) + '" aria-label="Ubah" title="Ubah">' + ic('edit') + '</button><button type="button" class="iconbtn sm" data-act="userReset" data-id="' + esc(x.id_user) + '" aria-label="Reset sandi" title="Reset sandi">' + ic('key') + '</button><button type="button" class="iconbtn sm danger" data-act="userDel" data-id="' + esc(x.id_user) + '" aria-label="Hapus" title="Hapus">' + ic('delete') + '</button></div></td></tr>').join('') + '</tbody></table></div>';
  }
};
function showCred(un, pw, judul, nama, wa) {
  openModal('<div class="mh"><h3>' + esc(judul) + '</h3></div><div class="mb"><p>Catat dan sampaikan kepada pemilik akun. Sandi ini <b>tidak akan ditampilkan lagi</b>.</p><dl class="dl"><dt>Username</dt><dd><code>' + esc(un) + '</code></dd><dt>Sandi</dt><dd><code id="pwv">' + esc(pw) + '</code></dd></dl>' + (wa ? '<p class=\"help\">' + ic('call') + ' <a class=\"btn btn-soft btn-sm\" target=\"_blank\" rel=\"noopener\" href=\"https://wa.me/' + esc(wa.replace(/^0/, '62')) + '?text=' + encodeURIComponent('Halo ' + (nama || '') + ', sandi sementara SIMBA Anda: ' + pw + ' (username: ' + un + '). Mohon segera ganti di menu Profil.') + '\">' + ic('send') + 'Kirim lewat WhatsApp</a></p>' : '') + '<div class="mact"><button type="button" class="btn btn-soft" data-act="copyPw">' + ic('content_copy') + 'Salin</button><button type="button" class="btn btn-pri" data-act="mclose">Selesai</button></div></div>', 'sm');
}
function userForm(old) {
  const kkopts = [['', '— Tidak terkait KK —']].concat((S.d.kk || []).slice().sort(byName).map(k => [k.id_kk, k.nama_kk]));
  formModal({
    title: old ? 'Ubah Akun' : 'Tambah Akun', values: old || { role: 'warga' },
    fields: (old ? [] : [{ k: 'username', l: 'Username', req: 1, ph: 'huruf kecil, angka, titik', help: '3-30 karakter.' }]).concat([{ k: 'nama', l: 'Nama lengkap', req: 1 }, { k: 'no_wa', l: 'No. WhatsApp (untuk kode lupa sandi)', type: 'tel', ph: '08xxxxxxxxxx', help: 'Opsional. Jika kosong, dipakai nomor WA pada Daftar KK terkait.' }, { k: 'role', l: 'Peran', type: 'select', req: 1, opts: [['warga', 'Warga'], ['bendahara', 'Bendahara'], ['sekretaris', 'Sekretaris'], ['pengurus', 'Pengurus (setara Administrator)'], ['admin', 'Administrator']] }, { k: 'id_kk', l: 'Terkait KK (opsional)', type: 'select', opts: kkopts }, { k: 'status', l: 'Status akun', type: 'select', opts: ['Aktif', 'Nonaktif'] }].filter(f => old || f.k !== 'status')).concat(old ? [] : [{ k: 'sandi', l: 'Sandi awal (opsional)', ph: 'Kosongkan untuk dibuat otomatis', help: 'Minimal 6 karakter.' }]),
    onSubmit: async v => {
      toast('Menyimpan akun…', 'warn');
      if (old) { const r = await srv('penggunaUbah', S.token, old.id_user, { nama: v.nama, role: v.role, id_kk: v.id_kk, status: v.status, no_wa: v.no_wa }); S.d.users = r.users; toast('Akun diperbarui.'); }
      else { const r = await srv('penggunaBuat', S.token, v); S.d.users = r.users; showCred(v.username.toLowerCase(), r.sandi, 'Akun berhasil dibuat'); }
      persist(); renderPage();
    }
  });
}

/* Profil & Menu */
PG.profil = {
  html() {
    const x = S.user;
    return head('Akun Saya', 'Profil') + '<div class="grid2"><section class="card"><div class="prof"><span class="avatar xl">' + ini(x.nama) + '</span><div><h3>' + esc(x.nama) + '</h3><span class="muted">@' + esc(x.username) + '</span><div>' + chip('info', ROLE_LBL[x.role] || x.role) + '</div></div></div><div class="mact left"><button type="button" class="btn btn-pri" data-act="sandi">' + ic('key') + 'Ganti Sandi</button><button type="button" class="btn btn-soft danger" data-act="logout">' + ic('logout') + 'Keluar</button></div></section>' +
      '<section class="card"><div class="card-h"><h3>Tampilan & Aplikasi</h3></div><div class="mact left"><button type="button" class="btn btn-pri" data-act="tampil">' + ic('palette') + 'Atur Warna & Tampilan</button><button type="button" class="btn btn-soft" data-act="theme">' + ic('contrast') + 'Terang / gelap</button><button type="button" class="btn btn-soft" data-act="refresh">' + ic('refresh') + 'Muat ulang data</button></div>' + installBox() + '</section></div>';
  }
};
function installBox() {
  if (matchMedia && matchMedia('(display-mode: standalone)').matches) return '<p class="muted sm">' + ic('check_circle') + ' Aplikasi sudah terpasang di perangkat ini.</p>';
  return '<div class="install"><b>Pasang di HP</b>' + (S.prompt ? '<button type="button" class="btn btn-cyan" data-act="install">' + ic('install_mobile') + 'Pasang Aplikasi SIMBA</button>' : '<p class="muted sm">Android (Chrome): menu ⋮ → <i>Instal aplikasi</i>. iPhone (Safari): Bagikan → <i>Tambah ke Layar Utama</i>. Tombol pasang otomatis muncul bila dibuka lewat halaman PWA SIMBA.</p>') + '</div>';
}
PG.menu = {
  html() {
    const bottom = bnavIds();
    return head('Navigasi', 'Menu') + '<div class="menugrid">' + navVisible().filter(n => bottom.indexOf(n.id) < 0).map(n => '<button type="button" class="menucard" data-act="go" data-p="' + n.id + '">' + ic(n.ic) + '<span>' + esc(n.t) + '</span></button>').join('') +
      '<button type="button" class="menucard" data-act="tampil">' + ic('palette') + '<span>Warna & Tampilan</span></button><button type="button" class="menucard" data-act="theme">' + ic('contrast') + '<span>Terang / Gelap</span></button>' + (S.user ? '<button type="button" class="menucard" data-act="logout">' + ic('logout') + '<span>Keluar</span></button>' : '<button type="button" class="menucard" data-act="login">' + ic('login') + '<span>Masuk</span></button>') + '</div>';
  }
};

/* ---------- 10b. DAFTAR KK: URUTAN, ANGGOTA KELUARGA, KELAHIRAN & KEMATIAN ---------- */
const HUB = ['Kepala Keluarga', 'Suami', 'Istri', 'Anak', 'Cucu', 'Orang Tua', 'Bapak', 'Ibu', 'Mertua', 'Nenek', 'Kakek', 'Menantu', 'Saudara', 'Lainnya'];
const JK = { L: 'Laki-laki', P: 'Perempuan' };
const kelola = id => !!(S.user && (isAdmin() || S.user.id_kk === id));
function usia(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t || ''); if (!m) return '';
  const n = new Date(); let y = n.getFullYear() - m[1], b = n.getMonth() + 1 - m[2]; if (n.getDate() < +m[3]) b--; if (b < 0) { y--; b += 12; }
  return y > 0 ? y + ' th' : (b > 0 ? b + ' bln' : 'baru lahir');
}
function kkPindah(id, pos) {
  const ord = kkOrdered().map(k => k.id_kk), i = ord.indexOf(id); if (i < 0) return;
  pos = Math.max(1, Math.min(ord.length, Math.round(Number(pos) || 0))); if (pos - 1 === i) return;
  ord.splice(i, 1); ord.splice(pos - 1, 0, id);
  const prev = (S.d.kk || []).map(k => [k, k.urutan]);
  ord.forEach((x, n) => { if (IDX.kk[x]) IDX.kk[x].urutan = n + 1; });
  soft(); persist();
  sync(async () => {
    try { const r = await srv('kkUrut', S.token, ord); (r.urutan || []).forEach(u => { if (IDX.kk[u.id_kk]) IDX.kk[u.id_kk].urutan = u.urutan; }); }
    catch (e) { prev.forEach(p => { p[0].urutan = p[1]; }); toast(e.message, 'err'); if (/sesi/i.test(e.message)) sesiHabis(); }
    persist(); soft();
  });
}
function jumlahLokal(id) { const a = (S.d.anggota || []).filter(x => x.id_kk === id); if (a.length && IDX.kk[id]) IDX.kk[id].jumlah_keluarga = a.filter(x => x.status !== 'Meninggal').length; }
function mergeKk(id, r) {
  S.d.anggota = (S.d.anggota || []).filter(a => a.id_kk !== id).concat(r.anggota || []);
  S.d.peristiwa = (S.d.peristiwa || []).filter(a => a.id_kk !== id).concat(r.peristiwa || []);
  if (r.kk && IDX.kk[id]) Object.assign(IDX.kk[id], r.kk);
}
function refreshKk() { if (S.page === 'kk' || S.page === 'beranda') soft(); if (S.kkOpen && $('#kkDet')) kkDetail(S.kkOpen); }
/** Ubah lokal dulu (instan), server menyusul; gagal → dikembalikan. */
function anggotaOp(id, local, call) {
  const snap = { a: (S.d.anggota || []).slice(), p: (S.d.peristiwa || []).slice(), j: (IDX.kk[id] || {}).jumlah_keluarga };
  S.d.anggota = snap.a.slice(); S.d.peristiwa = snap.p.slice(); local(); jumlahLokal(id); refreshKk();
  return sync(async () => {
    try { mergeKk(id, await call()); }
    catch (e) { S.d.anggota = snap.a; S.d.peristiwa = snap.p; if (IDX.kk[id]) IDX.kk[id].jumlah_keluarga = snap.j; toast(e.message, 'err'); if (/sesi/i.test(e.message)) sesiHabis(); }
    persist(); refreshKk();
  });
}
function kkDetail(id) {
  const k = IDX.kk[id]; if (!k) return;
  const boleh = kelola(id), admin = isAdmin();
  const ang = (S.d.anggota || []).filter(a => a.id_kk === id).sort((a, b) => (a.status === 'Meninggal') - (b.status === 'Meninggal') || HUB.indexOf(a.hubungan) - HUB.indexOf(b.hubungan) || String(a.tanggal_lahir).localeCompare(String(b.tanggal_lahir)));
  const per = (S.d.peristiwa || []).filter(a => a.id_kk === id).sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));
  const hidup = ang.filter(a => a.status !== 'Meninggal').length;
  S.kkOpen = id;
  openModal('<div id="kkDet"><div class="mh"><h3>' + esc(k.nama_kk) + '</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><div class="mb">' +
    '<div class="usl-m" style="margin:0 0 4px">' + chip(k.status === 'Aktif' ? 'ok' : 'mute', k.status) + '<span class="pill">No. ' + (RANK[id] || (kkOrdered().findIndex(x => x.id_kk === id) + 1)) + '</span><span class="pill">' + (hidup || k.jumlah_keluarga || 0) + ' jiwa</span>' + (k.no_wa ? '<span class="pill">' + ic('call') + ' ' + esc(k.no_wa) + '</span>' : '') + '</div>' +
    (boleh ? '<div class="mact left" style="margin-top:12px"><button type="button" class="btn btn-pri btn-sm" data-act="angAdd" data-kk="' + esc(id) + '">' + ic('person_add') + 'Tambah Anggota</button><button type="button" class="btn btn-soft btn-sm" data-act="angLahir" data-kk="' + esc(id) + '">' + ic('child_care') + 'Catat Kelahiran</button><button type="button" class="btn btn-soft btn-sm" data-act="angWafat" data-kk="' + esc(id) + '">' + ic('local_florist') + 'Catat Meninggal</button></div>' : '<div class="hint" style="margin-top:12px">' + ic('visibility_off') + '<span>Anggota keluarga hanya terlihat oleh keluarga yang bersangkutan dan Administrator.</span></div>') +
    (boleh ? '<h4 class="sh">' + ic('family_restroom') + 'Anggota Keluarga <span class="muted sm">(opsional)</span></h4>' + (ang.length ? '<ul class="mlist">' + ang.map(a => {
      const gone = a.status === 'Meninggal';
      return '<li class="mem' + (gone ? ' gone' : '') + '"><span class="avatar">' + ini(a.nama) + '</span><div class="li-b"><b>' + esc(a.nama) + '</b><span>' + esc(a.hubungan) + (a.jenis_kelamin ? ' · ' + (JK[a.jenis_kelamin] || '') : '') + (gone ? ' · Wafat ' + tgl(a.tanggal_wafat) : (a.tanggal_lahir ? ' · ' + usia(a.tanggal_lahir) : '')) + '</span></div><div class="rowact">' + (gone ? chip('mute', 'Meninggal') : '') +
        '<button type="button" class="iconbtn sm" data-act="angEdit" data-kk="' + esc(id) + '" data-id="' + esc(a.id) + '" aria-label="Ubah ' + esc(a.nama) + '">' + ic('edit') + '</button>' +
        (gone ? '' : '<button type="button" class="iconbtn sm" data-act="angWafat" data-kk="' + esc(id) + '" data-id="' + esc(a.id) + '" aria-label="Catat meninggal ' + esc(a.nama) + '" title="Catat meninggal">' + ic('local_florist') + '</button>') +
        '<button type="button" class="iconbtn sm danger" data-act="angDel" data-id="' + esc(a.id) + '" aria-label="Hapus ' + esc(a.nama) + '">' + ic('delete') + '</button></div></li>';
    }).join('') + '</ul>' : '<div class="empty" style="padding:20px 8px">' + ic('family_restroom') + '<b>Belum ada anggota dicatat</b><span>Mengisi data ini bersifat opsional.</span></div>') +
    '<h4 class="sh">' + ic('history') + 'Riwayat Kelahiran & Kematian</h4>' + (per.length ? '<ul class="mlist">' + per.map(p => '<li class="mem"><span class="tx-ic ' + (p.jenis === 'Lahir' ? 'in' : 'out') + '">' + ic(p.jenis === 'Lahir' ? 'child_care' : 'local_florist') + '</span><div class="li-b"><b>' + (p.jenis === 'Lahir' ? 'Lahir: ' : 'Meninggal: ') + esc(p.nama) + '</b><span>' + tgl(p.tanggal) + (p.keterangan ? ' · ' + esc(trunc(p.keterangan, 60)) : '') + '</span></div></li>').join('') + '</ul>' : '<p class="muted sm">Belum ada peristiwa tercatat.</p>') : '') +
    (admin && !boleh ? '' : '') + '<div class="mact"><button type="button" class="btn btn-soft" data-act="mclose">Tutup</button></div></div></div>', 'lg');
}
function angForm(idKk, rec) {
  formModal({
    title: rec ? 'Ubah Anggota Keluarga' : 'Tambah Anggota Keluarga', note: kkNama(idKk), values: rec || { hubungan: 'Anak' },
    fields: [{ k: 'nama', l: 'Nama lengkap', req: 1 }, { k: 'hubungan', l: 'Status dalam keluarga', type: 'select', req: 1, opts: HUB }, { k: 'jenis_kelamin', l: 'Jenis kelamin (opsional)', type: 'select', opts: [['', '— Tidak diisi —'], ['L', 'Laki-laki'], ['P', 'Perempuan']] }, { k: 'tanggal_lahir', l: 'Tanggal lahir (opsional)', type: 'date' }, { k: 'keterangan', l: 'Keterangan (opsional)' }],
    onSubmit: async v => {
      kkDetail(idKk);
      if (rec) { const o = Object.assign({ id: rec.id }, v); anggotaOp(idKk, () => { const a = S.d.anggota.find(x => x.id === rec.id); if (a) S.d.anggota[S.d.anggota.indexOf(a)] = Object.assign({}, a, v); }, () => srv('anggotaSimpan', S.token, 'upd', o)); }
      else { const nw = Object.assign({ id: uid('ANG'), id_kk: idKk, status: 'Hidup', tanggal_wafat: '', dicatat_oleh: S.user.nama }, v); anggotaOp(idKk, () => { S.d.anggota.push(nw); }, () => srv('anggotaSimpan', S.token, 'add', nw)); }
    }
  });
}
function lahirForm(idKk) {
  formModal({
    title: 'Catat Kelahiran', note: 'Bayi otomatis ditambahkan sebagai anggota keluarga ' + kkNama(idKk) + '.', values: { tanggal: today(), hubungan: 'Anak' },
    fields: [{ k: 'nama', l: 'Nama bayi', req: 1 }, { k: 'jenis_kelamin', l: 'Jenis kelamin', type: 'select', opts: [['', '— Tidak diisi —'], ['L', 'Laki-laki'], ['P', 'Perempuan']] }, { k: 'tanggal', l: 'Tanggal lahir', type: 'date', req: 1 }, { k: 'hubungan', l: 'Status dalam keluarga', type: 'select', opts: HUB }, { k: 'keterangan', l: 'Keterangan (opsional)' }],
    submit: 'Catat Kelahiran',
    onSubmit: async v => {
      kkDetail(idKk);
      const id = uid('ANG'), a = { id: id, id_kk: idKk, nama: v.nama, hubungan: v.hubungan, jenis_kelamin: v.jenis_kelamin, tanggal_lahir: v.tanggal, status: 'Hidup', tanggal_wafat: '', keterangan: v.keterangan, dicatat_oleh: S.user.nama };
      anggotaOp(idKk, () => { S.d.anggota.push(a); S.d.peristiwa.push({ id: uid('PER'), tanggal: v.tanggal, id_kk: idKk, id_anggota: id, jenis: 'Lahir', nama: v.nama, keterangan: v.keterangan }); }, () => srv('anggotaPeristiwa', S.token, 'Lahir', { id: id, id_kk: idKk, nama: v.nama, jenis_kelamin: v.jenis_kelamin, tanggal: v.tanggal, hubungan: v.hubungan, keterangan: v.keterangan }));
    }
  });
}
function wafatForm(idKk, idAng) {
  const hidup = (S.d.anggota || []).filter(a => a.id_kk === idKk && a.status !== 'Meninggal');
  if (!hidup.length) return toast('Tambahkan data anggota keluarga terlebih dahulu.', 'warn');
  const fields = [];
  if (!idAng) fields.push({ k: 'id_anggota', l: 'Anggota yang meninggal', type: 'select', req: 1, opts: hidup.map(a => [a.id, a.nama + ' (' + a.hubungan + ')']) });
  fields.push({ k: 'tanggal', l: 'Tanggal meninggal', type: 'date', req: 1 }, { k: 'keterangan', l: 'Keterangan (opsional)' });
  formModal({
    title: 'Catat Meninggal', note: (idAng ? ((hidup.find(a => a.id === idAng) || {}).nama || '') + ' · ' : '') + kkNama(idKk) + '. Turut berduka cita.', values: { tanggal: today() }, fields: fields, submit: 'Catat',
    onSubmit: async v => {
      kkDetail(idKk); const aid = idAng || v.id_anggota, a0 = (S.d.anggota || []).find(x => x.id === aid); if (!a0) return;
      anggotaOp(idKk, () => { const j = S.d.anggota.findIndex(x => x.id === aid); if (j >= 0) S.d.anggota[j] = Object.assign({}, S.d.anggota[j], { status: 'Meninggal', tanggal_wafat: v.tanggal }); S.d.peristiwa.push({ id: uid('PER'), tanggal: v.tanggal, id_kk: idKk, id_anggota: aid, jenis: 'Wafat', nama: a0.nama, keterangan: v.keterangan }); }, () => srv('anggotaPeristiwa', S.token, 'Wafat', { id_anggota: aid, tanggal: v.tanggal, keterangan: v.keterangan }));
    }
  });
}

/* ---------- 11. CHROME (header, navigasi, panel samping) ---------- */
function bnavIds() { const v = navVisible().map(n => n.id), a = ['beranda', v.indexOf('iuran') > -1 ? 'iuran' : 'informasi', 'kas', 'notulensi']; return a; }
function renderChrome() {
  const R = hitung(), vis = navVisible();
  $('#nav').innerHTML = vis.map(n => '<button type="button" class="navitem' + (S.page === n.id ? ' on' : '') + '" data-act="go" data-p="' + n.id + '"' + (S.page === n.id ? ' aria-current="page"' : '') + '>' + ic(n.ic) + '<span>' + esc(n.t) + '</span></button>').join('');
  $('#agendaCard').innerHTML = pertemuanCard();
  $('#side').innerHTML = saldoCard(R) + aksiBtns() + txCard(R);
  const ids = bnavIds(), items = ids.map(id => NAV.find(n => n.id === id)).filter(Boolean);
  $('#bnav').innerHTML = items.map(n => '<button type="button" class="bn' + (S.page === n.id ? ' on' : '') + '" data-act="go" data-p="' + n.id + '">' + ic(n.ic) + '<span>' + esc(n.t.replace(' RT', '')) + '</span></button>').join('') + '<button type="button" class="bn' + (S.page === 'menu' || (vis.some(n => n.id === S.page) && ids.indexOf(S.page) < 0) ? ' on' : '') + '" data-act="go" data-p="menu">' + ic('apps') + '<span>Menu</span></button>';
  $('#topUser').innerHTML = S.user ? '<button type="button" class="userbtn" data-act="go" data-p="profil" aria-label="Profil"><span class="avatar sm">' + ini(S.user.nama) + '</span><span class="ub-t"><b>' + esc(S.user.nama) + '</b><small>' + esc(S.user.role) + '</small></span></button>' : '<button type="button" class="btn btn-pri" data-act="login">' + ic('login') + '<span class="hide-s">Masuk</span></button>';
  const n = bellItems().length, b = $('#bell'); if (b) b.classList.toggle('dot', n > 0);
  $('#brandRt').textContent = (S.cfg && S.cfg.nama_rt) || 'RT.06 RW.01 Bangsri';
  pend();
}
function renderPage() {
  const pg = PG[S.page] || PG.beranda;
  $('#view').innerHTML = (!S.user && !(S.d.pengurus || S.d.notulensi) && !S.ready) ? skeleton() : pg.html();
  const g = $('#gres'); if (g) g.classList.remove('on');
}
function skeleton() { return '<div class="skel h1"></div><div class="skel banner-s"></div><div class="grid4"><div class="skel c"></div><div class="skel c"></div><div class="skel c"></div><div class="skel c"></div></div>'; }
function render() { renderChrome(); renderPage(); }
function go(p, o) {
  if (!allowed(p)) p = 'beranda';
  S.page = p; if (o && o.q !== undefined) U(p).q = o.q;
  renderChrome(); renderPage(); window.scrollTo(0, 0);
  try { history.pushState({ p: p }, ''); } catch (e) { /* iframe tertentu */ }
}
function updList() { const l = PG[S.page] && PG[S.page].list, el = $('#lst'); if (l && el) { const h = l(); if (h !== null) el.innerHTML = h; } }

/* Notifikasi lonceng (di dalam aplikasi, tanpa email) */
function bellItems() {
  const seen = store.get('simba.seen') || today(), r = [];
  (S.d.notulensi || []).forEach(n => { if (n.tanggal_pertemuan > seen) r.push({ i: 'menu_book', t: 'Notulensi baru', x: n.tempat_pertemuan || '', d: n.tanggal_pertemuan, p: 'notulensi' }); });
  (S.d.informasi || []).forEach(n => { if (n.tanggal > seen) r.push({ i: 'info', t: n.judul, x: 'Informasi warga', d: n.tanggal, p: 'informasi' }); });
  if (S.user) (S.d.usulan || []).forEach(n => { if (n.tanggal > seen) r.push({ i: 'campaign', t: n.judul, x: 'Usulan fasilitas baru', d: n.tanggal, p: 'usulan' }); });
  return r;
}
function gsearch(q) {
  q = String(q || '').trim().toLowerCase(); if (q.length < 2) return [];
  const r = [];
  if (can('kk', 'L')) (S.d.kk || []).filter(k => k.nama_kk.toLowerCase().indexOf(q) > -1).slice(0, 4).forEach(k => { r.push({ i: 'badge', t: k.nama_kk, s: 'Daftar KK', p: 'kk', q: k.nama_kk }); if (can('jimpitan', 'L')) r.push({ i: 'payments', t: 'Iuran ' + k.nama_kk, s: 'Iuran', p: 'iuran', q: k.nama_kk }); });
  (S.d.notulensi || []).filter(n => (n.hasil_pembahasan + ' ' + n.tempat_pertemuan).toLowerCase().indexOf(q) > -1).slice(0, 3).forEach(n => r.push({ i: 'menu_book', t: 'Notulensi ' + tgl(n.tanggal_pertemuan), s: n.tempat_pertemuan || 'Notulensi', p: 'notulensi', q: q }));
  return r.slice(0, 8);
}

/* ---------- 12. AKSI (delegasi klik) ---------- */
const byId = (k, id) => (S.d[k] || []).find(x => (x.id || x.id_kk || x.id_periode) === id);
const ACT = {
  go(t) { go(t.dataset.p); },
  login() { $('#loginView').classList.add('on'); setTimeout(() => $('#lu').focus(), 60); },
  logout() { logout(); },
  mclose() { closeModal(); },
  mback(t, e) { if (e.target === t) closeModal(); },
  cfYes() { const f = S.cf; S.cf = null; closeModal(); if (f) f(true); },
  cfNo() { closeModal(); },
  theme() { setMode(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); refreshTampil(); },
  tampil() { tampilModal(); },
  mode(t) { setMode(t.dataset.m); refreshTampil(); },
  accent(t) { applyAccent(t.dataset.c); refreshTampil(); },
  kasTab(t) { U('kas').tab = t.dataset.t; renderPage(); },
  /* Daftar KK: urutan, anggota keluarga, kelahiran, kematian */
  kkDetail(t) { kkDetail(t.dataset.id); },
  kkUp(t) { kkPindah(t.dataset.id, (RANK[t.dataset.id] || 1) - 1); },
  kkDown(t) { kkPindah(t.dataset.id, (RANK[t.dataset.id] || 1) + 1); },
  kkNo(t) { const id = t.dataset.id; formModal({ title: 'Pindahkan Nomor', note: kkNama(id) + ' saat ini nomor ' + (RANK[id] || '–') + '.', fields: [{ k: 'pos', l: 'Pindah ke nomor', type: 'number', min: 1, req: 1 }], values: { pos: RANK[id] }, submit: 'Pindahkan', onSubmit: async v => kkPindah(id, v.pos) }); },
  angAdd(t) { angForm(t.dataset.kk); },
  angEdit(t) { angForm(t.dataset.kk, (S.d.anggota || []).find(a => a.id === t.dataset.id)); },
  async angDel(t) { const a = (S.d.anggota || []).find(x => x.id === t.dataset.id); if (!a) return; closeModal(); if (!(await askConfirm('Hapus anggota "' + a.nama + '" dari data keluarga?', { danger: true, ok: 'Hapus' }))) return kkDetail(a.id_kk); kkDetail(a.id_kk); anggotaOp(a.id_kk, () => { S.d.anggota = S.d.anggota.filter(x => x.id !== a.id); }, () => srv('anggotaSimpan', S.token, 'del', { id: a.id })); },
  angLahir(t) { lahirForm(t.dataset.kk); },
  angWafat(t) { wafatForm(t.dataset.kk, t.dataset.id); },
  async kocokanDel(t) {
    const k = (S.d.kocokan || []).find(x => x.id === t.dataset.id); if (!k) return;
    if (!(await askConfirm('Hapus catatan kocokan "' + kkNama(k.id_kk_terpilih) + '"? Bila pemenang menolak, KK ini kembali berstatus Belum dan dapat dikocok lagi.', { danger: true, ok: 'Hapus' }))) return;
    try { const r = await srv('undianHapus', S.token, k.id); S.d.giliran = r.giliran; S.d.kocokan = r.kocokan; const u = U('undian'); if (u.hasil && u.hasil.nama === kkNama(k.id_kk_terpilih)) u.hasil = null; persist(); renderPage(); renderChrome(); toast('Catatan kocokan dihapus.'); } catch (e) { toast(e.message, 'err'); }
  },
  bell() {
    const it = bellItems();
    openModal('<div class="mh"><h3>Pemberitahuan</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><div class="mb">' + (it.length ? '<ul class="list">' + it.map(x => '<li class="li"><span class="avatar">' + ic(x.i) + '</span><div class="li-b"><b>' + esc(x.t) + '</b><span>' + esc(x.x) + ' · ' + tgl(x.d) + '</span></div><button type="button" class="btn btn-soft btn-sm" data-act="bellGo" data-p="' + x.p + '">Buka</button></li>').join('') + '</ul>' : empty('notifications_off', 'Tidak ada pemberitahuan baru')) + '</div>', 'sm');
    store.set('simba.seen', today()); renderChrome();
  },
  bellGo(t) { closeModal(); go(t.dataset.p); },
  gsel(t) { go(t.dataset.p, { q: t.dataset.q }); $('#gq').value = ''; },
  agenda() { const m = nextMeet(); if (!m) return; openModal('<div class="mh"><h3>Agenda Pertemuan RT</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><div class="mb"><dl class="dl"><dt>Tanggal</dt><dd>' + tgl(m.tanggal) + '</dd><dt>Jam</dt><dd>' + esc(m.jam || '–') + '</dd><dt>Tempat</dt><dd>' + esc(m.tempat || '–') + '</dd><dt>Agenda</dt><dd>' + esc(m.agenda || '–').replace(/\n/g, '<br>') + '</dd></dl></div>', 'sm'); },
  /* CRUD generik */
  crudAdd(t) { crudForm(t.dataset.n); },
  crudEdit(t) { const c = CRUD[t.dataset.n]; crudForm(t.dataset.n, (S.d[c.key] || []).find(x => x[c.idf || 'id'] === t.dataset.id)); },
  async crudDel(t) { const c = CRUD[t.dataset.n]; if (await askConfirm('Hapus data ini? Tindakan tercatat di log dan tidak dapat dibatalkan.', { danger: true, ok: 'Hapus' })) { const o = {}; o[c.idf || 'id'] = t.dataset.id; mutate(c.tabel, 'del', o); } },
  perToggle(t) { const p = IDX.per[t.dataset.id]; if (p) mutate('PeriodeIuran', 'upd', { id_periode: p.id_periode, status: p.status === 'Buka' ? 'Tutup' : 'Buka' }); },
  /* Iuran */
  iuranTab(t) { const u = U('iuran'); u.tab = t.dataset.t; u.q = ''; u.st = ''; renderPage(); },
  berTab(t) { U('beranda').j = t.dataset.j; renderPage(); },
  iuranCatat(t) { iuranForm(t.dataset.j, t.dataset.per, t.dataset.kk); },
  iuranEdit(t) { const key = t.dataset.j === 'Jimpitan' ? 'jimpitan' : 'agustusan'; iuranForm(t.dataset.j, (byId(key, t.dataset.id) || {}).id_periode, '', byId(key, t.dataset.id)); },
  async iuranDel(t) { if (await askConfirm('Hapus catatan iuran ini?', { danger: true, ok: 'Hapus' })) mutate(t.dataset.j === 'Jimpitan' ? 'IuranJimpitan' : 'IuranAgustusan', 'del', { id: t.dataset.id }); },
  pdfIuran(t) { if (!t.dataset.per) return toast('Belum ada periode.', 'warn'); pdf('rekapIuran', { id_periode: t.dataset.per }); },
  /* Kas */
  kasAdd() { kasForm(); },
  kasEdit(t) { kasForm(byId('kas', t.dataset.id)); },
  async kasDel(t) { if (await askConfirm('Hapus transaksi kas ini? Saldo akan dihitung ulang.', { danger: true, ok: 'Hapus' })) mutate('KasRT', 'del', { id: t.dataset.id }); },
  async bukti(t) { toast('Memuat bukti…', 'warn'); try { showFile(await srv('lihatBukti', S.token, t.dataset.b)); } catch (e) { toast(e.message, 'err'); } },
  pdfKas() { const u = U('kas'); pdf('rekapKas', S.user ? { dari: u.dari, sampai: u.sampai } : {}); },
  /* Undian */
  kocok() { kocok(); },
  undianManual() {
    const g = (S.d.giliran || []).filter(x => x.status === 'Belum'); if (!g.length) return toast('Tidak ada KK yang belum mendapat giliran.', 'warn');
    formModal({ title: 'Catat Hasil Undian Manual', note: 'Gunakan jika undian dikocok langsung saat pertemuan.', fields: [{ k: 'id_kk', l: 'KK terpilih', type: 'select', req: 1, opts: g.map(x => [x.id_kk, kkNama(x.id_kk)]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))) }, { k: 'tanggal', l: 'Tanggal', type: 'date', req: 1 }, { k: 'ket', l: 'Keterangan (opsional)' }], values: { tanggal: today() }, onSubmit: async v => { const r = await srv('undianManual', S.token, v.id_kk, v.ket, v.tanggal); S.d.giliran = r.giliran; (S.d.kocokan = S.d.kocokan || []).push(r.kocokan); U('undian').hasil = { nama: kkNama(v.id_kk), tgl: v.tanggal }; persist(); renderPage(); toast('Hasil undian manual tersimpan.'); } });
  },
  async undianReset() { if (await askConfirm('Reset putaran? Semua KK kembali berstatus Belum mendapat giliran.', { danger: true, ok: 'Reset' })) { try { S.d.giliran = (await srv('undianReset', S.token)).giliran; U('undian').hasil = null; persist(); renderPage(); toast('Putaran direset.'); } catch (e) { toast(e.message, 'err'); } } },
  async undianIsi() { try { const r = await srv('undianIsi', S.token); S.d.giliran = r.giliran; persist(); renderPage(); toast(r.tambah + ' KK ditambahkan ke daftar giliran.'); } catch (e) { toast(e.message, 'err'); } },
  /* Notulensi */
  notAdd() { notForm(); },
  notEdit(t) { notForm(byId('notulensi', t.dataset.id)); },
  async notDel(t) { if (await askConfirm('Hapus notulensi ini?', { danger: true, ok: 'Hapus' })) mutate('Notulensi', 'del', { id: t.dataset.id }); },
  notView(t) { const n = byId('notulensi', t.dataset.id); if (!n) return; openModal('<div class="mh"><h3>Notulensi ' + tgl(n.tanggal_pertemuan) + '</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><div class="mb"><p class="muted">' + ic('place') + esc(n.tempat_pertemuan || '–') + '</p><div class="prose">' + esc(n.hasil_pembahasan).replace(/\n/g, '<br>') + '</div><div class="mact"><button type="button" class="btn btn-soft" data-act="notPdf" data-id="' + esc(n.id) + '">' + ic('picture_as_pdf') + 'Cetak PDF</button></div></div>', 'lg'); },
  notPdf(t) { pdf('notulensi', { id: t.dataset.id }); },
  kontenTab(t) { const u = U('informasi'); u.tab = t.dataset.t; u.q = ''; renderPage(); },
  /* Usulan */
  usulanAdd() { formModal({ title: 'Buat Usulan Fasilitas', fields: [{ k: 'judul', l: 'Judul usulan', req: 1 }, { k: 'uraian', l: 'Uraian', type: 'textarea', req: 1, rows: 5 }], onSubmit: async v => mutate('UsulanFasilitas', 'add', { id: uid('USL'), tanggal: today(), id_user: S.user.id_user, judul: v.judul, uraian: v.uraian, status: 'Baru', tanggapan: '', pengusul: isAdmin() ? S.user.nama : undefined }) }); },
  usulanTanggap(t) { const x = byId('usulan', t.dataset.id); formModal({ title: 'Tanggapi Usulan', note: x.judul, values: x, fields: [{ k: 'status', l: 'Status', type: 'select', opts: ['Baru', 'Diproses', 'Selesai'] }, { k: 'tanggapan', l: 'Tanggapan', type: 'textarea' }], onSubmit: async v => mutate('UsulanFasilitas', 'upd', { id: x.id, status: v.status, tanggapan: v.tanggapan }) }); },
  async usulanDel(t) { if (await askConfirm('Hapus usulan ini?', { danger: true, ok: 'Hapus' })) mutate('UsulanFasilitas', 'del', { id: t.dataset.id }); },
  /* CRM */
  crmTab(t) { const u = U('crm'); u.tab = t.dataset.t; renderPage(); },
  async crmSync() { try { toast('Menyinkronkan kontak…', 'warn'); const r = await srv('crmSync', S.token); S.d.crm = r.kontak; persist(); renderPage(); toast(r.baru + ' kontak baru, ' + r.ubah + ' diperbarui.'); } catch (e) { toast(e.message, 'err'); } },
  async crmCek() { try { toast('Memeriksa nomor WhatsApp…', 'warn'); const r = await srv('crmCekWa', S.token); S.d.crm = r.kontak; persist(); renderPage(); toast(r.dicek + ' nomor diperiksa.'); } catch (e) { toast(e.message, 'err'); } },
  crmEdit(t) { const k = byId('crm', t.dataset.id); formModal({ title: 'Ubah Kontak', note: k.nama, values: k, fields: [{ k: 'no_wa', l: 'No. WhatsApp', type: 'tel' }, { k: 'tag', l: 'Tag (opsional)', ph: 'mis. ronda, panitia' }, { k: 'catatan', l: 'Catatan', type: 'textarea', rows: 3 }, { k: 'opt_out', l: 'Opt-out (tidak mau menerima pesan)', type: 'checkbox' }], onSubmit: async v => { const r = await srv('crmUbah', S.token, k.id, { no_wa: v.no_wa, tag: v.tag, catatan: v.catatan, opt_out: v.opt_out ? 'YA' : '' }); S.d.crm = r.kontak; persist(); renderPage(); toast('Kontak diperbarui.'); } }); },
  async crmKirim() {
    const u = U('crm'), n = crmPenerima(u).length;
    if (!n) return toast('Tidak ada penerima.', 'warn'); if (String(u.cp || '').trim().length < 3) return toast('Isi pesan terlebih dahulu.', 'warn');
    if (!(await askConfirm('Antrikan pesan ke ' + n + ' penerima? Pengiriman berjalan bertahap di latar belakang.', { ok: 'Antrikan' }))) return;
    try { const r = await srv('crmKirim', S.token, { sasaran: u.sas, id_periode: u.cper, judul: u.cj, pesan: u.cp }); S.d.blast = r.blast; S.d.antrian = r.antrian; u.cp = ''; u.tab = 'riwayat'; persist(); renderPage(); toast(r.total + ' pesan masuk antrean.'); } catch (e) { toast(e.message, 'err'); }
  },
  async crmRefresh() { try { const r = await srv('crmMuat', S.token); S.d.blast = r.blast; S.d.antrian = r.antrian; S.d.crm = r.crm; persist(); renderPage(); } catch (e) { toast(e.message, 'err'); } },
  /* Pengguna */
  penTab(t) { const u = U('pengguna'); u.tab = t.dataset.t; renderPage(); },
  userAdd() { userForm(); },
  userEdit(t) { userForm((S.d.users || []).find(x => x.id_user === t.dataset.id)); },
  async userReset(t) { const x = (S.d.users || []).find(y => y.id_user === t.dataset.id); if (!(await askConfirm('Reset sandi akun ' + x.username + '? Sandi baru dibuat otomatis.', { ok: 'Reset' }))) return; try { const r = await srv('penggunaReset', S.token, x.id_user); if (r.reset) S.d.reset = r.reset; persist(); showCred(r.username, r.sandi, 'Sandi direset', r.nama, r.no_wa); } catch (e) { toast(e.message, 'err'); } },
  async userDel(t) { const x = (S.d.users || []).find(y => y.id_user === t.dataset.id); if (!(await askConfirm('Hapus akun ' + x.username + '?', { danger: true, ok: 'Hapus' }))) return; try { S.d.users = (await srv('penggunaHapus', S.token, x.id_user)).users; persist(); renderPage(); toast('Akun dihapus.'); } catch (e) { toast(e.message, 'err'); } },
  resetBuka() { U('pengguna').tab = 'reset'; go('pengguna'); },
  async resetBuat(t) { const x = (S.d.users || []).find(y => y.id_user === t.dataset.id); if (!x) return toast('Akun tidak ditemukan.', 'err'); if (!(await askConfirm('Buat sandi sementara untuk ' + x.username + '?', { ok: 'Buat' }))) return; try { const r = await srv('penggunaReset', S.token, x.id_user); S.d.reset = r.reset || []; persist(); renderPage(); showCred(r.username, r.sandi, 'Sandi sementara dibuat', r.nama, r.no_wa); } catch (e) { toast(e.message, 'err'); } },
  async resetTutup(t) { try { S.d.reset = (await srv('resetSandiTutup', S.token, t.dataset.id)).reset; persist(); renderPage(); } catch (e) { toast(e.message, 'err'); } },
  copyPw() { const p = $('#pwv'); if (p && navigator.clipboard) navigator.clipboard.writeText(p.textContent).then(() => toast('Disalin.')).catch(() => toast('Salin manual.', 'warn')); },
  setEdit() {
    const c = S.cfg || {}, m = (() => { try { return JSON.parse(c.matriks || '{}'); } catch (e) { return {}; } })();
    formModal({
      title: 'Pengaturan Aplikasi', cls: 'lg', values: { nama_rt: c.nama_rt, jimpitan_kas: c.jimpitan_kas || '0', wa_aktif: c.wa_aktif || '0', batch: c.batch || 10 },
      fields: [{ k: 'nama_rt', l: 'Nama RT (untuk laporan PDF)', req: 1 }, { k: 'jimpitan_kas', l: 'Pemasukan Jimpitan ke Kas RT', type: 'select', opts: [['0', 'Manual (dicatat Bendahara)'], ['1', 'Otomatis saat iuran dicatat']] }, { k: 'wa_aktif', l: 'Notifikasi WhatsApp', type: 'select', opts: [['0', 'Nonaktif'], ['1', 'Aktif']] }, { k: 'token_fonnte', l: 'Token Fonnte', type: 'password', ph: c.token_mask || 'Belum diisi', help: 'Kosongkan jika tidak diubah. Disimpan aman di Script Properties.' }, { k: 'batch', l: 'Jumlah pesan per menit', type: 'number', min: 1 }].concat((c.events || []).map(e => ({ k: 'ev_' + e.k, l: 'Kirim otomatis: ' + e.label, type: 'checkbox', def: m[e.k] ? '1' : '' }))),
      onSubmit: async v => { const mx = {}; (c.events || []).forEach(e => { mx[e.k] = !!v['ev_' + e.k]; }); S.cfg = await srv('pengaturanSimpan', S.token, { nama_rt: v.nama_rt, jimpitan_kas: v.jimpitan_kas, wa_aktif: v.wa_aktif, batch: v.batch, token_fonnte: v.token_fonnte, matriks: mx }); persist(); render(); toast('Pengaturan disimpan.'); }
    });
  },
  async trig(t) { try { S.cfg = await srv('triggerAtur', S.token, t.dataset.on === '1'); persist(); renderPage(); toast(S.cfg.trigger ? 'Pengiriman otomatis dipasang.' : 'Pengiriman otomatis dimatikan.'); } catch (e) { toast(e.message + ' (jalankan pasangTrigger() sekali dari editor jika diminta izin).', 'err'); } },
  async mgJalan(t) {
    const u = U('pengguna'), src = ($('#mgSrc') || {}).value, dry = t.dataset.dry === '1'; u.src = src;
    if (!dry && !(await askConfirm('Impor data dari spreadsheet lama? Data yang sudah ada dicocokkan berdasarkan ID (tidak ada duplikat).', { ok: 'Impor' }))) return;
    toast(dry ? 'Memindai…' : 'Mengimpor…', 'warn');
    try {
      const r = await srv('migrasiJalankan', S.token, src, dry, []);
      u.mg = '<div class="tblwrap"><table class="tbl"><thead><tr><th>Tabel</th><th class="ta-r">Sumber</th><th class="ta-r">Tambah</th><th class="ta-r">Ubah</th><th class="ta-r">Lewati</th></tr></thead><tbody>' + Object.keys(r.hasil).map(k => { const h = r.hasil[k]; return h.ada ? '<tr><td data-label="Tabel">' + esc(k) + '</td><td data-label="Sumber" class="ta-r">' + h.sumber + '</td><td data-label="Tambah" class="ta-r">' + h.tambah + '</td><td data-label="Ubah" class="ta-r">' + h.ubah + '</td><td data-label="Lewati" class="ta-r">' + h.lewat + '</td></tr>' : '<tr><td data-label="Tabel">' + esc(k) + '</td><td colspan="4" class="muted">Tidak ada di spreadsheet lama</td></tr>'; }).join('') + '</tbody></table></div><p class="muted sm">' + (dry ? 'Uji coba: belum ada data yang ditulis.' : 'Impor selesai. Muat ulang data untuk melihat hasil.') + '</p>';
      renderPage(); if (!dry) { toast('Impor selesai.'); ACT.refresh(); }
    } catch (e) { toast(e.message, 'err'); }
  },
  /* Profil */
  sandi() { formModal({ title: 'Ganti Sandi', fields: [{ k: 'lama', l: 'Sandi lama', type: 'password', req: 1 }, { k: 'baru', l: 'Sandi baru', type: 'password', req: 1, help: 'Minimal 6 karakter.' }], onSubmit: async v => { await srv('gantiSandi', S.token, v.lama, v.baru); toast('Sandi berhasil diganti.'); } }); },
  async install() { const p = window._pwaPrompt; if (!p) { toast('Gunakan menu browser: Tambahkan ke layar utama.', 'warn'); return; } p.prompt(); try { await p.userChoice; } catch (e) { /* diabaikan */ } window._pwaPrompt = null; S.prompt = false; renderPage(); },
  async refresh() { try { const r = await srv('bootstrap', S.token); const tk = S.token; apply(r, tk); persist(); render(); toast('Data diperbarui.'); } catch (e) { toast(e.message, 'err'); } }
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'A' && !t.hasAttribute('download')) e.preventDefault();
  const f = ACT[t.dataset.act]; if (f) f(t, e);
});
document.addEventListener('input', e => {
  const t = e.target; if (!t.dataset || !t.dataset.f) return;
  U()[t.dataset.f] = t.value;
  clearTimeout(S.dt);
  S.dt = setTimeout(() => { if (t.dataset.full === '1') renderPage(); else if (t.dataset.f === 'q' && S.page === 'beranda') { const el = $('#lst'); if (el) { const u = U('beranda'), per = periodeAktif(u.j || 'Jimpitan'); let rows = rekapRows(u.j || 'Jimpitan', per ? per.id_periode : ''); const q = String(u.q || '').toLowerCase(); if (q) rows = rows.filter(r => r.kk.nama_kk.toLowerCase().indexOf(q) > -1); el.innerHTML = rekapTbl(rows, u.j || 'Jimpitan', per ? per.id_periode : '', 8); } } else updList(); }, t.type === 'search' || t.type === 'text' ? 120 : 0);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); const g = $('#gres'); if (g) g.classList.remove('on'); $('#loginView').classList.remove('on'); } });
document.addEventListener('input', e => { if (e.target && e.target.id === 'accCustom') { applyAccent(e.target.value); refreshTampil(true); } });
/* geser baris Daftar KK (komputer) */
let dragId = null;
const rowOf = e => e.target && e.target.closest ? e.target.closest('tr[data-kkid]') : null;
const clrDrag = () => $$('tr.dragging,tr.dragover').forEach(x => x.classList.remove('dragging', 'dragover'));
document.addEventListener('dragstart', e => { const tr = rowOf(e); if (!tr) return; dragId = tr.dataset.kkid; tr.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* diabaikan */ } });
document.addEventListener('dragover', e => { const tr = rowOf(e); if (!tr || !dragId) return; e.preventDefault(); $$('tr.dragover').forEach(x => x.classList.remove('dragover')); if (tr.dataset.kkid !== dragId) tr.classList.add('dragover'); });
document.addEventListener('drop', e => { const tr = rowOf(e); if (!tr || !dragId) return; e.preventDefault(); const from = dragId, to = tr.dataset.kkid; dragId = null; clrDrag(); if (from !== to) kkPindah(from, RANK[to]); });
document.addEventListener('dragend', () => { dragId = null; clrDrag(); });
window.addEventListener('popstate', e => { const p = e.state && e.state.p; if (p && allowed(p)) { S.page = p; renderChrome(); renderPage(); } else if (!p) { S.page = 'beranda'; renderChrome(); renderPage(); } });

/* ---------- 13. AUTENTIKASI, TEMA, PWA ---------- */
function apply(r, tk) {
  S.token = r.user ? tk : null; S.user = r.user; S.perm = r.perm || {}; S.pubPerm = r.pubPerm || S.pubPerm; S.d = r.d || {}; S.ringkasan = r.ringkasan; S.cfg = r.cfg || {};
  rebuild(); if (S.user) recalcKas();
}
function sesiHabis() { tokS.del(); toVisitor(); toast('Sesi berakhir. Silakan masuk kembali.', 'warn'); }
function toVisitor() {
  const R = hitung(), keep = ['pengurus', 'darurat', 'informasi', 'notulensi', 'pertemuan'], d = {};
  keep.forEach(k => d[k] = S.d[k] || []);
  S.ringkasan = Object.assign({}, R, { tx: (R.tx || []).map(t => ({ id: t.id, tanggal: t.tanggal, jenis: t.jenis, jumlah: t.jumlah, keterangan: t.jenis === 'Masuk' ? 'Kas masuk' : t.keterangan })) });
  S.d = d; S.user = null; S.token = null; S.perm = S.pubPerm || {}; S.ui = {}; S.page = 'beranda'; rebuild(); persist(); render();
}
function logout() {
  tokS.del(); toVisitor(); toast('Anda sudah keluar.');
  srv('bootstrap', null).then(r => { if (!S.user) { apply(r, null); persist(); render(); } }).catch(() => { });
}
function lupaSandi() {
  openModal('<div class="mh"><h3>Lupa Sandi</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><div class="mb" id="lupaBody"></div>', 'sm');
  const m = $('.mback'); if (m) m.classList.add('top');
  lupaLangkah1($('#lu').value.trim());
}
function lupaLangkah1(un) {
  const b = $('#lupaBody');
  b.innerHTML = '<p class="help note">Masukkan username Anda. Kode 6 digit dikirim ke WhatsApp yang terdaftar, dan pengurus RT juga diberi tahu.</p><form id="lupaF1" novalidate><div class="field"><label for="lupaU">Username</label><input id="lupaU" class="inp" autocapitalize="none" spellcheck="false" autocomplete="username" value="' + esc(un || '') + '" required></div><div class="field"><label for="lupaC">Catatan untuk pengurus (opsional)</label><input id="lupaC" class="inp" maxlength="140" placeholder="mis. nomor WA saya sudah ganti"></div><div class="lerr" id="lupaE" role="alert"></div><div class="mact"><button type="button" class="btn btn-soft" id="lupaAda">Saya sudah punya kode</button><button type="submit" class="btn btn-pri" id="lupaGo">Kirim permintaan</button></div></form>';
  $('#lupaAda').onclick = () => lupaLangkah2($('#lupaU').value.trim(), '');
  $('#lupaF1').onsubmit = async e => {
    e.preventDefault(); const u = $('#lupaU').value.trim(), g = $('#lupaGo'); if (!u) { $('#lupaE').textContent = 'Isi username.'; return; }
    g.disabled = true; g.textContent = 'Mengirim…'; $('#lupaE').textContent = '';
    try { const r = await srv('lupaSandiMinta', u, $('#lupaC').value.trim()); lupaLangkah2(u, r.pesan); }
    catch (er) { $('#lupaE').textContent = er.message; g.disabled = false; g.textContent = 'Kirim permintaan'; }
  };
}
function lupaLangkah2(un, pesan) {
  const b = $('#lupaBody');
  b.innerHTML = (pesan ? '<p class="help note">' + esc(pesan) + '</p>' : '') + '<form id="lupaF2" novalidate><div class="field"><label for="lupaU2">Username</label><input id="lupaU2" class="inp" autocapitalize="none" value="' + esc(un) + '" required></div><div class="field"><label for="lupaK">Kode 6 digit dari WhatsApp</label><input id="lupaK" class="inp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div><div class="field"><label for="lupaP">Sandi baru</label><input id="lupaP" class="inp" type="password" autocomplete="new-password" minlength="6" required></div><div class="field"><label for="lupaP2">Ulangi sandi baru</label><input id="lupaP2" class="inp" type="password" autocomplete="new-password" required></div><div class="lerr" id="lupaE" role="alert"></div><p class="muted sm">Tidak menerima kode? Pengurus RT sudah diberi tahu dan akan memberikan sandi sementara lewat WhatsApp.</p><div class="mact"><button type="button" class="btn btn-soft" id="lupaBack">Kembali</button><button type="submit" class="btn btn-pri" id="lupaSet">Simpan sandi baru</button></div></form>';
  $('#lupaBack').onclick = () => lupaLangkah1($('#lupaU2').value.trim());
  $('#lupaF2').onsubmit = async e => {
    e.preventDefault(); const er = $('#lupaE'), g = $('#lupaSet'), p = $('#lupaP').value; er.textContent = '';
    if (p.length < 6) { er.textContent = 'Sandi baru minimal 6 karakter.'; return; }
    if (p !== $('#lupaP2').value) { er.textContent = 'Pengulangan sandi tidak sama.'; return; }
    g.disabled = true; g.textContent = 'Menyimpan…';
    try { const u = $('#lupaU2').value.trim(); await srv('lupaSandiSetel', u, $('#lupaK').value.trim(), p); closeModal(); $('#lu').value = u; $('#lp').value = ''; toast('Sandi diganti. Silakan masuk dengan sandi baru.'); $('#lp').focus(); }
    catch (x) { er.textContent = x.message; g.disabled = false; g.textContent = 'Simpan sandi baru'; }
  };
}
async function doLogin(e) {
  e.preventDefault();
  const err = $('#lerr'), b = $('#lbtn'); err.textContent = ''; b.disabled = true; b.innerHTML = 'Memverifikasi…';
  try {
    const r = await srv('login', $('#lu').value, $('#lp').value);
    tokS.set(r.token, $('#lr').checked); apply(r.boot, r.token); persist();
    $('#loginView').classList.remove('on'); $('#lp').value = ''; S.ui = {}; go('beranda'); toast('Selamat datang, ' + r.boot.user.nama + '!');
  } catch (er) { err.textContent = er.message; }
  b.disabled = false; b.innerHTML = 'Masuk ' + ic('arrow_forward');
}
/* ---- Tema: mode terang/gelap/otomatis + warna aksen yang bisa diatur ---- */
const PRESET = [['Biru', '#4361EE'], ['Koral', '#E0604F'], ['Hijau', '#12805C'], ['Tosca', '#0E7C86'], ['Ungu', '#6D4AE0'], ['Oranye', '#C2410C'], ['Mawar', '#C72C6B'], ['Grafit', '#475569']];
const DEF_ACC = '#4361EE';
const h2rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
const rgb2h = r => '#' + r.map(v => ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2)).join('');
function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s * 100, l * 100]; }
function hsl2rgb(h, s, l) { h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
const hsl = (h, s, l) => rgb2h(hsl2rgb(h, s, l));
const hslOf = hex => rgb2hsl.apply(null, h2rgb(hex));
function lum(r) { const c = r.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
function contrast(a, b) { const x = lum(h2rgb(a)), y = lum(h2rgb(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
/** Geser kecerahan sampai kontras terhadap latar >= min (dir<0 menggelapkan, dir>0 menerangkan). */
function fitL(h, s, l, bg, min, dir) { let k = 0; while (k++ < 70 && contrast(hsl(h, s, l), bg) < min && l > 0 && l < 100) l += dir; return hsl(h, s, l); }
function accentCSS(hex) {
  const hh = hslOf(hex), h = hh[0], s = Math.max(35, Math.min(hh[1], 92)), T = Math.max(18, Math.min(hh[1], 100));
  const P = fitL(h, s, hh[2], '#ffffff', 4.6, -1.5), ph = hslOf(P), pl = ph[2];
  const Pd = hsl(h, s, pl - 9), Pm = hsl(h, s, pl - 4);
  const ah = (h >= 150 && h <= 270) ? h - 32 : h + 32, as = Math.max(70, Math.min(s, 95));
  const A = hsl(ah, as, 56), Ag = fitL(ah, as, 56, '#ffffff', 3, -1.5);
  const onA = contrast(A, '#0A1A28') >= contrast(A, '#ffffff') ? '#0A1A28' : '#ffffff';
  const pt = fitL(h, s, pl, '#ffffff', 5.5, -1.5);
  const surfD = hsl(h, T * .7, 15), ptD = fitL(h, Math.max(s, 50), 78, surfD, 6.5, 1.5);
  let Pk = P, k = 0; while (k++ < 40 && contrast(Pk, surfD) < 3) { const t = hslOf(Pk), nx = hsl(t[0], t[1], t[2] + 2); if (contrast(nx, '#ffffff') < 4.5) break; Pk = nx; }
  const L = ['--primary:' + P, '--primary-d:' + Pd, '--ptext:' + pt, '--cyan:' + A, '--on-acc:' + onA, '--acc-bg:' + hsl(ah, 90, 92), '--acc-fg:' + hsl(ah, 80, 24),
    '--canvas:' + hsl(h, T, 92), '--soft:' + hsl(h, Math.min(100, T * 1.1), 97.5), '--soft2:' + hsl(h, T, 94.5), '--line:' + hsl(h, T * .85, 90.5), '--info-bg:' + hsl(h, T, 94),
    '--text:' + hsl(h, Math.min(55, T), 16), '--muted:' + hsl(h, Math.min(22, T), 40), '--grad:linear-gradient(135deg,' + Ag + ',' + P + ')',
    '--prgb:' + h2rgb(P).join(' '), '--argb:' + h2rgb(A).join(' '), '--banner:linear-gradient(120deg,' + P + ',' + Pm + ' 60%,' + Pd + ')', '--agenda:linear-gradient(135deg,' + P + ',' + Pm + ')', '--lart:linear-gradient(135deg,' + P + ',' + Pd + ')'];
  const D = ['--primary:' + Pk, '--canvas:' + hsl(h, T * .75, 8), '--surface:' + surfD, '--soft:' + hsl(h, T * .7, 11.5), '--soft2:' + hsl(h, T * .6, 20), '--line:' + hsl(h, T * .55, 26), '--ptext:' + ptD,
    '--text:' + hsl(h, Math.min(60, T), 94), '--muted:' + hsl(h, Math.min(30, T), 76), '--info-bg:' + hsl(h, T * .7, 24), '--acc-bg:' + hsl(ah, 60, 18), '--acc-fg:' + hsl(ah, 90, 74)];
  return 'html:root{' + L.join(';') + '}html[data-theme=dark]{' + D.join(';') + '}';
}
function applyAccent(hex) {
  hex = String(hex || '').toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(hex)) hex = DEF_ACC.toLowerCase();
  let st = document.getElementById('accentStyle');
  if (hex === DEF_ACC.toLowerCase()) { if (st) st.remove(); store.del('simba.accent'); store.del('simba.accentcss'); }
  else {
    const css = accentCSS(hex);
    if (!st) { st = document.createElement('style'); st.id = 'accentStyle'; document.head.appendChild(st); }
    st.textContent = css; store.set('simba.accent', hex); store.set('simba.accentcss', css);
  }
  paintMeta();
}
const modeNow = () => store.get('simba.mode') || store.get('simba.theme') || 'auto';
const isDark = () => { const m = modeNow(); return m === 'dark' || (m === 'auto' && !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)); };
function paintMeta() {
  const m = $('meta[name=theme-color]'); if (!m) return;
  const cs = getComputedStyle(document.documentElement), c = (cs.getPropertyValue(isDark() ? '--surface' : '--primary') || '').trim();
  if (c) m.setAttribute('content', c);
}
function setMode(m) { store.set('simba.mode', m); document.documentElement.setAttribute('data-theme', isDark() ? 'dark' : 'light'); paintMeta(); }
function initTheme() {
  const a = store.get('simba.accent'); if (a && !document.getElementById('accentStyle')) applyAccent(a);
  setMode(modeNow());
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (modeNow() === 'auto') setMode('auto'); }); } catch (e) { /* diabaikan */ }
}
function tampilModal() {
  const m = modeNow(), ac = String(store.get('simba.accent') || DEF_ACC).toLowerCase();
  openModal('<div class="mh"><h3>Warna & Tampilan</h3><button type="button" class="iconbtn" data-act="mclose" aria-label="Tutup">' + ic('close') + '</button></div><div class="mb"><div class="seg" id="segMode">' +
    [['light', 'Terang', 'light_mode'], ['dark', 'Gelap', 'dark_mode'], ['auto', 'Otomatis', 'brightness_auto']].map(x => '<button type="button" data-act="mode" data-m="' + x[0] + '" class="' + (m === x[0] ? 'on' : '') + '">' + ic(x[2]) + x[1] + '</button>').join('') + '</div>' +
    '<div class="sw-grid" id="swGrid">' + PRESET.map(p => '<button type="button" class="sw' + (p[1].toLowerCase() === ac ? ' on' : '') + '" data-act="accent" data-c="' + p[1] + '" style="--c:' + p[1] + '" aria-label="Warna ' + p[0] + '"><i>' + ic('check') + '</i>' + p[0] + '</button>').join('') + '</div>' +
    '<div class="cust"><label for="accCustom">Warna pilihan sendiri<small>Teks otomatis disesuaikan agar tetap mudah dibaca.</small></label><input type="color" id="accCustom" value="' + ac + '"></div>' +
    '<p class="help">Pengaturan tersimpan di perangkat ini saja. Mode gelap dan terang tetap berfungsi dengan warna apa pun.</p>' +
    '<div class="mact"><button type="button" class="btn btn-soft" data-act="accent" data-c="' + DEF_ACC + '">Kembalikan bawaan</button><button type="button" class="btn btn-pri" data-act="mclose">Selesai</button></div></div>', 'sm');
}
function refreshTampil(skipInput) {
  const m = modeNow(), ac = String(store.get('simba.accent') || DEF_ACC).toLowerCase();
  $$('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $$('#swGrid .sw').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === ac));
  const i = $('#accCustom'); if (i && !skipInput) i.value = ac;
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window._pwaPrompt = e; S.prompt = true; if (S.page === 'profil') renderPage(); });
window.addEventListener('appinstalled', () => { window._pwaPrompt = null; S.prompt = false; if (S.page === 'profil') renderPage(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { }));
if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) S.prompt = false;

/* ---------- 14. BOOT ---------- */
function bindStatic() {
  $('#loginForm').addEventListener('submit', doLogin);
  $('#lupaBtn').addEventListener('click', lupaSandi);
  $('#lclose').addEventListener('click', () => $('#loginView').classList.remove('on'));
  $('#bell').addEventListener('click', ACT.bell);
  $('#themeBtn').addEventListener('click', ACT.theme);
  $('#paletteBtn').addEventListener('click', ACT.tampil);
  $('#brandBtn').addEventListener('click', () => go('beranda'));
  const g = $('#gq'), box = $('#gres');
  g.addEventListener('input', () => {
    const r = gsearch(g.value);
    box.innerHTML = r.length ? r.map(x => '<button type="button" class="gr" data-act="gsel" data-p="' + x.p + '" data-q="' + esc(x.q) + '">' + ic(x.i) + '<span><b>' + esc(x.t) + '</b><small>' + esc(x.s) + '</small></span></button>').join('') : (g.value.trim().length > 1 ? '<div class="gr none">Tidak ada hasil</div>' : '');
    box.classList.toggle('on', g.value.trim().length > 1);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) box.classList.remove('on'); });
}
async function boot() {
  initTheme(); bindStatic();
  const tk = tokS.get(); let c = null;
  try { c = JSON.parse(store.get('simba.boot') || 'null'); } catch (e) { c = null; }
  if (c && (!c.user || tk)) { apply(c, tk); S.ready = true; render(); } else { render(); }
  try {
    const r = await srv('bootstrap', tk || null);
    if (tk && !r.user) { tokS.del(); toast('Sesi berakhir. Silakan masuk kembali.', 'warn'); }
    apply(r, tk); S.ready = true; persist(); if (!allowed(S.page)) S.page = 'beranda'; render();
  } catch (e) {
    S.ready = true; render();
    if (!c) $('#view').innerHTML = '<div class="card">' + empty('cloud_off', 'Tidak dapat memuat data', e.message) + '<div class="mact"><button type="button" class="btn btn-pri" onclick="location.reload()">Coba lagi</button></div></div>';
    else toast('Mode offline: menampilkan data tersimpan.', 'warn');
  }
  try { history.replaceState({ p: 'beranda' }, ''); } catch (e) { /* diabaikan */ }
}
document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
})();
