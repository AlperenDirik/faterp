const socket = io();
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SKILLS = ['Akademik','Aldatmaca','Atıcılık','Bağlantılar','Beden','Çeviklik','Empati','Farkındalık','Gizlilik','Gözlem','Hırsızlık','İlim','İrade','Kaynaklar','Kışkırtma','Muhabbet','Sürücülük','Yakın Dövüş','Zanaat'];
const LADDER = {8:'Efsane',7:'İnanılmaz',6:'Şahane',5:'Muhteşem',4:'Harika',3:'Baya iyi',2:'İyi',1:'Eh',0:'Düz','-1':'Dandik','-2':'Kötü','-3':'Rezalet','-4':'Felaket'};
const fmt = n => (n >= 0 ? '+' : '') + n;
const ladder = n => n > 8 ? `${fmt(n)} Efsane üstü` : `${fmt(n)} ${LADDER[Math.max(-4, n)]}`;
const OUT = {fail:'⬇ Başarısızlık', tie:'⇄ Denklik', success:'⬆ Başarılı', style:'⇈ Çok Başarılı'};
const tr = s => s.toLocaleLowerCase('tr');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

let me = JSON.parse(localStorage.getItem('fate-profile') || 'null');
let sheet, sel = null, mod = 0, saveT, myId;
let lastSheets = {}, npcs = [], gTab = 'pl', gSel = null, gVal = 0;

const blank = () => ({name:'', aspects:{high:'',trouble:'',rel:'',free1:'',free2:''}, stress:{p:Array(6).fill(0), m:Array(6).fill(0)}, cons:{mild:'',mod:'',sev:'',mild2:''}, skills:{}, stunts:'', refresh:3, fate:3});
const getSheet = () => { try { return {...blank(), ...JSON.parse(localStorage.getItem('fate-sheet') || '{}')}; } catch { return blank(); } };

/* ---------- Giriş ---------- */
let gmPick = 0;
$$('.role').forEach(b => b.onclick = () => { $$('.role').forEach(x => x.classList.remove('on')); b.classList.add('on'); gmPick = +b.dataset.gm; });
$('#l-go').onclick = () => {
  const name = $('#l-name').value.trim(); if (!name) return $('#l-name').focus();
  me = { id: (me && me.id) || uid(), name, isGM: !!gmPick };
  localStorage.setItem('fate-profile', JSON.stringify(me)); start();
};
$('#l-name').onkeydown = e => { if (e.key === 'Enter') $('#l-go').click(); };
$('#b-out').onclick = () => { localStorage.removeItem('fate-profile'); location.reload(); };

function start() {
  $('#login').classList.add('hide');
  document.body.classList.toggle('gm', me.isGM);
  $('#who').textContent = `${me.name}${me.isGM ? ' · GM' : ''}`;
  sheet = getSheet(); myId = me.id;
  if (!me.isGM) renderSheet();
  renderRoller(); if (me.isGM) initGM();
  socket.on('connect', join); if (socket.connected) join();
}
function join() { socket.emit('join', { id: me.id, username: me.name, isGM: me.isGM, sheet }); }

/* ---------- Karakter kağıdı ---------- */
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { localStorage.setItem('fate-sheet', JSON.stringify(sheet)); socket.emit('updateSheet', { sheet }); }, 300);
}
const setPath = (o, p, v) => { const k = p.split('.'); const l = k.pop(); k.reduce((a, x) => a[x], o)[l] = v; };
const inp = (k, v, ph = '') => `<input data-k="${k}" value="${esc(v)}" placeholder="${ph}">`;

