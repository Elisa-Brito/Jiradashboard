(function () {
  if (window.__reviewHandoffLoaded) return
  window.__reviewHandoffLoaded = true

  const SUPABASE_URL = 'https://ikmtbhnfipatxecxpyfa.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrbXRiaG5maXBhdHhlY3hweWZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MTE3MzMsImV4cCI6MjA5NzE4NzczM30.Q95hSSGtJcm47xhN7Rn5fFJBvjB94oLjeC3uavLC-Ps'
  const API_BASE = 'https://review-handoff-system.vercel.app'
  const LS_NAME_KEY = 'rh_author_name'
  const LS_ID_KEY = 'rh_user_id'

  function getUserId() {
    try {
      let id = localStorage.getItem(LS_ID_KEY)
      if (!id) {
        id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
        localStorage.setItem(LS_ID_KEY, id)
      }
      return id
    } catch { return 'anon' }
  }

  // SVG lixeira — mesmo ícone em todos os lugares, só o tamanho muda
  const trashIcon = (size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>`

  let reviewId = null
  let pins = []
  let replies = {}
  let mode = 'pointer'
  let panelOpen = false
  let activePanel = null
  let pendingPos = null
  let handoffData = null
  let handoffHistory = []
  let handoffLoading = false
  let handoffActivePage = null // url da página selecionada no resultado
  let handoffRepoUrl = ''
  let handoffManualPages = [] // [{ path }]
  let replyingTo = null
  let replyingToReply = null  // { replyId, authorName } para @mention
  let pinPopoverPinId = null

  // Nome persistido via localStorage
  function getSavedName() { try { return localStorage.getItem(LS_NAME_KEY) || '' } catch { return '' } }
  function saveName(name) { try { if (name) localStorage.setItem(LS_NAME_KEY, name) } catch {} }


  async function sbFetch(path, opts = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: opts.prefer || '',
        ...(opts.headers || {}),
      },
    })
    if (res.status === 204) return null
    return res.json()
  }

  async function getOrCreateReview(url) {
    const existing = await sbFetch(`reviews?url=eq.${encodeURIComponent(url)}&select=id&limit=1`)
    if (existing?.length > 0) return existing[0].id
    const created = await sbFetch('reviews?select=id', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify({ url }),
    })
    return created[0].id
  }

  function injectStyles() {
    const css = `
      #rh-overlay{position:fixed;inset:0;z-index:2147483640;pointer-events:none}
      #rh-overlay.active{pointer-events:all;cursor:crosshair}

      /* Popover novo comentário */
      #rh-popover{position:absolute;width:260px;background:#1c1c1f;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.5);z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:none}
      #rh-popover input,#rh-popover textarea{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:13px;padding:8px 10px;font-family:inherit;box-sizing:border-box;outline:none;margin-bottom:8px}
      #rh-popover textarea{resize:none}
      #rh-popover input::placeholder,#rh-popover textarea::placeholder{color:rgba(255,255,255,.3)}
      #rh-popover .rh-form-actions{display:flex;gap:8px;margin-top:4px}

      /* Mini-popover ao clicar no pin */
      #rh-pin-popover{position:absolute;width:240px;background:#1c1c1f;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:none}
      #rh-pin-popover .rh-pp-author{color:rgba(255,255,255,.4);font-size:10px;margin:0 0 4px}
      #rh-pin-popover .rh-pp-body{color:rgba(255,255,255,.88);font-size:13px;line-height:1.5;margin:0 0 8px}
      #rh-pin-popover .rh-pp-replies{display:flex;flex-direction:column;gap:4px;margin-bottom:8px;max-height:140px;overflow-y:auto}
      #rh-pin-popover .rh-pp-reply{background:rgba(255,255,255,.04);border-radius:7px;padding:6px 8px}
      #rh-pin-popover .rh-pp-reply-author{color:rgba(255,255,255,.35);font-size:10px;margin:0 0 2px}
      #rh-pin-popover .rh-pp-reply-body{color:rgba(255,255,255,.7);font-size:12px;line-height:1.4;margin:0}
      #rh-pin-popover .rh-pp-footer{display:flex;gap:6px;align-items:center;border-top:1px solid rgba(255,255,255,.06);padding-top:8px;margin-top:4px}
      #rh-pin-popover .rh-pp-reply-btn{font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(99,102,241,.3);background:rgba(99,102,241,.08);color:#a5b4fc;cursor:pointer;font-family:inherit}
      #rh-pin-popover .rh-pp-reply-btn:hover{background:rgba(99,102,241,.18)}
      #rh-pin-popover .rh-pp-status{font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);cursor:pointer;font-family:inherit}
      #rh-pin-popover .rh-pp-status:hover{background:rgba(255,255,255,.1)}
      #rh-pin-popover .rh-pp-reply-form{margin-top:8px}
      #rh-pin-popover .rh-pp-reply-form textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;padding:7px 9px;font-family:inherit;box-sizing:border-box;outline:none;resize:none;margin-bottom:6px}
      #rh-pin-popover .rh-pp-reply-form textarea::placeholder{color:rgba(255,255,255,.25)}
      #rh-pin-popover .rh-pp-reply-actions{display:flex;gap:6px}
      #rh-pin-popover .rh-pp-cancel{flex:1;padding:6px;border-radius:7px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);font-size:12px;cursor:pointer;font-family:inherit}
      #rh-pin-popover .rh-pp-send{flex:1;padding:6px;border-radius:7px;border:none;background:#6366f1;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
      #rh-pin-popover .rh-pp-send:disabled{opacity:.5;cursor:not-allowed}

      /* Pins */
      .rh-pin{position:absolute;width:28px;height:28px;border-radius:50% 50% 50% 0;background:#6366f1;border:2px solid #fff;transform:rotate(-45deg);cursor:pointer;pointer-events:all;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:2147483641;display:flex;align-items:center;justify-content:center}
      .rh-pin.resolved{background:#22c55e}
      .rh-pin span{transform:rotate(45deg);color:#fff;font-size:11px;font-weight:700;font-family:-apple-system,sans-serif}

      /* Painel lateral */
      #rh-panel{position:fixed;top:0;right:0;width:300px;height:100vh;background:#18181b;border-left:1px solid rgba(255,255,255,.08);z-index:2147483645;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:-4px 0 24px rgba(0,0,0,.4);transform:translateX(100%);transition:transform .2s ease}
      #rh-panel.open{transform:translateX(0)}
      #rh-panel-header{padding:16px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px}
      #rh-panel-header h2{color:#fff;font-size:14px;font-weight:600;margin:0;flex:1}
      #rh-panel-close{background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:18px;padding:4px;line-height:1}
      #rh-pins-list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
      .rh-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:12px}
      .rh-card-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
      .rh-badge{width:20px;height:20px;border-radius:50%;background:#6366f1;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .rh-badge.resolved{background:#22c55e}
      .rh-author{color:rgba(255,255,255,.5);font-size:11px;margin:0}
      .rh-body{color:rgba(255,255,255,.85);font-size:13px;line-height:1.5;margin:0}
      .rh-card-actions{display:flex;gap:6px;margin-top:8px;align-items:center}
      .rh-status-btn{font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:rgba(255,255,255,.8);cursor:pointer;font-family:inherit}
      .rh-status-btn:hover{background:rgba(255,255,255,.12);color:#fff}
      .rh-reply-btn{font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(99,102,241,.3);background:rgba(99,102,241,.08);color:#a5b4fc;cursor:pointer;font-family:inherit}
      .rh-reply-btn:hover{background:rgba(99,102,241,.18);color:#c7d2fe}
      .rh-replies{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:6px}
      .rh-reply{background:rgba(255,255,255,.03);border-radius:8px;padding:8px 10px;position:relative}
      .rh-reply-author{color:rgba(255,255,255,.4);font-size:10px;margin:0 0 3px}
      .rh-reply-body{color:rgba(255,255,255,.75);font-size:12px;line-height:1.5;margin:0}
      .rh-reply-form{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)}
      .rh-reply-form input,.rh-reply-form textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;padding:7px 9px;font-family:inherit;box-sizing:border-box;outline:none;margin-bottom:6px}
      .rh-reply-form textarea{resize:none}
      .rh-reply-form input::placeholder,.rh-reply-form textarea::placeholder{color:rgba(255,255,255,.25)}
      .rh-reply-actions{display:flex;gap:6px}
      .rh-reply-cancel{flex:1;padding:6px;border-radius:7px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:rgba(255,255,255,.8);font-size:12px;cursor:pointer;font-family:inherit}
      .rh-reply-send{flex:1;padding:6px;border-radius:7px;border:none;background:#6366f1;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
      .rh-reply-send:disabled{opacity:.5;cursor:not-allowed}

      /* Lixeira — estilo único para os dois contextos */
      .rh-trash{display:inline-flex;align-items:center;justify-content:center;padding:4px;border-radius:6px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.07);color:#f87171;cursor:pointer;line-height:0}
      .rh-trash:hover{background:rgba(239,68,68,.18);color:#fca5a5;border-color:rgba(239,68,68,.4)}

      .rh-form-actions{display:flex;gap:8px;margin-top:8px}
      .rh-btn-cancel{flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:rgba(255,255,255,.8);font-size:13px;cursor:pointer;font-family:inherit}
      .rh-btn-save{flex:1;padding:8px;border-radius:8px;border:none;background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
      .rh-btn-save:disabled{opacity:.5;cursor:not-allowed}
      #rh-toolbar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;align-items:center;gap:4px;background:#1c1c1f;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:6px 10px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .rh-tool-btn{display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;border:none;background:none;color:rgba(255,255,255,.5);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap}
      .rh-tool-btn:hover{background:rgba(255,255,255,.07);color:#fff}
      .rh-tool-btn.active{background:rgba(99,102,241,.2);color:#a5b4fc}
      .rh-divider{width:1px;height:20px;background:rgba(255,255,255,.08);margin:0 2px}
      #rh-empty{text-align:center;color:rgba(255,255,255,.25);font-size:13px;padding:32px 0;line-height:1.6}
      #rh-handoff-content{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
      .rh-handoff-section{margin-bottom:12px}
      .rh-handoff-label{color:rgba(255,255,255,.4);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px}
      .rh-color-chip{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border-radius:8px;padding:5px 8px;cursor:pointer;margin-bottom:4px}
      .rh-color-dot{width:16px;height:16px;border-radius:4px;border:1px solid rgba(255,255,255,.15);flex-shrink:0}
      .rh-color-name{color:#fff;font-size:11px;font-weight:600}
      .rh-color-hex{color:rgba(255,255,255,.35);font-size:10px}
      .rh-type-row{background:rgba(255,255,255,.04);border-radius:8px;padding:8px;margin-bottom:4px}
      .rh-type-name{color:#fff;font-size:11px;font-weight:600}
      .rh-type-detail{color:rgba(255,255,255,.4);font-size:10px}
      .rh-comp-chip{display:inline-block;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:6px;padding:3px 8px;color:#a5b4fc;font-size:11px;margin:2px}
      .rh-generate-btn{width:100%;padding:10px;border-radius:10px;border:none;background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:8px}
      .rh-generate-btn:disabled{opacity:.5;cursor:not-allowed}
      .rh-regenerate-btn{width:100%;padding:8px;border-radius:10px;border:1px solid rgba(99,102,241,.4);background:rgba(99,102,241,.1);color:#a5b4fc;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:8px}
      .rh-summary-box{background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:10px;padding:12px;margin-bottom:12px}
      .rh-summary-text{color:rgba(255,255,255,.7);font-size:12px;margin:0;line-height:1.6}
    `
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
  }

  function buildUI() {
    injectStyles()

    // Overlay
    const overlay = document.createElement('div')
    overlay.id = 'rh-overlay'
    overlay.addEventListener('click', (e) => {
      if (mode !== 'comment') return
      const container = getPinContainer()
      let x, y
      if (container === document.body) {
        x = (e.pageX / document.documentElement.clientWidth) * 100
        y = (e.pageY / document.documentElement.scrollHeight) * 100
      } else {
        const rect = container.getBoundingClientRect()
        x = ((e.clientX - rect.left + container.scrollLeft) / container.scrollWidth) * 100
        y = ((e.clientY - rect.top + container.scrollTop) / container.scrollHeight) * 100
      }
      pendingPos = { x, y }
      closePinPopover()
      showPopover(e.clientX, e.clientY)
    })
    document.body.appendChild(overlay)

    // Painel lateral
    const panel = document.createElement('div')
    panel.id = 'rh-panel'
    panel.innerHTML = `
      <div id="rh-panel-header">
        <h2 id="rh-panel-title">Comentários</h2>
        <button id="rh-panel-close">✕</button>
      </div>
      <div id="rh-pins-list"></div>
      <div id="rh-handoff-content" style="display:none"></div>
    `
    document.body.appendChild(panel)
    document.getElementById('rh-panel-close').onclick = closePanel

    // Popover novo comentário
    const popover = document.createElement('div')
    popover.id = 'rh-popover'
    popover.innerHTML = `
      <div id="rh-name-field" style="display:none">
        <p style="color:rgba(255,255,255,.5);font-size:11px;margin:0 0 6px">👋 Como quer ser chamado?</p>
        <input id="rh-author-input" type="text" placeholder="Seu nome…" autocomplete="off" />
      </div>
      <p id="rh-popover-author" style="color:rgba(255,255,255,.4);font-size:11px;margin:0 0 8px;display:none"></p>
      <textarea id="rh-textarea" rows="3" placeholder="Digite seu comentário…"></textarea>
      <div class="rh-form-actions">
        <button class="rh-btn-cancel" id="rh-cancel">Cancelar</button>
        <button class="rh-btn-save" id="rh-save">Salvar</button>
      </div>
    `
    document.body.appendChild(popover)
    document.getElementById('rh-cancel').onclick = cancelComment
    document.getElementById('rh-save').onclick = handleSave

    // Mini-popover do pin
    const pinPop = document.createElement('div')
    pinPop.id = 'rh-pin-popover'
    document.body.appendChild(pinPop)

    // Fechar popovers ao clicar fora
    document.addEventListener('click', (e) => {
      const pp = document.getElementById('rh-pin-popover')
      const np = document.getElementById('rh-popover')
      if (pp && !pp.contains(e.target) && !e.target.closest('.rh-pin')) closePinPopover()
      if (np && !np.contains(e.target) && np.style.display !== 'none') {
        if (!e.target.closest('#rh-overlay')) cancelComment()
      }
    }, true)

    // Toolbar
    const toolbar = document.createElement('div')
    toolbar.id = 'rh-toolbar'
    toolbar.innerHTML = `
      <button class="rh-tool-btn" id="rh-btn-comment">💬 Comentar</button>
      <div class="rh-divider"></div>
      <button class="rh-tool-btn" id="rh-btn-threads">☰ Threads</button>
      <div class="rh-divider"></div>
      <button class="rh-tool-btn" id="rh-btn-handoff">✦ Handoff</button>
    `
    document.body.appendChild(toolbar)

    document.getElementById('rh-btn-comment').onclick = () => {
      mode = mode === 'comment' ? 'pointer' : 'comment'
      overlay.classList.toggle('active', mode === 'comment')
      closePinPopover()
      updateToolbar()
      if (mode !== 'comment') cancelComment()
    }
    document.getElementById('rh-btn-threads').onclick = () => {
      activePanel === 'threads' ? closePanel() : openPanel('threads')
    }
    document.getElementById('rh-btn-handoff').onclick = () => {
      activePanel === 'handoff' ? closePanel() : openPanel('handoff')
    }

    renderPinsList()
  }

  // ── Mini-popover do pin ──────────────────────────────────────────────────

  function openPinPopover(pin, pinIndex, anchorEl) {
    pinPopoverPinId = pin.id
    renderPinPopover(pin, pinIndex)

    const pp = document.getElementById('rh-pin-popover')
    pp.style.display = 'block'

    // Posiciona ao lado do pin
    const rect = anchorEl.getBoundingClientRect()
    const pw = 240
    let left = rect.right + window.scrollX + 10
    if (rect.right + pw + 20 > window.innerWidth) left = rect.left + window.scrollX - pw - 10
    let top = rect.top + window.scrollY - 8
    pp.style.left = left + 'px'
    pp.style.top = top + 'px'
  }

  function closePinPopover() {
    pinPopoverPinId = null
    const pp = document.getElementById('rh-pin-popover')
    if (pp) pp.style.display = 'none'
  }

  function renderPinPopover(pin, pinIndex) {
    const pp = document.getElementById('rh-pin-popover')
    if (!pp) return
    const pinReplies = replies[pin.id] || []
    const isReplying = replyingTo === pin.id

    const repliesHTML = pinReplies.length > 0 ? `
      <div class="rh-pp-replies">
        ${pinReplies.map(r => `
          <div class="rh-pp-reply">
            <p class="rh-pp-reply-author">${r.author_name}</p>
            <p class="rh-pp-reply-body">${r.body}</p>
          </div>
        `).join('')}
      </div>
    ` : ''

    const replyFormHTML = isReplying ? `
      <div class="rh-pp-reply-form">
        <textarea rows="2" placeholder="Sua resposta…" id="rh-pp-reply-body"></textarea>
        <div class="rh-pp-reply-actions">
          <button class="rh-pp-cancel" id="rh-pp-cancel-reply">Cancelar</button>
          <button class="rh-pp-send" id="rh-pp-send-reply">Enviar</button>
        </div>
      </div>
    ` : ''

    pp.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px">
        <p class="rh-pp-author" style="margin:0">${pin.author_name || 'Anônimo'} · #${pinIndex + 1}</p>
        <button class="rh-trash" id="rh-pp-delete" title="Deletar comentário" style="flex-shrink:0">${trashIcon(12)}</button>
      </div>
      <p class="rh-pp-body">${pin.body}</p>
      ${repliesHTML}
      ${replyFormHTML}
      <div class="rh-pp-footer">
        <button class="rh-pp-reply-btn" id="rh-pp-reply-toggle">↩ Responder</button>
        <button class="rh-pp-status" id="rh-pp-status-btn">
          ${pin.status === 'open' ? 'Marcar resolvido' : 'Reabrir'}
        </button>
      </div>
    `

    document.getElementById('rh-pp-reply-toggle').onclick = () => {
      replyingTo = replyingTo === pin.id ? null : pin.id
      renderPinPopover(pin, pinIndex)
      if (replyingTo) setTimeout(() => document.getElementById('rh-pp-reply-body')?.focus(), 50)
    }

    document.getElementById('rh-pp-delete').onclick = () => deletePin(pin.id)

    document.getElementById('rh-pp-status-btn').onclick = async () => {
      await toggleStatus(pin.id, pin.status)
      const updated = pins.find(p => p.id === pin.id)
      if (updated) renderPinPopover(updated, pinIndex)
    }

    if (isReplying) {
      document.getElementById('rh-pp-cancel-reply').onclick = () => {
        replyingTo = null
        renderPinPopover(pin, pinIndex)
      }
      document.getElementById('rh-pp-send-reply').onclick = async () => {
        const bodyEl = document.getElementById('rh-pp-reply-body')
        const body = bodyEl?.value.trim()
        if (!body) return
        const sendBtn = document.getElementById('rh-pp-send-reply')
        sendBtn.disabled = true
        sendBtn.textContent = 'Enviando…'
        const authorName = getSavedName() || 'Anônimo'
        const data = await sbFetch('replies?select=*', {
          method: 'POST',
          prefer: 'return=representation',
          body: JSON.stringify({ pin_id: pin.id, author_name: authorName, body }),
        })
        if (data?.[0]) {
          if (!replies[pin.id]) replies[pin.id] = []
          replies[pin.id].push(data[0])
        }
        replyingTo = null
        renderPinPopover(pin, pinIndex)
        renderPinsList()
      }
    }
  }

  // ── Painel e estado ──────────────────────────────────────────────────────

  function openPanel(which) {
    activePanel = which
    panelOpen = true
    closePinPopover()
    document.getElementById('rh-panel').classList.add('open')
    document.getElementById('rh-panel-title').textContent = which === 'handoff' ? 'Handoff' : 'Comentários'
    document.getElementById('rh-pins-list').style.display = which === 'threads' ? 'flex' : 'none'
    document.getElementById('rh-handoff-content').style.display = which === 'handoff' ? 'flex' : 'none'
    cancelComment()
    if (which === 'handoff') renderHandoff()
    updateToolbar()
  }

  function closePanel() {
    panelOpen = false
    activePanel = null
    replyingTo = null
    document.getElementById('rh-panel').classList.remove('open')
    cancelComment()
    updateToolbar()
  }

  function showPopover(clientX, clientY) {
    const pop = document.getElementById('rh-popover')
    const savedName = getSavedName()
    const nameField = document.getElementById('rh-name-field')
    const authorLabel = document.getElementById('rh-popover-author')
    if (savedName) {
      nameField.style.display = 'none'
      authorLabel.style.display = 'block'
      authorLabel.textContent = savedName
    } else {
      nameField.style.display = 'block'
      authorLabel.style.display = 'none'
    }
    document.getElementById('rh-textarea').value = ''
    const pw = 260, ph = 160
    let left = clientX + window.scrollX + 16
    let top = clientY + window.scrollY + 16
    if (clientX + pw + 20 > window.innerWidth) left = clientX + window.scrollX - pw - 8
    if (clientY + ph + 20 > window.innerHeight) top = clientY + window.scrollY - ph - 8
    pop.style.left = left + 'px'
    pop.style.top = top + 'px'
    pop.style.display = 'block'
    if (savedName) {
      document.getElementById('rh-textarea').focus()
    } else {
      document.getElementById('rh-author-input').focus()
    }
  }

  function cancelComment() {
    pendingPos = null
    const pop = document.getElementById('rh-popover')
    if (pop) pop.style.display = 'none'
    mode = 'pointer'
    document.getElementById('rh-overlay').classList.remove('active')
    updateToolbar()
  }

  function updateToolbar() {
    document.getElementById('rh-btn-comment')?.classList.toggle('active', mode === 'comment')
    document.getElementById('rh-btn-threads')?.classList.toggle('active', activePanel === 'threads')
    document.getElementById('rh-btn-handoff')?.classList.toggle('active', activePanel === 'handoff')
  }

  // ── Renderização ─────────────────────────────────────────────────────────

  function currentPath() {
    return location.pathname || '/'
  }

  function isToolbarEl(el) {
    return el.closest('#rh-panel, #rh-toolbar, #rh-popover, #rh-pin-popover, #rh-overlay')
  }

  function detectPageKey() {
    if (location.pathname && location.pathname !== '/') return location.pathname

    // Active nav/sidebar item (outside toolbar)
    const activeNav = [...document.querySelectorAll(
      '[aria-current="page"], nav [class*="active"], aside [class*="active"], ' +
      '[class*="selected"], [class*="current"], [data-active="true"], [data-selected="true"]'
    )].find(el => !isToolbarEl(el))
    if (activeNav) {
      const text = activeNav.textContent.trim().slice(0, 60)
      if (text) return text
    }

    // First visible h1 or h2 outside toolbar
    const heading = [...document.querySelectorAll('h1, h2')]
      .find(el => {
        if (isToolbarEl(el)) return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight
      })
    if (heading) return heading.textContent.trim().slice(0, 60)

    return document.title.slice(0, 60) || 'Home'
  }

  let _currentPageKey = null
  let _pinContainer = null
  let _capturedPages = {} // { pageKey: html }

  function getPinContainer() {
    if (_pinContainer) return _pinContainer
    let best = null, bestArea = 0
    document.querySelectorAll('*').forEach(el => {
      if (el === document.body || el === document.documentElement) return
      const s = window.getComputedStyle(el)
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 10) {
        const area = el.clientWidth * el.clientHeight
        if (area > bestArea) { bestArea = area; best = el }
      }
    })
    _pinContainer = best || document.body
    if (_pinContainer !== document.body) {
      if (window.getComputedStyle(_pinContainer).position === 'static') {
        _pinContainer.style.position = 'relative'
      }
    }
    return _pinContainer
  }

  function visiblePins() {
    const key = _currentPageKey
    return pins.filter(p => {
      if (!p.route_path || p.route_path === '/') return true
      return p.route_path === key
    })
  }

  function renderPins() {
    document.querySelectorAll('.rh-pin').forEach(el => el.remove())
    const container = getPinContainer()
    visiblePins().forEach((pin) => {
      const globalIndex = pins.indexOf(pin)
      const el = document.createElement('div')
      el.className = 'rh-pin' + (pin.status === 'resolved' ? ' resolved' : '')
      if (container === document.body) {
        el.style.left = `calc(${pin.x_percent / 100 * document.documentElement.clientWidth}px - 14px)`
        el.style.top = `calc(${pin.y_percent / 100 * document.documentElement.scrollHeight}px - 14px)`
      } else {
        el.style.left = `calc(${pin.x_percent / 100 * container.scrollWidth}px - 14px)`
        el.style.top = `calc(${pin.y_percent / 100 * container.scrollHeight}px - 14px)`
      }
      el.innerHTML = `<span>${globalIndex + 1}</span>`
      el.onclick = (e) => {
        e.stopPropagation()
        if (pinPopoverPinId === pin.id) { closePinPopover(); return }
        cancelComment()
        openPinPopover(pin, globalIndex, el)
      }
      container.appendChild(el)
    })
  }

  function captureCurrentPage() {
    const key = _currentPageKey
    if (key) _capturedPages[key] = document.documentElement.outerHTML
  }

  // Watch SPA route changes (URL-based and DOM-based)
  function watchRouteChanges() {
    _currentPageKey = detectPageKey()
    setTimeout(captureCurrentPage, 500)

    let debounce = null
    const onPageChange = () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        const newKey = detectPageKey()
        if (newKey !== _currentPageKey) {
          _currentPageKey = newKey
          setTimeout(captureCurrentPage, 300)
          closePinPopover()
          cancelComment()
          renderPins()
        }
      }, 200)
    }

    // URL-based routing
    const orig = history.pushState.bind(history)
    history.pushState = (...args) => { orig(...args); onPageChange() }
    const origReplace = history.replaceState.bind(history)
    history.replaceState = (...args) => { origReplace(...args); onPageChange() }
    window.addEventListener('popstate', onPageChange)

    // DOM-based routing (Zustand, state-driven SPAs)
    const observer = new MutationObserver(onPageChange)
    observer.observe(document.body, { childList: true, subtree: true })
  }

  function renderPinsList() {
    const list = document.getElementById('rh-pins-list')
    if (!list) return
    const open = pins.filter(p => p.status === 'open').length
    document.getElementById('rh-btn-threads').textContent = `☰ Threads${pins.length > 0 ? ` (${open})` : ''}`

    if (pins.length === 0) {
      list.innerHTML = '<div id="rh-empty">Nenhum comentário ainda.<br>Ative o modo comentário e clique na tela.</div>'
      return
    }

    list.innerHTML = pins.map((pin, i) => {
      const pinReplies = replies[pin.id] || []

      const repliesHTML = pinReplies.length > 0 ? `
        <div class="rh-replies">
          ${pinReplies.map(r => `
            <div class="rh-reply">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
                <p class="rh-reply-author" style="margin:0">${r.author_name}</p>
                <div style="display:flex;gap:4px;align-items:center">
                  <button class="rh-reply-to-reply-btn" data-reply-id="${r.id}" data-reply-author="${r.author_name}" data-pin="${pin.id}" style="font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid rgba(99,102,241,.25);background:rgba(99,102,241,.07);color:#a5b4fc;cursor:pointer;font-family:inherit">↩</button>
                  <button class="rh-trash" data-reply-id="${r.id}" data-pin-id="${pin.id}" title="Deletar resposta">${trashIcon(11)}</button>
                </div>
              </div>
              <p class="rh-reply-body">${r.body}</p>
            </div>
          `).join('')}
        </div>
      ` : ''

      const isReplyingToReply = replyingTo === pin.id && replyingToReply
      const replyFormHTML = replyingTo === pin.id ? `
        <div class="rh-reply-form">
          ${isReplyingToReply ? `<p style="color:#a5b4fc;font-size:11px;margin:0 0 6px">↩ respondendo @${replyingToReply.authorName}</p>` : ''}
          <textarea rows="2" placeholder="Sua resposta…" id="rh-reply-body-${pin.id}"></textarea>
          <div class="rh-reply-actions">
            <button class="rh-reply-cancel" data-pin="${pin.id}">Cancelar</button>
            <button class="rh-reply-send" data-pin="${pin.id}">Enviar</button>
          </div>
        </div>
      ` : ''

      return `
        <div class="rh-card" data-pin-id="${pin.id}">
          <div class="rh-card-header">
            <div class="rh-badge ${pin.status === 'resolved' ? 'resolved' : ''}">${i + 1}</div>
            <p class="rh-author">${pin.author_name || 'Anônimo'}</p>
            ${pin.status === 'resolved' ? '<p class="rh-author" style="margin-left:auto;color:#22c55e">✓ resolvido</p>' : ''}
          </div>
          <p class="rh-body">${pin.body}</p>
          <div class="rh-card-actions">
            <button class="rh-reply-btn" data-pin="${pin.id}">↩ Responder</button>
            <button class="rh-status-btn" data-id="${pin.id}" data-status="${pin.status}">
              ${pin.status === 'open' ? 'Marcar resolvido' : 'Reabrir'}
            </button>
            <button class="rh-trash" data-pin-id="${pin.id}" title="Deletar comentário">${trashIcon(13)}</button>
          </div>
          ${repliesHTML}
          ${replyFormHTML}
        </div>
      `
    }).join('')

    list.querySelectorAll('.rh-status-btn').forEach(btn => {
      btn.onclick = () => toggleStatus(btn.dataset.id, btn.dataset.status)
    })
    list.querySelectorAll('.rh-reply-btn').forEach(btn => {
      btn.onclick = () => {
        const same = replyingTo === btn.dataset.pin
        replyingTo = same ? null : btn.dataset.pin
        replyingToReply = null
        renderPinsList()
        if (replyingTo) setTimeout(() => document.getElementById(`rh-reply-body-${replyingTo}`)?.focus(), 50)
      }
    })
    list.querySelectorAll('.rh-reply-to-reply-btn').forEach(btn => {
      btn.onclick = () => {
        replyingTo = btn.dataset.pin
        replyingToReply = { replyId: btn.dataset.replyId, authorName: btn.dataset.replyAuthor }
        renderPinsList()
        setTimeout(() => document.getElementById(`rh-reply-body-${btn.dataset.pin}`)?.focus(), 50)
      }
    })
    list.querySelectorAll('.rh-reply-cancel').forEach(btn => {
      btn.onclick = () => { replyingTo = null; replyingToReply = null; renderPinsList() }
    })
    list.querySelectorAll('.rh-reply-send').forEach(btn => {
      btn.onclick = () => sendReply(btn.dataset.pin)
    })
    // lixeiras — distingue pin vs reply pelo dataset
    list.querySelectorAll('.rh-trash').forEach(btn => {
      if (btn.dataset.replyId) {
        btn.onclick = () => deleteReply(btn.dataset.replyId, btn.dataset.pinId)
      } else {
        btn.onclick = () => deletePin(btn.dataset.pinId)
      }
    })
  }

  // ── Ações ────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!pendingPos || !reviewId) return
    const body = document.getElementById('rh-textarea').value.trim()
    if (!body) return
    const inputName = document.getElementById('rh-author-input')?.value.trim()
    if (inputName) saveName(inputName)
    const authorName = getSavedName() || inputName || 'Anônimo'
    const btn = document.getElementById('rh-save')
    btn.disabled = true
    btn.textContent = 'Salvando…'
    const data = await sbFetch('pins?select=*', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify({
        review_id: reviewId,
        x_percent: pendingPos.x,
        y_percent: pendingPos.y,
        body,
        author_name: authorName,
        status: 'open',
        route_path: _currentPageKey || detectPageKey(),
      }),
    })
    pins.push(data[0])
    replies[data[0].id] = []
    renderPins()
    renderPinsList()
    document.getElementById('rh-popover').style.display = 'none'
    pendingPos = null
    mode = 'pointer'
    document.getElementById('rh-overlay').classList.remove('active')
    updateToolbar()
    btn.disabled = false
    btn.textContent = 'Salvar'
  }

  async function sendReply(pinId) {
    const bodyEl = document.getElementById(`rh-reply-body-${pinId}`)
    const rawBody = bodyEl?.value.trim()
    if (!rawBody) return
    const mention = replyingToReply ? `@${replyingToReply.authorName} ` : ''
    const body = mention + rawBody
    const authorName = getSavedName() || 'Anônimo'
    const sendBtn = document.querySelector(`.rh-reply-send[data-pin="${pinId}"]`)
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Enviando…' }
    const data = await sbFetch('replies?select=*', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify({ pin_id: pinId, author_name: authorName, body }),
    })
    if (data?.[0]) {
      if (!replies[pinId]) replies[pinId] = []
      replies[pinId].push(data[0])
    }
    replyingTo = null
    replyingToReply = null
    renderPinsList()
  }

  async function deletePin(pinId) {
    if (!confirm('Deletar este comentário e todas as respostas?')) return
    await sbFetch(`pins?id=eq.${pinId}`, { method: 'DELETE', prefer: 'return=minimal' })
    pins = pins.filter(p => p.id !== pinId)
    delete replies[pinId]
    if (replyingTo === pinId) replyingTo = null
    if (pinPopoverPinId === pinId) closePinPopover()
    renderPins()
    renderPinsList()
  }

  async function deleteReply(replyId, pinId) {
    await sbFetch(`replies?id=eq.${replyId}`, { method: 'DELETE', prefer: 'return=minimal' })
    if (replies[pinId]) replies[pinId] = replies[pinId].filter(r => r.id !== replyId)
    renderPinsList()
    // Atualiza mini-popover se estiver aberto no mesmo pin
    if (pinPopoverPinId === pinId) {
      const pin = pins.find(p => p.id === pinId)
      const idx = pins.indexOf(pin)
      if (pin) renderPinPopover(pin, idx)
    }
  }

  async function toggleStatus(pinId, current) {
    const next = current === 'open' ? 'resolved' : 'open'
    await sbFetch(`pins?id=eq.${pinId}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({ status: next }),
    })
    const pin = pins.find(p => p.id === pinId)
    if (pin) pin.status = next
    renderPins()
    renderPinsList()
  }

  // ── Handoff ──────────────────────────────────────────────────────────────

  function renderPageSection(page) {
    return `
      ${page.colors?.length ? `
        <div class="rh-handoff-section">
          <p class="rh-handoff-label">🎨 Cores</p>
          ${page.colors.map(c => `
            <div class="rh-color-chip" onclick="navigator.clipboard.writeText('${c.hex}')">
              <div class="rh-color-dot" style="background:${c.hex}"></div>
              <div><div class="rh-color-name">${c.name}</div><div class="rh-color-hex">${c.hex}</div></div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${page.typography?.length ? `
        <div class="rh-handoff-section">
          <p class="rh-handoff-label">✏️ Tipografia</p>
          ${page.typography.map(t => `
            <div class="rh-type-row">
              <div class="rh-type-name">${t.name}</div>
              <div class="rh-type-detail">${t.fontFamily} · ${t.fontSize}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${page.components?.length ? `
        <div class="rh-handoff-section">
          <p class="rh-handoff-label">🧩 Componentes</p>
          <div>${page.components.map(c => `<span class="rh-comp-chip">${c.name}</span>`).join('')}</div>
        </div>
      ` : ''}
    `
  }

  function renderHandoff() {
    const container = document.getElementById('rh-handoff-content')
    if (!container) return

    if (!handoffData) {
      const manualPagesHTML = handoffManualPages.map((p, i) => `
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="text" value="${p.path}" placeholder="/pagina" data-page-idx="${i}"
            style="flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;padding:6px 9px;font-family:inherit;box-sizing:border-box;outline:none" class="rh-page-input" />
          <button data-del-idx="${i}" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.07);color:#f87171;cursor:pointer;font-size:11px" class="rh-del-page">${trashIcon(11)}</button>
        </div>
      `).join('')

      container.innerHTML = `
        <div class="rh-handoff-section">
          <p class="rh-handoff-label">Repositório (opcional)</p>
          <input id="rh-repo-input" type="text" value="${handoffRepoUrl}" placeholder="https://github.com/user/repo"
            style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;font-size:12px;padding:7px 9px;font-family:inherit;box-sizing:border-box;outline:none;margin-bottom:4px" />
        </div>
        <div class="rh-handoff-section">
          <p class="rh-handoff-label" style="display:flex;align-items:center;justify-content:space-between">
            Páginas adicionais
            <button id="rh-add-page" style="font-size:11px;padding:2px 8px;border-radius:5px;border:1px solid rgba(99,102,241,.3);background:rgba(99,102,241,.08);color:#a5b4fc;cursor:pointer;font-family:inherit">+ Adicionar</button>
          </p>
          <div id="rh-pages-list">${manualPagesHTML}</div>
          <p style="color:rgba(255,255,255,.25);font-size:11px;margin:4px 0 0;line-height:1.5">
            Deixe vazio para analisar só a URL atual.<br>Ou adicione rotas como /dashboard, /login…
          </p>
        </div>
        <button class="rh-generate-btn" id="rh-gen-btn" ${handoffLoading ? 'disabled' : ''}>
          ${handoffLoading ? '✨ Analisando…' : '✨ Gerar Handoff'}
        </button>
        ${handoffLoading ? '<p style="color:rgba(255,255,255,.25);font-size:11px;text-align:center;margin-top:8px">Isso pode levar 30–60 segundos…</p>' : ''}
        ${handoffHistory.length > 0 ? `
          <p class="rh-handoff-label" style="margin-top:16px">Histórico</p>
          ${handoffHistory.map((h, i) => `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <button style="flex:1;text-align:left;padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:rgba(255,255,255,.4);font-size:12px;cursor:pointer;font-family:inherit" data-idx="${i}" class="rh-hist-btn">
                ${i === 0 ? '● ' : '○ '}${new Date(h.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </button>
              <button class="rh-trash rh-hist-del" data-hist-id="${h.id}" data-hist-idx="${i}" title="Deletar">${trashIcon(11)}</button>
            </div>
          `).join('')}
        ` : ''}
      `

      document.getElementById('rh-repo-input').oninput = (e) => { handoffRepoUrl = e.target.value }
      document.getElementById('rh-add-page').onclick = () => {
        handoffManualPages.push({ path: '' })
        renderHandoff()
        setTimeout(() => {
          const inputs = document.querySelectorAll('.rh-page-input')
          inputs[inputs.length - 1]?.focus()
        }, 50)
      }
      container.querySelectorAll('.rh-page-input').forEach(input => {
        input.oninput = (e) => { handoffManualPages[+e.target.dataset.pageIdx].path = e.target.value }
      })
      container.querySelectorAll('.rh-del-page').forEach(btn => {
        btn.onclick = () => { handoffManualPages.splice(+btn.dataset.delIdx, 1); renderHandoff() }
      })
      document.getElementById('rh-gen-btn')?.addEventListener('click', generateHandoff)
      container.querySelectorAll('.rh-hist-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          handoffData = handoffHistory[+btn.dataset.idx].data
          handoffActivePage = handoffData.pages?.[0]?.url ?? null
          renderHandoff()
        })
      })
      container.querySelectorAll('.rh-hist-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.histId
          const idx = +btn.dataset.histIdx
          await fetch(`${API_BASE}/api/handoff?id=${id}`, { method: 'DELETE' })
          handoffHistory.splice(idx, 1)
          renderHandoff()
        })
      })
      return
    }

    // ── Resultado por página ──
    const d = handoffData
    const pages = d.pages ?? []
    const activePage = pages.find(p => p.url === handoffActivePage) ?? pages[0]

    const tabsHTML = pages.length > 1 ? `
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">
        ${pages.map(p => `
          <button class="rh-page-tab ${p.url === activePage?.url ? 'active' : ''}" data-url="${p.url}">
            ${p.label}
          </button>
        `).join('')}
      </div>
    ` : ''

    container.innerHTML = `
      <style>
        .rh-page-tab{padding:4px 10px;border-radius:20px;border:1px solid rgba(255,255,255,.12);background:none;color:rgba(255,255,255,.4);font-size:11px;cursor:pointer;font-family:inherit;white-space:nowrap}
        .rh-page-tab.active{background:rgba(99,102,241,.2);border-color:rgba(99,102,241,.4);color:#a5b4fc}
      </style>
      <div class="rh-summary-box"><p class="rh-summary-text">${d.summary || ''}</p></div>
      ${tabsHTML}
      <div id="rh-page-content">
        ${activePage ? renderPageSection(activePage) : ''}
      </div>
      <button class="rh-regenerate-btn" id="rh-regen-btn">↺ Gerar novamente</button>
    `

    container.querySelectorAll('.rh-page-tab').forEach(btn => {
      btn.onclick = () => {
        handoffActivePage = btn.dataset.url
        renderHandoff()
      }
    })
    document.getElementById('rh-regen-btn').onclick = () => { handoffData = null; handoffActivePage = null; renderHandoff() }
  }

  async function generateHandoff() {
    if (!reviewId) return
    handoffRepoUrl = document.getElementById('rh-repo-input')?.value.trim() ?? handoffRepoUrl
    handoffLoading = true
    renderHandoff()
    try {
      // Capture current page if not already captured
      captureCurrentPage()

      // Use captured snapshots from navigation
      const pages = Object.entries(_capturedPages).map(([label, html]) => ({
        url: location.origin + (location.pathname !== '/' ? location.pathname : '') + '#' + label,
        label,
        html,
      }))

      const res = await fetch(`${API_BASE}/api/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vercelUrl: location.origin,
          reviewId,
          repoUrl: handoffRepoUrl || undefined,
          pages,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      handoffData = data.handoff
      handoffActivePage = data.handoff.pages?.[0]?.url ?? null
      if (data.id) handoffHistory.unshift({ id: data.id, created_at: data.created_at, data: data.handoff })
    } catch (e) {
      console.error('[review-handoff] handoff error:', e)
    } finally {
      handoffLoading = false
      renderHandoff()
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    getUserId()
    startApp()
  }

  async function startApp() {
    try {
      const url = (location.origin + location.pathname).replace(/\/+$/, '') || location.origin
      reviewId = await getOrCreateReview(url)

      const [pinsData, hist] = await Promise.all([
        sbFetch(`pins?review_id=eq.${reviewId}&order=created_at.asc`),
        fetch(`${API_BASE}/api/handoff?reviewId=${reviewId}`).then(r => r.json()).catch(() => []),
      ])

      pins = pinsData ?? []
      replies = {}
      pins.forEach(p => { replies[p.id] = [] })

      if (pins.length > 0) {
        const pinIds = pins.map(p => p.id).join(',')
        const repliesData = await sbFetch(`replies?pin_id=in.(${pinIds})&order=created_at.asc`)
        if (repliesData && !repliesData.error) {
          repliesData.forEach(r => {
            if (replies[r.pin_id]) replies[r.pin_id].push(r)
          })
        }
      }

      handoffHistory = hist ?? []
      if (handoffHistory.length > 0) handoffData = handoffHistory[0].data

      buildUI()
      watchRouteChanges()
      renderPins()
    } catch (e) {
      console.error('[review-handoff]', e)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
