let currentMode = 'text';
let toastTimer;
let lastFigure = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Chart states ---------- */
function showEmpty(message) {
  lastFigure = null;
  $('#chartEmpty').textContent = message || 'Ask a question to see a live chart here.';
  $('#chartEmpty').classList.remove('hidden');
  $('#plotly').classList.add('hidden');
}

function switchView(view) {
  const btn = $(`.view-button[data-result-view="${view}"]`);
  if (btn) btn.click();
}

/* ---------- Chat ---------- */
function addBubble(role, text) {
  const conversation = $('#conversation');
  const wrap = document.createElement('div');
  wrap.className = `message ${role}-message`;
  const bubble = document.createElement('div');
  bubble.className = role === 'user' ? 'bubble' : 'bubble assistant-bubble';
  bubble.textContent = text;
  const chip = document.createElement('span');
  chip.className = role === 'user' ? 'user-chip' : 'bot-chip';
  chip.textContent = role === 'user' ? 'U' : '✦';
  if (role === 'user') wrap.append(bubble, chip); else wrap.append(chip, bubble);
  conversation.append(wrap);
  conversation.scrollTop = conversation.scrollHeight;
  return bubble;
}

function setInsights(items) {
  $('#insightsList').innerHTML = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function answerToInsights(text) {
  const lines = String(text).split(/\n+/).map(l => l.replace(/^[\s\-*•\d.)]+/, '').trim()).filter(Boolean);
  const items = lines.length > 1 ? lines : String(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  return items.slice(0, 6);
}

function formatCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00/.test(v)) return v.slice(0, 10);
  return v;
}

function renderTable(table) {
  const numeric = table.columns.map((_, i) => table.data.length > 0 && table.data.every(r => r[i] === null || typeof r[i] === 'number'));
  $('#tableHead').innerHTML = '<tr>' + table.columns.map((c, i) => `<th class="${numeric[i] ? 'num' : ''}">${escapeHtml(c)}</th>`).join('') + '</tr>';
  $('#salesTable').innerHTML = table.data.map(row => '<tr>' + row.map((v, i) => `<td class="${numeric[i] ? 'num' : ''}">${escapeHtml(formatCell(v))}</td>`).join('') + '</tr>').join('');
}

function themeColors() {
  const s = getComputedStyle(document.body);
  return { text: s.getPropertyValue('--text').trim() || '#15233b', grid: s.getPropertyValue('--line').trim() || '#e4eaf2' };
}

function renderFigure(fig) {
  if (!fig) return showEmpty('This result has no numeric data to chart. Check the Table tab.');
  if (!window.Plotly) return showEmpty('Chart library could not load. Check your internet connection or use the Table tab.');
  lastFigure = fig;
  const c = themeColors();
  const layout = {
    ...fig.layout, template: undefined, title: undefined, autosize: true,
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: c.text, size: 12 }, margin: { l: 46, r: 10, t: 10, b: 50 },
    xaxis: { ...(fig.layout && fig.layout.xaxis), gridcolor: c.grid, automargin: true },
    yaxis: { ...(fig.layout && fig.layout.yaxis), gridcolor: c.grid, automargin: true }
  };
  $('#chartEmpty').classList.add('hidden');
  $('#plotly').classList.remove('hidden');
  Plotly.react('plotly', fig.data, layout, { responsive: true, displayModeBar: false });
}

function applyBackend(data) {
  $('#chartTitle').textContent = data.title || 'Results';
  const insights = (data.insights && data.insights.length) ? data.insights : answerToInsights(data.answer);
  setInsights(insights.length ? insights : ['No insights were returned for this question.']);
  $('#sqlCode').textContent = data.sql || '-- SQL was not returned by the agent.';
  if (data.table) renderTable(data.table);
  else { $('#tableHead').innerHTML = ''; $('#salesTable').innerHTML = ''; }
  if (data.figure) { switchView('chart'); renderFigure(data.figure); }
  else {
    showEmpty(data.table ? 'This result has no numeric data to chart. Check the Table tab.' : 'The agent did not return a data table for this question.');
    if (data.table) switchView('table');
  }
}