function renderSheet() {
  const s = sheet;
  $('#sheet').innerHTML = `
  <input class="nm" data-k="name" value="${esc(s.name)}" placeholder="Karakterin ismi">
  <h3>Aspect'ler</h3>
  ${[['high','High Concept'],['trouble','Trouble'],['rel','Relationship'],['free1','Serbest'],['free2','Serbest']].map(([k, l]) => `<label class="fld"><span>${l}</span>${inp('aspects.' + k, s.aspects[k])}</label>`).join('')}
  <h3>Stress</h3>
  ${[['p','Fiziksel'],['m','Zihinsel']].map(([t, l]) => `<div class="stress"><b>${l}</b>${s.stress[t].map((v, i) => `<button class="box ${v ? 'on' : ''} ${i > 2 ? 'dim' : ''}" data-st="${t}${i}" title="${i > 2 ? 'Beden/İrade ile açılır' : ''}">1</button>`).join('')}</div>`).join('')}
  <h3>Consequence'lar</h3>
  ${[['mild','Hafif',2],['mod','Orta',4],['sev','Ağır',6],['mild2','Hafif (ek)',2]].map(([k, l, v]) => `<label class="fld cons"><span class="cv">${v}</span><span>${l}</span>${inp('cons.' + k, s.cons[k])}</label>`).join('')}
  <h3>Skill'ler <small id="pyr"></small></h3><div id="skl"></div>
  <h3>Stunt'lar</h3>
  <textarea data-k="stunts" placeholder="3 stunt ile başla. Stunt + refresh = 6 olmalı.">${esc(s.stunts)}</textarea>
  <h3>Refresh & Fate</h3>
  <div class="cnt">Refresh <button class="mini" data-step="refresh:-1">−</button><b>${s.refresh}</b><button class="mini" data-step="refresh:1">+</button>
  <span class="grow"></span>🪙 Fate <button class="mini" data-step="fate:-1">−</button><b class="fate-n">${s.fate}</b><button class="mini" data-step="fate:1">+</button></div>
  <p class="empty">Her oturum başında Fate puanın, refresh sayına eşit olur (daha fazlaysa kalır).</p>`;
  renderSkills();
}
function renderSkills() {
  $('#skl').innerHTML = SKILLS.map(n => { const v = sheet.skills[n] || 0;
    return `<div class="sk ${sel === n ? 'sel' : ''} ${v ? 'has' : ''}"><span class="sn">${n}</span><button class="mini" data-sk="${n}:-1">−</button><span class="sv">${fmt(v)}</span><button class="mini" data-sk="${n}:1">+</button><button class="pick" data-pick="${n}" title="Zar için seç">🎲</button></div>`; }).join('');
  const c = {}; Object.values(sheet.skills).forEach(v => { if (v > 0) c[v] = (c[v] || 0) + 1; });
  const want = {4:1, 3:2, 2:3, 1:4};
  $('#pyr').textContent = [4, 3, 2, 1].map(k => `${fmt(k)}: ${c[k] || 0}/${want[k]}`).join('  ');
  $('#pyr').className = [4, 3, 2, 1].every(k => (c[k] || 0) === want[k]) ? 'ok' : '';
}
const fateRefresh = () => $$('.fate-n').forEach(e => e.textContent = sheet.fate);

$('#sheet').addEventListener('input', e => { const k = e.target.dataset.k; if (k) { setPath(sheet, k, e.target.value); save(); } });
$('#sheet').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.st) { const [ty, i] = [t.dataset.st[0], +t.dataset.st.slice(1)]; sheet.stress[ty][i] ^= 1; t.classList.toggle('on'); }
  else if (t.dataset.sk) { const [n, d] = t.dataset.sk.split(':'); sheet.skills[n] = Math.max(0, Math.min(8, (sheet.skills[n] || 0) + +d)); renderSkills(); if (sel === n) renderRoller(); }
  else if (t.dataset.pick) { sel = t.dataset.pick; renderSkills(); renderRoller(); if (innerWidth <= 900) setTab('chat'); return; }
  else if (t.dataset.step) { const [k, d] = t.dataset.step.split(':'); sheet[k] = Math.max(0, sheet[k] + +d); t.parentNode.querySelectorAll('b').forEach(b => { if (b.previousElementSibling === t || b.nextElementSibling === t) b.textContent = sheet[k]; }); fateRefresh(); }
  else return;
  save();
});

