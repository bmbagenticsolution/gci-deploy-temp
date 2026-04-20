/* rchat-patch.js
 * In-report follow-up chat for Conviction Reports and Strategic Intelligence.
 * Appends a chat bar to the bottom of the generated report and lets the client
 * ask 4 to 5 follow-up questions with the full report pinned as context.
 * Posts to /api/chat (same endpoint used by the existing agent overlay).
 * Drop-in: included as <script src="/rchat-patch.js"></script> before </body>.
 */
(function(){
  if (window.__rchatPatched) return;
  window.__rchatPatched = true;

  /* ---------- styles ---------- */
  var css = [
    '.rchat{margin:24px 0 8px;border-top:1px solid rgba(255,255,255,.08);padding-top:18px}',
    '.rchat-h{font-size:13px;letter-spacing:.4px;text-transform:uppercase;color:#8b949e;font-weight:600;margin-bottom:10px}',
    '.rchat-starters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}',
    '.rchat-starter{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);color:#c9d1d9;padding:8px 12px;border-radius:999px;font-size:12px;cursor:pointer}',
    '.rchat-starter:hover{background:rgba(255,255,255,.08)}',
    '.rchat-log{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}',
    '.rchat-msg{padding:10px 14px;border-radius:10px;font-size:14px;line-height:1.55;max-width:92%;white-space:pre-wrap}',
    '.rchat-msg.u{background:#1f6feb;color:#fff;align-self:flex-end}',
    '.rchat-msg.a{background:#161b22;border:1px solid #30363d;color:#e6edf3;align-self:flex-start}',
    '.rchat-msg.sys{color:#8b949e;font-size:12px;font-style:italic}',
    '.rchat-row{display:flex;gap:8px;align-items:flex-end}',
    '.rchat-input{flex:1;min-height:44px;max-height:140px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:10px 12px;font:inherit;font-size:14px;resize:vertical}',
    '.rchat-send{background:#238636;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;min-width:80px}',
    '.rchat-send:hover{background:#2ea043}',
    '.rchat-send:disabled{opacity:.6;cursor:not-allowed}',
    '.rchat-meta{color:#8b949e;font-size:11px;margin-top:6px}'
  ].join('');
  var s = document.createElement('style');
  s.id = 'rchat-css';
  s.textContent = css;
  document.head.appendChild(s);

  /* ---------- state ---------- */
  var convState = { messages: [], busy: false };
  var siState   = { messages: [], busy: false };
  function stateFor(kind){ return kind === 'si' ? siState : convState; }

  /* ---------- helpers ---------- */
  function hdrs(){
    try { return (typeof gciHeaders === 'function') ? gciHeaders() : { 'Content-Type': 'application/json' }; }
    catch(e){ return { 'Content-Type': 'application/json' }; }
  }

  function getReportText(kind){
    if (kind === 'si') {
      var d = window._siRawData;
      if (!d) return '';
      var parts = [];
      if (d.report)     parts.push('STRATEGIC REPORT:\n' + d.report);
      if (d.vidura)     parts.push('\nVIDURA ADVISOR:\n' + d.vidura);
      if (d.vibhishana) parts.push('\nVIBHISHANA (RED-TEAM):\n' + d.vibhishana);
      return parts.join('\n\n');
    }
    return window._lastRawReport || '';
  }

  function buildSystem(reportText, kind){
    var label = kind === 'si' ? 'Strategic Intelligence Report' : 'Conviction Report';
    return [
      'You are the Gulf Capital Intelligence follow-up analyst.',
      'The client has just read the ' + label + ' below. Answer their follow-up questions using ONLY the report as the primary source.',
      'Be concise, specific, and cite sections or numbers from the report when relevant.',
      'If the answer is not in the report, say so plainly and suggest what data would be needed.',
      'Do not repeat the whole report back. Stay focused on the specific question.',
      '',
      '=== BEGIN ' + label.toUpperCase() + ' ===',
      reportText || '(report text unavailable)',
      '=== END ' + label.toUpperCase() + ' ==='
    ].join('\n');
  }

  function starters(kind){
    if (kind === 'si') {
      return [
        'What are the top 3 risks in this report?',
        'Which assumption is weakest?',
        'What would make me walk away from this?',
        'Summarize the strategic edge in one paragraph.',
        'What does the red-team disagree with?'
      ];
    }
    return [
      'What is the single biggest risk?',
      'What are the top 3 catalysts?',
      'Why should I have conviction here?',
      'What would change the thesis?',
      'Give me the one-line bottom line.'
    ];
  }

  function addMsg(logEl, role, text){
    var d = document.createElement('div');
    d.className = 'rchat-msg ' + (role === 'user' ? 'u' : role === 'system' ? 'sys' : 'a');
    d.textContent = text;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function ask(kind, question, nodes){
    var st = stateFor(kind);
    if (st.busy) return;
    if (!question || !question.trim()) return;

    var rep = getReportText(kind);
    if (!rep) { addMsg(nodes.log, 'system', 'Report text is not available yet. Please regenerate the report.'); return; }

    st.busy = true;
    nodes.send.disabled = true;
    nodes.input.disabled = true;
    addMsg(nodes.log, 'user', question);
    st.messages.push({ role: 'user', content: question });
    nodes.input.value = '';
    var thinking = document.createElement('div');
    thinking.className = 'rchat-msg a';
    thinking.textContent = 'Thinking...';
    nodes.log.appendChild(thinking);
    nodes.log.scrollTop = nodes.log.scrollHeight;

    try {
      var sys = buildSystem(rep, kind);
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: sys,
          messages: st.messages
        })
      });
      var data = {};
      try { data = await res.json(); } catch(e){}
      var reply = (data && data.content && data.content[0] && data.content[0].text)
                ? data.content[0].text
                : (data && data.error ? ('Error: ' + data.error) : 'No response. Please try again.');
      thinking.remove();
      addMsg(nodes.log, 'assistant', reply);
      st.messages.push({ role: 'assistant', content: reply });
    } catch (e) {
      thinking.remove();
      addMsg(nodes.log, 'system', 'Request failed: ' + (e && e.message ? e.message : e));
    } finally {
      st.busy = false;
      nodes.send.disabled = false;
      nodes.input.disabled = false;
      nodes.input.focus();
    }
  }

  function buildBlock(kind){
    var wrap = document.createElement('div');
    wrap.className = 'rchat';
    wrap.setAttribute('data-rchat', kind);

    var h = document.createElement('div');
    h.className = 'rchat-h';
    h.textContent = 'Ask follow-up questions about this report';
    wrap.appendChild(h);

    var st = document.createElement('div');
    st.className = 'rchat-starters';
    starters(kind).forEach(function(q){
      var b = document.createElement('button');
      b.className = 'rchat-starter';
      b.type = 'button';
      b.textContent = q;
      b.onclick = function(){ nodes.input.value = q; nodes.input.focus(); };
      st.appendChild(b);
    });
    wrap.appendChild(st);

    var log = document.createElement('div');
    log.className = 'rchat-log';
    wrap.appendChild(log);

    var row = document.createElement('div');
    row.className = 'rchat-row';
    var ta = document.createElement('textarea');
    ta.className = 'rchat-input';
    ta.placeholder = 'Ask a clarifying question about this report...';
    ta.rows = 2;
    var btn = document.createElement('button');
    btn.className = 'rchat-send';
    btn.type = 'button';
    btn.textContent = 'Send';
    row.appendChild(ta);
    row.appendChild(btn);
    wrap.appendChild(row);

    var meta = document.createElement('div');
    meta.className = 'rchat-meta';
    meta.textContent = 'Answers use the report above as the pinned source. Press Enter to send, Shift+Enter for a new line.';
    wrap.appendChild(meta);

    var nodes = { wrap: wrap, log: log, input: ta, send: btn };
    btn.onclick = function(){ ask(kind, ta.value, nodes); };
    ta.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        ask(kind, ta.value, nodes);
      }
    });

    return wrap;
  }

  function injectInto(containerId, kind){
    var host = document.getElementById(containerId);
    if (!host) return;
    // remove any prior chat block so we do not stack them on re-render
    var prior = host.querySelector('[data-rchat="' + kind + '"]');
    if (prior) prior.remove();
    // reset conversation on a fresh report
    stateFor(kind).messages = [];
    host.appendChild(buildBlock(kind));
  }

  /* ---------- monkey patches ---------- */
  function wrapRenderReport(){
    var orig = window.renderReport;
    if (typeof orig !== 'function' || orig.__rchatWrapped) return false;
    var wrapped = function(){
      var r = orig.apply(this, arguments);
      try { setTimeout(function(){ injectInto('rpt-output', 'conv'); }, 30); } catch(e){}
      return r;
    };
    wrapped.__rchatWrapped = true;
    window.renderReport = wrapped;
    return true;
  }

  function wrapRenderStrategic(){
    var orig = window.renderStrategicIntelReport;
    if (typeof orig !== 'function' || orig.__rchatWrapped) return false;
    var wrapped = function(){
      var r = orig.apply(this, arguments);
      try { setTimeout(function(){ injectInto('si-report-body', 'si'); }, 30); } catch(e){}
      return r;
    };
    wrapped.__rchatWrapped = true;
    window.renderStrategicIntelReport = wrapped;
    return true;
  }

  function tryWrap(){
    var a = wrapRenderReport();
    var b = wrapRenderStrategic();
    return a || b;
  }

  // First attempt now, then retry until the page scripts have defined the functions.
  var tries = 0;
  var iv = setInterval(function(){
    tries++;
    var aDone = (typeof window.renderReport === 'function' && window.renderReport.__rchatWrapped);
    var bDone = (typeof window.renderStrategicIntelReport === 'function' && window.renderStrategicIntelReport.__rchatWrapped);
    tryWrap();
    if ((aDone || typeof window.renderReport === 'function') &&
        (bDone || typeof window.renderStrategicIntelReport === 'function')) {
      // both wrapped (or present and wrapped now); stop after a couple extra ticks
      if (tries > 3) clearInterval(iv);
    }
    if (tries > 40) clearInterval(iv); // ~20s ceiling
  }, 500);

  // Also expose a manual hook for debugging
  window.__rchatInject = injectInto;
})();
