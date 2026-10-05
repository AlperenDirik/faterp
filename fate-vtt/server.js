const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

// --- Opsiyonel Gemini (GEMINI_API_KEY ortam değişkeni varsa açılır) ---
const SKILLS = ['Akademik','Aldatmaca','Atıcılık','Bağlantılar','Beden','Çeviklik','Empati','Farkındalık','Gizlilik','Gözlem','Hırsızlık','İlim','İrade','Kaynaklar','Kışkırtma','Muhabbet','Sürücülük','Yakın Dövüş','Zanaat'];
let genModel = null;
if (process.env.GEMINI_API_KEY) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genModel = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      .getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
    console.log('Gemini aktif.');
  } catch (e) { console.log('Gemini kapalı:', e.message); }
}

// --- Oyun durumu (bellekte) ---
const sheets = {};   // clientId -> { id, username, isGM, online, sheet }
let scene = [];      // sahne aspect'leri
let history = [];    // sohbet + zar geçmişi
let npcs = [];       // sadece GM'ler görür
let diff = null;     // GM'in duyurduğu sahne zorluğu

function pushMsg(m) {
  m.t = Date.now();
  history.push(m);
  if (history.length > 200) history.shift();
  io.emit('msg', m);
}
const sys = (text) => pushMsg({ type: 'system', text });
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function rollFate() {
  const rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 3) - 1);
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

io.on('connection', (socket) => {
  socket.on('join', ({ id, username, isGM, sheet }) => {
    if (!id) return;
    const wasOnline = sheets[id] && sheets[id].online;
    socket.data = { id, username, isGM: !!isGM };
    sheets[id] = { id, username, isGM: !!isGM, online: true, sheet: sheet || (sheets[id] && sheets[id].sheet) || null };
    if (isGM) { socket.join('gm'); socket.emit('npcs', npcs); }
    socket.emit('diff', diff);
    socket.emit('history', history);
    socket.emit('scene', scene);
    io.emit('sheets', sheets);
    if (!wasOnline) sys(`${username} masaya katıldı.`);
  });

  socket.on('updateSheet', ({ sheet }) => {
    const d = socket.data; if (!d || !sheets[d.id]) return;
    sheets[d.id].sheet = sheet;
    io.emit('sheets', sheets);
  });

  socket.on('chat', async (text) => {
    const d = socket.data; if (!d) return;
    text = String(text || '').trim().slice(0, 500);
    if (!text) return;
    pushMsg({ type: 'chat', id: d.id, username: d.username, text });
    if (genModel && /[+-]\s?\d|artt|azal|düş|yüksel/i.test(text)) {
      try {
        const r = await genModel.generateContent(
          `Mesajda şu yeteneklerden birinde değişiklik var mı? Yetenekler: ${SKILLS.join(', ')}.\nMesaj: "${text}"\n` +
          `Varsa sadece {"skill":"Gizlilik","change":2} formatında JSON dön, yoksa null dön.`);
        const raw = r.response.text().replace(/```json|```/g, '').trim();
        if (raw.startsWith('{')) {
          const u = JSON.parse(raw);
          if (u.skill && Number.isFinite(u.change)) socket.emit('applyStat', u);
        }
      } catch (e) { console.error('Gemini hatası:', e.message); }
    }
  });

  socket.on('roll', ({ skill, val, mod, opp, aspect, actor, hidden }) => {
    const d = socket.data; if (!d) return;
    val = Number(val) || 0; mod = Number(mod) || 0;
    opp = (opp === '' || opp === null || opp === undefined) ? null : Number(opp);
    if (!Number.isFinite(opp)) opp = null;
    if (opp === null && !d.isGM && diff !== null) opp = diff; // GM'in duyurduğu zorluk
    const { rolls, total } = rollFate();
    const final = total + val + mod;
    let outcome = null, shifts = null;
    if (opp !== null) {
      shifts = final - opp;
      outcome = shifts < 0 ? 'fail' : shifts === 0 ? 'tie' : shifts < 3 ? 'success' : 'style';
    }
    const asNpc = d.isGM && actor;
    const m = { type: 'dice', id: d.id, username: asNpc ? String(actor).slice(0, 30) : d.username, npc: !!asNpc,
      hidden: !!(d.isGM && hidden), skill: skill || null, val, mod, aspect: !!aspect, rolls, total, final, opp, outcome, shifts };
    if (m.hidden) { m.t = Date.now(); io.to('gm').emit('msg', m); } else pushMsg(m);
  });

  // GM: sahne zorluğu duyur / temizle
  socket.on('setDiff', (v) => {
    if (!socket.data || !socket.data.isGM) return;
    diff = (v === null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
    io.emit('diff', diff);
  });

  // GM: NPC yönetimi
  const gmOnly = (fn) => (...a) => { if (socket.data && socket.data.isGM) fn(...a); };
  socket.on('npcAdd', gmOnly(() => {
    npcs.push({ id: rid(), name: 'Yeni NPC', note: '', stress: [0, 0, 0], skills: {} });
    io.to('gm').emit('npcs', npcs);
  }));
  socket.on('npcSave', gmOnly((n) => {
    const i = npcs.findIndex(x => x.id === (n && n.id)); if (i < 0) return;
    npcs[i] = { id: n.id, name: String(n.name || '').slice(0, 30), note: String(n.note || '').slice(0, 120),
      stress: (n.stress || []).slice(0, 6).map(v => v ? 1 : 0), skills: n.skills || {} };
  }));
  socket.on('npcDel', gmOnly((id) => { npcs = npcs.filter(x => x.id !== id); io.to('gm').emit('npcs', npcs); }));

  // GM: fate puanı ver/al
  socket.on('setFate', ({ target, delta }) => {
    if (!socket.data || !socket.data.isGM || !sheets[target] || !sheets[target].sheet) return;
    const s = sheets[target].sheet;
    s.fate = Math.max(0, (s.fate || 0) + Number(delta));
    io.emit('sheets', sheets);
    io.emit('fate', { target, value: s.fate });
    sys(`${socket.data.username}, ${sheets[target].username} oyuncusuna ${delta > 0 ? '+' : ''}${delta} Fate puanı işledi.`);
  });

  socket.on('sceneAdd', ({ text, kind }) => {
    text = String(text || '').trim().slice(0, 120); if (!text) return;
    scene.push({ id: rid(), text, kind: kind || 'durum', uses: kind === 'boost' ? 1 : 0 });
    io.emit('scene', scene);
  });
  socket.on('sceneUse', ({ id, delta }) => {
    const a = scene.find(x => x.id === id); if (!a) return;
    a.uses = Math.max(0, a.uses + Number(delta)); io.emit('scene', scene);
  });
  socket.on('sceneDel', (id) => { scene = scene.filter(x => x.id !== id); io.emit('scene', scene); });

  socket.on('clearChat', () => {
    if (!socket.data || !socket.data.isGM) return;
    history = []; io.emit('history', history);
  });

  socket.on('disconnect', () => {
    const d = socket.data;
    if (d && sheets[d.id]) { sheets[d.id].online = false; io.emit('sheets', sheets); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`));