/* ---------- Zar paneli ---------- */
function renderRoller() {
  const v = sel ? (sheet.skills[sel] || 0) : 0;
  $('#sel').textContent = sel ? `${sel} ${fmt(v)}` : 'Sadece zar (+0)';
  $('#sel').classList.toggle('on', !!sel);
  $('#mod').textContent = mod; $('#g-val').textContent = fmt(gVal); fateRefresh();
}
$('#sel-x').onclick = () => { sel = null; renderSkills(); renderRoller(); };
$$('[data-m]').forEach(b => b.onclick = () => { mod = Math.max(-6, Math.min(8, mod + +b.dataset.m)); renderRoller(); });
$('#roll').onclick = () => {
  if (me.isGM) {
    const n = npcs.find(x => x.id === $('#g-actor').value);
    socket.emit('roll', { skill: $('#g-skill').value || null, val: gVal, mod, opp: $('#opp').value, actor: n ? (n.name || 'NPC') : null, hidden: $('#g-hid').checked });
    mod = 0; renderRoller(); return;
  }
  const asp = $('#asp').checked;
  if (asp && sheet.fate < 1) return alert('Fate puanın yok! (Serbest kullanım varsa bonusu elle ekle.)');
  if (asp) { sheet.fate--; fateRefresh(); save(); }
  socket.emit('roll', { skill: sel, val: sel ? sheet.skills[sel] || 0 : 0, mod: mod + (asp ? 2 : 0), opp: $('#opp').value, aspect: asp });
  $('#asp').checked = false; mod = 0; renderRoller();
};

/* ---------- Sohbet & zar animasyonu ---------- */
const chat = $('#chat');
const bottom = () => chat.scrollTop = chat.scrollHeight;
function addMsg(m, animate) {
  let el = document.createElement('div');
  if (m.type === 'system') { el.className = 'sysm'; el.textContent = m.text; }
  else if (m.type === 'chat') { el.className = 'msg' + (m.id === myId ? ' me' : ''); el.innerHTML = `<b style="color:hsl(${hue(m.username)} 70% 70%)">${esc(m.username)}</b>${esc(m.text)}`; }
  else el = diceCard(m, animate);
  chat.appendChild(el); bottom();
}
function face(el, v) { el.className = 'die ' + (v > 0 ? 'plus' : v < 0 ? 'minus' : ''); el.textContent = v > 0 ? '+' : v < 0 ? '−' : ''; }
function diceCard(m, animate) {
  const el = document.createElement('div'); el.className = 'dice-card';
  const who = m.skill ? `${esc(m.skill)} ${fmt(m.val)}` : 'Düz zar';
  el.innerHTML = `<div class="dc-head"><b>${esc(m.username)}</b> · ${who}${m.mod ? ` · bonus ${fmt(m.mod)}` : ''}${m.aspect ? ' · Aspect 🪙' : ''}${m.npc ? ' · NPC' : ''}${m.hidden ? ' · 🙈 Gizli (sadece GM)' : ''}</div><div class="dice">${'<div class="die"></div>'.repeat(4)}</div><div class="dc-res"></div>`;
  const dice = [...el.querySelectorAll('.die')], res = el.querySelector('.dc-res');
  const show = () => { res.innerHTML = `<span class="big-n">${fmt(m.final)}</span><b>${ladder(m.final)}</b>` +
    (m.outcome ? `<div style="margin-top:6px"><span class="badge ${m.outcome}">${OUT[m.outcome]}</span><small>Zorluk ${m.opp} · fark ${fmt(m.shifts)}</small></div>` : '') +
    `<small>Zarlar ${fmt(m.total)}${m.skill ? ` + ${esc(m.skill)} ${fmt(m.val)}` : ''}${m.mod ? ` + bonus ${fmt(m.mod)}` : ''}</small>`; res.classList.add('show'); bottom(); };
  if (!animate) { dice.forEach((d, i) => face(d, m.rolls[i])); show(); return el; }
  dice.forEach(d => d.classList.add('rolling'));
  const spin = setInterval(() => dice.forEach(d => { if (d.classList.contains('rolling')) { const v = Math.floor(Math.random() * 3) - 1; d.textContent = v > 0 ? '+' : v < 0 ? '−' : ''; d.style.color = v > 0 ? '#1c9a5e' : v < 0 ? '#d6404c' : ''; } }), 80);
  dice.forEach((d, i) => setTimeout(() => { d.style.color = ''; face(d, m.rolls[i]); d.classList.add('land'); if (i === 3) { clearInterval(spin); setTimeout(show, 250); } }, 800 + i * 220));
  return el;
}
socket.on('history', h => { chat.innerHTML = ''; h.forEach(m => addMsg(m, false)); });
socket.on('msg', m => addMsg(m, true));
$('#cform').onsubmit = e => { e.preventDefault(); const v = $('#cin').value.trim(); if (v) { socket.emit('chat', v); $('#cin').value = ''; } };
$('#b-clear').onclick = () => confirm('Tüm sohbet geçmişi silinsin mi?') && socket.emit('clearChat');
$('#b-rules').onclick = () => $('#rules').showModal();