$('#queryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#queryInput');
  const send = $('.send-button');
  const query = input.value.trim();
  if (!query) { showToast('Enter a question about your data first.'); input.focus(); return; }
  addBubble('user', query);
  input.value = '';
  const pending = addBubble('assistant', 'Analyzing your data');
  pending.classList.add('thinking');
  send.disabled = true;
  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: query }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Server error ${res.status}`);
    const data = await res.json();
    pending.classList.remove('thinking');
    pending.textContent = 'Here are your results. I have updated the chart and key insights.';
    applyBackend(data);
    if (currentMode === 'voice') $('#speakButton').click();  // voice mode me jawab bol kar sunao
  } catch (err) {
    pending.classList.remove('thinking');
    pending.textContent = `Sorry, I could not get an answer: ${err.message}`;
    showToast(`Backend error: ${err.message}`.slice(0, 120));
  } finally {
    send.disabled = false;
    $('#conversation').scrollTop = $('#conversation').scrollHeight;
  }
});

$$('.mode').forEach(button => button.addEventListener('click', () => {
  currentMode = button.dataset.mode;
  $$('.mode').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  if (currentMode === 'voice') {
    $('#queryInput').placeholder = 'Tap the microphone to speak...';
    $('#micButton').focus();
    showToast('Voice mode selected. Tap the microphone to start.');
  } else {
    $('#queryInput').placeholder = 'Type your question here...';
    $('#queryInput').focus();
  }
}));

/* ---------- Voice input: Whisper (backend) first, browser STT as fallback ---------- */
let recorder = null;
let chunks = [];

function submitQuery() { $('#queryForm').requestSubmit(); }

async function transcribe(blob, ext) {
  const form = new FormData();
  form.append('audio', blob, `voice.${ext}`);
  const res = await fetch('/api/stt', { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Speech-to-text failed');
  return (await res.json()).text;
}

function browserSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { showToast('Voice input is not supported in this browser.'); return; }
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  $('#micButton').textContent = '…';
  recognition.onresult = (event) => { $('#queryInput').value = event.results[0][0].transcript; submitQuery(); };
  recognition.onerror = () => showToast('Could not recognize speech. Please try again.');
  recognition.onend = () => { $('#micButton').textContent = '🎙'; };
  try { recognition.start(); } catch { $('#micButton').textContent = '🎙'; showToast('Microphone could not start. Check browser permission.'); }
}

$('#micButton').addEventListener('click', async () => {
  const mic = $('#micButton');
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder || !window.isSecureContext) {
    // Mobile pe mic ke liye HTTPS chahiye; warna browser STT try karo
    return browserSpeech();
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      mic.classList.remove('recording');
      mic.textContent = '…';
      try {
        const type = recorder.mimeType || 'audio/webm';
        const text = await transcribe(new Blob(chunks, { type }), type.includes('mp4') ? 'mp4' : 'webm');
        if (!text) { showToast('No speech detected. Please try again.'); }
        else { $('#queryInput').value = text; submitQuery(); }
      } catch (err) {
        showToast(err.message.slice(0, 120));
      } finally { mic.textContent = '🎙'; }
    };
    recorder.start();
    mic.classList.add('recording');
    mic.textContent = '■';
    showToast('Listening… tap again to stop.');
  } catch {
    showToast('Microphone permission denied.');
  }
});

/* ---------- Result tabs ---------- */
$$('.view-button').forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.resultView;
  $$('.view-button').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  $('#chartView').classList.toggle('hidden', view !== 'chart');
  $('#tableView').classList.toggle('hidden', view !== 'table');
  if (view === 'chart' && lastFigure && window.Plotly) Plotly.Plots.resize('plotly');
}));

$('#copySql').addEventListener('click', async () => {
  const sql = $('#sqlCode').textContent;
  try {
    await navigator.clipboard.writeText(sql);
    showToast('SQL copied.');
  } catch {
    const temp = document.createElement('textarea');
    temp.value = sql; document.body.appendChild(temp); temp.select();
    const copied = document.execCommand('copy'); temp.remove();
    showToast(copied ? 'SQL copied.' : 'Could not copy SQL.');
  }
});

/* ---------- Audio explanation (TTS) ---------- */
function resetAudio() {
  $('#audioStatus').textContent = 'Read aloud';
  $('#speakButton').textContent = '▶';
  $('#audioCard').classList.remove('speaking');
}
$('#speakButton').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { showToast('Audio playback is not supported in this browser.'); return; }
  window.speechSynthesis.cancel();
  const insightText = [...$('#insightsList').querySelectorAll('li')].map(li => li.textContent).join('. ');
  const utterance = new SpeechSynthesisUtterance(`Here are your key insights. ${insightText}`);
  utterance.lang = 'en-IN';
  utterance.onstart = () => { $('#audioStatus').textContent = 'Speaking…'; $('#speakButton').textContent = 'Ⅱ'; $('#audioCard').classList.add('speaking'); };
  utterance.onend = resetAudio;
  utterance.onerror = resetAudio;
  window.speechSynthesis.speak(utterance);
});
$('#stopSpeak').addEventListener('click', () => {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  resetAudio();
});

/* ---------- Theme ---------- */
function setTheme(dark) {
  document.body.classList.toggle('dark', dark);
  $('#themeToggle').textContent = dark ? '☀' : '☾';
  $('#themeToggle').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  $('#themeColor').setAttribute('content', dark ? '#172131' : '#ffffff');
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  if (lastFigure) renderFigure(lastFigure);
}
$('#themeToggle').addEventListener('click', () => setTheme(!document.body.classList.contains('dark')));

/* ---------- Navigation + History ---------- */
function closeHistory() {
  $('#historyPanel').classList.add('hidden');
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'Chat'));
}
async function openHistory() {
  const list = $('#historyList');
  list.innerHTML = '<p>Loading…</p>';
  $('#historyPanel').classList.remove('hidden');
  try {
    const res = await fetch('/api/history');
    const rows = await res.json();
    list.innerHTML = rows.length ? '' : '<p>No questions saved yet.</p>';
    rows.forEach(row => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'history-item';
      b.textContent = row.user_query;
      const small = document.createElement('small');
      small.textContent = new Date(row.date_created).toLocaleString();
      b.append(small);
      b.addEventListener('click', () => { $('#queryInput').value = row.user_query; closeHistory(); $('#queryInput').focus(); });
      list.append(b);
    });
  } catch { list.innerHTML = '<p>History could not be loaded. Check that the backend is running.</p>'; }
}
$('#closeHistory').addEventListener('click', closeHistory);
$('#historyPanel').addEventListener('click', (e) => { if (e.target.id === 'historyPanel') closeHistory(); });

$$('.nav-item').forEach(button => button.addEventListener('click', () => {
  $$('.nav-item').forEach(item => item.classList.toggle('active', item === button));
  const view = button.dataset.view;
  if (view === 'Chat') return;
  if (view === 'History') return openHistory();
  const messages = {
    'Data Sources': 'Set DB_URL in your .env file to connect your database.',
    'Settings': 'Use the moon icon to switch themes.'
  };
  showToast(messages[view] || `${view} selected.`);
}));

let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch {}
setTheme(savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
