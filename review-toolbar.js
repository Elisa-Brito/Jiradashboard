(function () {
  if (window.__reviewHandoffLoaded) return
  window.__reviewHandoffLoaded = true

  const SUPABASE_URL = 'https://ikmtbhnfipatxecxpyfa.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrbXRiaG5maXBhdHhlY3hweWZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MTE3MzMsImV4cCI6MjA5NzE4NzczM30.Q95hSSGtJcm47xhN7Rn5fFJBvjB94oLjeC3uavLC-Ps'

  let reviewId = null
  let pins = []
  let mode = 'pointer'
  let panelOpen = false
  let pendingPos = null

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
      .rh-pin{position:fixed;width:28px;height:28px;border-radius:50% 50% 50% 0;background:#6366f1;border:2px solid #fff;transform:rotate(-45deg);cursor:pointer;pointer-events:all;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:2147483641;display:flex;align-items:center;justify-content:center}
      .rh-pin.resolved{background:#22c55e}
      .rh-pin span{transform:rotate(45deg);color:#fff;font-size:11px;font-weight:700;font-family:-apple-system,sans-serif}
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
      .rh-status-btn{margin-top:8px;font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:none;color:rgba(255,255,255,.4);cursor:pointer;font-family:inherit}
      #rh-comment-form{padding:12px;border-top:1px solid rgba(255,255,255,.06)}
      #rh-comment-form textarea{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:13px;padding:10px;resize:none;font-family:inherit;box-sizing:border-box;outline:none}
      .rh-form-actions{display:flex;gap:8px;margin-top:8px}
      .rh-btn-cancel{flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:none;color:rgba(255,255,255,.5);font-size:13px;cursor:pointer;font-family:inherit}
      .rh-btn-save{flex:1;padding:8px;border-radius:8px;border:none;background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
      .rh-btn-save:disabled{opacity:.5;cursor:not-allowed}
      #rh-toolbar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;align-items:center;gap:4px;background:#1c1c1f;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:6px 10px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .rh-tool-btn{display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;border:none;background:none;color:rgba(255,255,255,.5);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap}
      .rh-tool-btn:hover{background:rgba(255,255,255,.07);color:#fff}
      .rh-tool-btn.active{background:rgba(99,102,241,.2);color:#a5b4fc}
      .rh-divider{width:1px;height:20px;background:rgba(255,255,255,.08);margin:0 2px}
      #rh-empty{text-align:center;color:rgba(255,255,255,.25);font-size:13px;padding:32px 0;line-height:1.6}
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
      const x = (e.clientX / window.innerWidth) * 100
      const y = (e.clientY / window.innerHeight) * 100
      pendingPos = { x, y }
      openPanel()
      document.getElementById('rh-comment-form').style.display = 'block'
      document.getElementById('rh-textarea').value = ''
      document.getElementById('rh-textarea').focus()
    })
    document.body.appendChild(overlay)

    // Panel
    const panel = document.createElement('div')
    panel.id = 'rh-panel'
    panel.innerHTML = `
      <div id="rh-panel-header">
        <h2>Comentários</h2>
        <button id="rh-panel-close">✕</button>
      </div>
      <div id="rh-pins-list"></div>
      <div id="rh-comment-form" style="display:none">
        <textarea id="rh-textarea" rows="3" placeholder="Digite seu comentário…"></textarea>
        <div class="rh-form-actions">
          <button class="rh-btn-cancel" id="rh-cancel">Cancelar</button>
          <button class="rh-btn-save" id="rh-save">Salvar</button>
        </div>
      </div>
    `
    document.body.appendChild(panel)

    document.getElementById('rh-panel-close').onclick = closePanel
    document.getElementById('rh-cancel').onclick = cancelComment
    document.getElementById('rh-save').onclick = handleSave

    // Toolbar
    const toolbar = document.createElement('div')
    toolbar.id = 'rh-toolbar'
    toolbar.innerHTML = `
      <button class="rh-tool-btn" id="rh-btn-comment">💬 Comentar</button>
      <div class="rh-divider"></div>
      <button class="rh-tool-btn" id="rh-btn-threads">☰ Threads</button>
    `
    document.body.appendChild(toolbar)

    document.getElementById('rh-btn-comment').onclick = () => {
      mode = mode === 'comment' ? 'pointer' : 'comment'
      overlay.classList.toggle('active', mode === 'comment')
      updateToolbar()
      if (mode !== 'comment') cancelComment()
    }
    document.getElementById('rh-btn-threads').onclick = () => {
      panelOpen ? closePanel() : openPanel()
    }

    renderPinsList()
  }

  function openPanel() {
    panelOpen = true
    document.getElementById('rh-panel').classList.add('open')
    updateToolbar()
  }

  function closePanel() {
    panelOpen = false
    document.getElementById('rh-panel').classList.remove('open')
    cancelComment()
    updateToolbar()
  }

  function cancelComment() {
    pendingPos = null
    const form = document.getElementById('rh-comment-form')
    if (form) form.style.display = 'none'
    mode = 'pointer'
    document.getElementById('rh-overlay').classList.remove('active')
    updateToolbar()
  }

  function updateToolbar() {
    document.getElementById('rh-btn-comment')?.classList.toggle('active', mode === 'comment')
    document.getElementById('rh-btn-threads')?.classList.toggle('active', panelOpen)
  }

  function renderPins() {
    document.querySelectorAll('.rh-pin').forEach(el => el.remove())
    pins.forEach((pin, i) => {
      const el = document.createElement('div')
      el.className = 'rh-pin' + (pin.status === 'resolved' ? ' resolved' : '')
      el.style.left = `calc(${pin.x_percent}% - 14px)`
      el.style.top = `calc(${pin.y_percent}% - 14px)`
      el.innerHTML = `<span>${i + 1}</span>`
      el.onclick = (e) => { e.stopPropagation(); openPanel() }
      document.body.appendChild(el)
    })
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
    list.innerHTML = pins.map((pin, i) => `
      <div class="rh-card">
        <div class="rh-card-header">
          <div class="rh-badge ${pin.status === 'resolved' ? 'resolved' : ''}">${i + 1}</div>
          <p class="rh-author">${pin.author_name || 'Anônimo'}</p>
          ${pin.status === 'resolved' ? '<p class="rh-author" style="margin-left:auto;color:#22c55e">✓ resolvido</p>' : ''}
        </div>
        <p class="rh-body">${pin.body}</p>
        <button class="rh-status-btn" data-id="${pin.id}" data-status="${pin.status}">
          ${pin.status === 'open' ? 'Marcar resolvido' : 'Reabrir'}
        </button>
      </div>
    `).join('')

    list.querySelectorAll('.rh-status-btn').forEach(btn => {
      btn.onclick = () => toggleStatus(btn.dataset.id, btn.dataset.status)
    })
  }

  async function handleSave() {
    if (!pendingPos || !reviewId) return
    const body = document.getElementById('rh-textarea').value.trim()
    if (!body) return
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
        author_name: 'Anônimo',
        status: 'open',
      }),
    })
    pins.push(data[0])
    renderPins()
    renderPinsList()
    cancelComment()
    btn.disabled = false
    btn.textContent = 'Salvar'
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

  async function init() {
    try {
      const url = (location.origin + location.pathname).replace(/\/+$/, '') || location.origin
      reviewId = await getOrCreateReview(url)
      const data = await sbFetch(`pins?review_id=eq.${reviewId}&order=created_at.asc`)
      pins = data ?? []
      buildUI()
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