socket.on('applyStat', u => {
  const n = SKILLS.find(s => tr(s) === tr(u.skill)); if (!n) return;
  sheet.skills[n] = Math.max(0, Math.min(8, (sheet.skills[n] || 0) + u.change));
  renderSkills(); renderRoller(); save();
  addMsg({ type: 'system', text: `Karakter kağıdında ${n} ${fmt(u.change)} güncellendi.` }, false);
});
socket.on('fate', ({ target, value }) => { if (target === myId && sheet) { sheet.fate = value; fateRefresh(); localStorage.setItem('fate-sheet', JSON.stringify(sheet)); } });

/* ---------- Sahne & Masadakiler ---------- */
$('#sform').onsubmit = e => { e.preventDefault(); const t = $('#s-text').value.trim(); if (t) { socket.emit('sceneAdd', { text: t, kind: $('#s-kind').value }); $('#s-text').value = ''; } };
socket.on('scene', list => {
  $('#scene').innerHTML = list.length ? list.map(a => `<div class="asp ${a.kind}"><div class="t"><small>${a.kind === 'boost' ? 'Boost' : a.kind === 'sahne' ? 'Sahne/Dünya' : 'Durum'}</small>${esc(a.text)}</div>
    <button class="mini" data-su="${a.id}:-1">−</button><b title="Serbest kullanım">${a.uses}</b><button class="mini" data-su="${a.id}:1">+</button><button class="mini" data-sd="${a.id}">✕</button></div>`).join('') : '<p class="empty">Henüz sahne aspect\'i yok.</p>';
});
$('#scene').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.su) { const [id, d] = b.dataset.su.split(':'); socket.emit('sceneUse', { id, delta: +d }); }
  if (b.dataset.sd) socket.emit('sceneDel', b.dataset.sd); };
socket.on('sheets', all => {
  lastSheets = all; if (me && me.isGM && gTab === 'pl') renderGM();
  const list = Object.values(all);
  $('#players').innerHTML = list.length ? list.map(p => { const s = p.sheet || {}, a = s.aspects || {};
    const top = Object.entries(s.skills || {}).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${esc(k)} ${fmt(v)}`).join(' · ');
    const boxes = t => ((s.stress || {})[t] || []).slice(0, 3).map(v => `<span class="mb ${v ? 'on' : ''}"></span>`).join('');
    const cons = Object.values(s.cons || {}).filter(Boolean).map(esc).join(', ');
    return `<div class="pl"><div class="top"><span class="dot ${p.online ? 'on' : ''}"></span><b>${esc(s.name || p.username)}</b><span class="mut">${esc(p.username)}</span>${p.isGM ? '<span class="tag">GM</span>' : ''}<span class="grow"></span>
      <span class="fp">🪙 ${s.fate ?? '-'}</span>${me && me.isGM && !p.isGM ? `<button class="mini" data-gf="${p.id}:-1">−</button><button class="mini" data-gf="${p.id}:1">+</button>` : ''}</div>
      ${a.high ? `<div class="mut" style="margin-top:6px">${esc(a.high)}${a.trouble ? ' · ' + esc(a.trouble) : ''}</div>` : ''}
      <div class="mut" style="margin-top:4px">Fiz ${boxes('p')} Zih ${boxes('m')}</div>
      ${cons ? `<div class="mut">Consequence: ${cons}</div>` : ''}${top ? `<div class="mut">${top}</div>` : ''}</div>`; }).join('') : '<p class="empty">Kimse yok.</p>';
});
$('#players').onclick = e => { const b = e.target.closest('[data-gf]'); if (b) { const [target, d] = b.dataset.gf.split(':'); socket.emit('setFate', { target, delta: +d }); } };

/* ---------- Mobil sekmeler ---------- */
function setTab(t) { $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'p-' + t)); }
$$('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

/* ---------- GM ekranı ---------- */
const gs = $('#gmscreen');
function initGM() {
  $('#tabs [data-tab=sheet]').textContent = '👑 GM Ekranı';
  $('#g-skill').innerHTML = '<option value="">— Düz zar</option>' + SKILLS.map(s => `<option>${s}</option>`).join('');
  fillActors(); renderGM();
}
function fillActors() {
  const el = $('#g-actor'); let cur = el.value;
  el.innerHTML = '<option value="">👑 Anlatıcı</option>' + npcs.map(n => `<option value="${n.id}">${esc(n.name || 'NPC')}</option>`).join('');
  if (![...el.options].some(o => o.value === cur)) cur = ''; el.value = cur;
}
function autoVal() { const n = npcs.find(x => x.id === $('#g-actor').value), k = $('#g-skill').value; if (n && k) gVal = n.skills[k] || 0; renderRoller(); }
$('#g-actor').onchange = $('#g-skill').onchange = autoVal;
$$('[data-gv]').forEach(b => b.onclick = () => { gVal = Math.max(-4, Math.min(8, gVal + +b.dataset.gv)); renderRoller(); });
$$('[data-d]').forEach(b => b.onclick = () => { $('#opp').value = b.dataset.d; });
$('#g-bc').onclick = () => { const v = $('#opp').value; socket.emit('setDiff', v === '' ? null : Number(v)); };
$('#diffx').onclick = () => socket.emit('setDiff', null);
socket.on('diff', d => { $('#diffbar').hidden = d === null; if (d !== null) $('#diff-t').textContent = `🎯 Sahne zorluğu: ${ladder(d)}`; });
socket.on('npcs', l => { npcs = l; fillActors(); renderGM(); });

function renderGM() {
  const list = Object.values(lastSheets).filter(p => !p.isGM);
  if (!gSel || !lastSheets[gSel] || lastSheets[gSel].isGM) gSel = (list[0] || {}).id;
  let h = `<div class="gtabs"><button data-gt="pl" class="${gTab === 'pl' ? 'on' : ''}">Oyuncular (${list.length})</button><button data-gt="npc" class="${gTab === 'npc' ? 'on' : ''}">NPC'ler (${npcs.length})</button></div>`;
  if (gTab === 'pl') h += list.length
    ? `<div class="pchips">${list.map(p => `<button class="pc ${p.id === gSel ? 'on' : ''}" data-gp="${p.id}"><span class="dot ${p.online ? 'on' : ''}"></span>${esc((p.sheet && p.sheet.name) || p.username)}</button>`).join('')}</div>` + sheetView(lastSheets[gSel])
    : '<p class="empty">Henüz oyuncu yok.</p>';
  else h += npcView();
  gs.innerHTML = h;
}
function sheetView(p) {
  const s = p.sheet; if (!s) return '<p class="empty">Kart henüz doldurulmadı.</p>';
  const a = s.aspects || {}, c = s.cons || {};
  const bx = t => ((s.stress || {})[t] || []).map((v, i) => `<span class="mb ${v ? 'on' : ''} ${i > 2 ? 'dim' : ''}"></span>`).join('');
  const sk = Object.entries(s.skills || {}).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const rows = (arr, o) => arr.filter(([k]) => o[k]).map(([k, l]) => `<div class="kv"><span>${l}</span>${esc(o[k])}</div>`).join('');
  return `<div class="vw"><div class="vn">${esc(s.name || p.username)} <small>oyuncu: ${esc(p.username)}</small></div>
  <h4>Aspect'ler</h4>${rows([['high','High Concept'],['trouble','Trouble'],['rel','Relationship'],['free1','Serbest'],['free2','Serbest']], a) || '<p class="empty">—</p>'}
  <h4>Stress</h4><div class="kv"><span>Fiziksel</span>${bx('p')}</div><div class="kv"><span>Zihinsel</span>${bx('m')}</div>
  <h4>Consequence'lar</h4>${rows([['mild','Hafif (2)'],['mod','Orta (4)'],['sev','Ağır (6)'],['mild2','Hafif (2)']], c) || '<p class="empty">Yok</p>'}
  <h4>Skill'ler</h4><div class="skchips">${sk.map(([k, v]) => `<span class="skc">${esc(k)} <b>${fmt(v)}</b></span>`).join('') || '<p class="empty">—</p>'}</div>
  <h4>Stunt'lar</h4><div class="stv">${esc(s.stunts || '—')}</div>
  <h4>Refresh & Fate</h4><div class="cnt">Refresh <b>${s.refresh ?? '-'}</b><span class="grow"></span>🪙 Fate <button class="mini" data-gf="${p.id}:-1">−</button><b>${s.fate ?? 0}</b><button class="mini" data-gf="${p.id}:1">+</button></div></div>`;
}
function npcView() {
  return `<button class="primary" data-nadd>＋ Yeni NPC</button>` + (npcs.map(n => `<div class="npc" data-n="${n.id}">
    <div class="top"><input data-nf="name" value="${esc(n.name)}" placeholder="NPC adı"><button class="mini" data-nact title="Zar atmak için seç">🎲</button><button class="mini" data-ndel title="Sil">🗑</button></div>
    <input data-nf="note" value="${esc(n.note)}" placeholder="Aspect / not (ör. Acımasız Haydut Reisi)">
    <div class="stress">${n.stress.map((v, i) => `<button class="box ${v ? 'on' : ''}" data-nst="${i}">1</button>`).join('')}</div>
    <div class="skchips">${Object.entries(n.skills).map(([k, v]) => `<span class="skc">${esc(k)} <button class="mini" data-nsk="${k}:-1">−</button><b>${fmt(v)}</b><button class="mini" data-nsk="${k}:1">+</button></span>`).join('')}</div>
    <select data-nskadd><option value="">＋ yetenek ekle</option>${SKILLS.filter(s => !(s in n.skills)).map(s => `<option>${s}</option>`).join('')}</select></div>`).join('') || '<p class="empty">Henüz NPC yok.</p>');
}
const npcOf = el => { const c = el.closest('[data-n]'); return c && npcs.find(x => x.id === c.dataset.n); };
const npcSave = n => socket.emit('npcSave', n);
gs.onclick = e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.gt) { gTab = d.gt; return renderGM(); }
  if (d.gp) { gSel = d.gp; return renderGM(); }
  if (d.gf) { const [t, x] = d.gf.split(':'); return socket.emit('setFate', { target: t, delta: +x }); }
  if ('nadd' in d) return socket.emit('npcAdd');
  const n = npcOf(b); if (!n) return;
  if ('ndel' in d) { if (confirm(`${n.name} silinsin mi?`)) socket.emit('npcDel', n.id); return; }
  if ('nact' in d) { $('#g-actor').value = n.id; autoVal(); if (innerWidth <= 900) setTab('chat'); return; }
  if (d.nst !== undefined) n.stress[+d.nst] ^= 1;
  else if (d.nsk) { const [k, x] = d.nsk.split(':'); n.skills[k] = Math.max(0, Math.min(8, (n.skills[k] || 0) + +x)); }
  else return;
  npcSave(n); renderGM();
};
gs.oninput = e => { const n = npcOf(e.target), f = e.target.dataset.nf; if (!n || !f) return; n[f] = e.target.value; npcSave(n); if (f === 'name') fillActors(); };
gs.onchange = e => { if (e.target.dataset.nskadd === undefined) return; const n = npcOf(e.target), v = e.target.value; if (n && v) { n.skills[v] = 1; npcSave(n); renderGM(); } };

/* Her şey tanımlandıktan sonra başlat */
if (me) start();