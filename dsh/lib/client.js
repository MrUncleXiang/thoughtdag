// dsh-thoughtdag client half — the lightest possible browser shim.
// It puts ThoughtDAG where the harness puts its own pages: an entry in the
// sidebar's panel list (beside Plugins and Scheduled tasks) that opens the
// canvas in the main column, through the host's own `main` panel slot and
// `layout.selectPanel`. The canvas itself is a SAME-ORIGIN iframe at
// /thoughtdag/ (the SPA is served by the host half on the same web server —
// no CORS, no second origin). The iframe never lives inside the host's React
// tree: the main slot renders only the selected panel and would unmount it on
// every switch, reloading the canvas. So the panel page is a placeholder that
// fills the main column, and the iframe is a fixed layer laid exactly over
// it while the page is mounted — the host owns navigation, chrome, locale and
// theme; the canvas keeps its state across switches.
//
// Hosts without the panel slot (older harnesses) get the previous door: a
// floating 对话 | 思维图 pill over the chat and a full-window overlay (0.4.19
// to 0.5.18; its placement was the subject of #55, #61, #63 and #73 — every
// spot in a stranger's chrome collides with something, which is why the
// panel entry replaces it wherever the host offers one).
//
// All conversation smarts live inside the ThoughtDAG app; this file only
// opens the door and forwards the current session id so the canvas can offer
// to mirror it. Same pattern as dsh-synapse: window.__ModuleLoader__.load
// with a module whose inject lists the client services it reads and whose
// apply touches the DOM.

window.__ModuleLoader__.load({
  id: 'dsh-thoughtdag',
  factory: (require) => {
    const module = { exports: {} }

    // the host's React, for the two slot components (the sidebar glyph and
    // the panel page); absent on a host that lends none, which also has no
    // panel slot to fill
    let React = null
    try { React = require('react') } catch { React = null }

    // sessions: the current session for the canvas to mirror. uiWorkspace: the
    // harness's directory picker (the OS dialog when the harness runs on this
    // machine, its in-app browser when reached remotely). slots / locale /
    // layout: the panel entry, its label in the host's language, and the
    // switch back to the conversation.
    module.exports.inject = ['sessions', 'uiWorkspace', 'slots', 'locale', 'layout']
    module.exports.apply = ctx => {
      const currentSession = () => {
        const snapshot = ctx.sessions.list.getSnapshot()
        const id = snapshot.current
        if (id === undefined) return null
        const session = snapshot.byId[id]
        return session === undefined ? null : { id, title: session.displayTitle ?? null, cwd: session.cwd ?? null }
      }

      // The sheet is OWNED: the host's module loader claims every untagged
      // <style> for whichever plugin is materializing at that moment and
      // removes it again when that plugin is replaced or reloaded; untagged,
      // this sheet went with a stranger and the overlay collapsed into the
      // document flow (#70). data-plugin names the owner, data-plugin-css the
      // sheet; and apply reuses what an earlier run left, so nothing doubles.
      const CSS_ID = 'dsh-thoughtdag/client.css'
      let style = document.head.querySelector(`style[data-plugin-css="${CSS_ID}"]`)
      if (!style) {
        style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-thoughtdag')
        style.setAttribute('data-plugin-css', CSS_ID)
        document.head.append(style)
      }
      // Panel mode: .dsh-td-page is the placeholder the host renders in its
      // main column; on macOS it pads by the window's top strip (the host's
      // own entry pages do the same) so the canvas toolbar never sits under
      // the traffic lights. .dsh-td-overlay is the iframe's fixed layer, laid
      // over the page by place() — no inset of its own.
      // Fallback mode (no panel slot): the floating pill in the window's top
      // strip, the macOS title band over the strip while the canvas is up
      // (#39), the overlay filling the window below the strip.
      style.textContent = '.dsh-td-page{display:block;width:100%;height:100%;min-height:100%;box-sizing:border-box}html[data-platform="darwin"] .dsh-td-page{padding-top:var(--dsh-frame-top-clearance,0px)}.dsh-td-overlay{position:fixed;z-index:100;background:#faf9f7}.dsh-td-overlay[hidden]{display:none}.dsh-td-overlay iframe{display:block;width:100%;height:100%;border:0}.dsh-td-overlay.dsh-td-full{inset:var(--dsh-frame-top-clearance,0px) 0 0 0}.dsh-td-switch{position:fixed;z-index:120;top:12px;left:60%;display:flex;align-items:center;gap:2px;transform:translateX(-50%);-webkit-app-region:no-drag;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px)}.dsh-td-switch button{height:28px;border:0;border-radius:999px;background:transparent;padding:0 11px;color:#6b7280;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}.dsh-td-switch button:hover{background:#f3f4f6;color:#111827}.dsh-td-switch button.active{background:#111827;color:#fff}.dsh-td-switch .dsh-td-mark{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6d5dfc;box-shadow:0 -7px 0 #a99cff,0 7px 0 #f0a35a;margin:0 6px 0 8px;flex:none}.dsh-td-switch[hidden]{display:none}html[data-platform] .dsh-td-switch,html[data-windows-titlebar] .dsh-td-switch{top:max(2px,calc((var(--dsh-frame-top-clearance,40px) - 36px) / 2))}.dsh-td-bar{position:fixed;z-index:121;top:0;left:0;right:0;height:var(--dsh-frame-top-clearance,0px);display:flex;align-items:center;gap:14px;padding:0 16px;box-sizing:border-box;background:#faf9f7;border-bottom:1px solid #e7e2d9;font:500 12px Inter,system-ui,sans-serif;color:#6b7280;overflow:hidden;-webkit-app-region:drag;user-select:none}.dsh-td-bar[hidden]{display:none}html[data-platform="darwin"] .dsh-td-bar{padding-left:max(var(--dsh-frame-leading-clearance,0px),84px)}html[data-windows-titlebar] .dsh-td-bar{padding-right:calc(100% - env(titlebar-area-width,100%) + 16px)}.dsh-td-bar .dsh-td-brand{display:flex;align-items:center;gap:7px;color:#111827;font-weight:600;font-size:13px;white-space:nowrap}.dsh-td-bar .dsh-td-brand i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6d5dfc;box-shadow:0 -7px 0 #a99cff,0 7px 0 #f0a35a}.dsh-td-bar .dsh-td-switch{position:static;transform:none;-webkit-app-region:no-drag}.dsh-td-bar .dsh-td-title{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6b7280}'

      let host = document.body.querySelector(':scope > [data-dsh-thoughtdag]')
      if (!host) {
        host = document.createElement('div')
        host.setAttribute('data-dsh-thoughtdag', '')
        document.body.append(host)
      }
      host.innerHTML = '<div class="dsh-td-switch" role="group" aria-label="view switch" hidden><i class="dsh-td-mark" title="ThoughtDAG"></i><button type="button" data-view="dialog" class="active" aria-pressed="true">对话</button><button type="button" data-view="map" aria-pressed="false">思维图</button></div><div class="dsh-td-bar" data-window-drag hidden><span class="dsh-td-brand"><i></i>ThoughtDAG</span><div class="dsh-td-switch" role="group" aria-label="view switch"><button type="button" data-view="dialog" aria-pressed="false">对话</button><button type="button" data-view="map" class="active" aria-pressed="true">思维图</button></div><span class="dsh-td-title"></span></div><section class="dsh-td-overlay" hidden><iframe title="ThoughtDAG" data-src="/thoughtdag/"></iframe></section>'

      // the plugin's version, for the canvas's update dialog and release history
      let pluginVersion = null
      fetch('/thoughtdag/api/version').then(r => (r.ok ? r.json() : null)).then(j => { if (j && typeof j.version === 'string') pluginVersion = j.version }).catch(() => {})

      const switchEl = host.querySelector(':scope > .dsh-td-switch')
      const bar = host.querySelector('.dsh-td-bar')
      const barTitle = bar.querySelector('.dsh-td-title')
      const dialogBtn = host.querySelector('[data-view="dialog"]')
      const mapBtn = host.querySelector('[data-view="map"]')
      const overlay = host.querySelector('.dsh-td-overlay')
      const frame = host.querySelector('iframe')
      // the desktop host marks its root; the strip is the window's top band (not in native fullscreen)
      const desktop = () => document.documentElement.dataset.platform !== undefined || document.documentElement.hasAttribute('data-windows-titlebar')
      const strip = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0
      const send = (type, payload) => frame.contentWindow?.postMessage({ source: 'dsh-thoughtdag', type, ...payload }, location.origin)
      const syncCurrent = () => send('td:current-session', { session: currentSession() })
      // the SPA boots on first open, never while hidden: a canvas that
      // measures itself inside a display:none frame fits its view to a 0×0
      // box and shows nothing when revealed
      const ensureSrc = () => { if (!frame.src) frame.src = frame.dataset.src + (pluginVersion ? (frame.dataset.src.includes('?') ? '&' : '?') + 'dv=' + encodeURIComponent(pluginVersion) : '') }

      // ── panel mode: the host's sidebar entry and main-column page ──
      const PANEL_ID = 'thoughtdag'
      const NS = 'dsh-thoughtdag'
      let panelMode = false
      // the page element while the panel is selected (null otherwise)
      let pageEl = null
      let pageObserver = null
      const place = () => {
        if (!pageEl) return
        let box = pageEl
        // the page fills its column; should a host give it no height, the
        // nearest ancestor with one is the column
        for (let i = 0; i < 3 && box.getBoundingClientRect().height < 40 && box.parentElement; i++) box = box.parentElement
        const r = box.getBoundingClientRect()
        const pad = box === pageEl ? parseFloat(getComputedStyle(pageEl).paddingTop) || 0 : 0
        overlay.style.left = r.left + 'px'
        overlay.style.top = (r.top + pad) + 'px'
        overlay.style.width = r.width + 'px'
        overlay.style.height = Math.max(0, r.height - pad) + 'px'
      }
      const openPanel = el => {
        pageEl = el
        ensureSrc()
        overlay.classList.remove('dsh-td-full')
        overlay.hidden = false
        place()
        pageObserver = new ResizeObserver(place)
        pageObserver.observe(el)
        if (el.parentElement) pageObserver.observe(el.parentElement)
        syncCurrent()
        // no band: the host's own column is the canvas's edge; the SPA shows its own switch
        send('td:view', { shown: true, bar: false, desktop: desktop(), panel: true })
        window.setTimeout(() => { if (pageEl) { syncCurrent(); send('td:view', { shown: true, bar: false, desktop: desktop(), panel: true }) } }, 400)
      }
      const closePanel = () => {
        pageEl = null
        pageObserver?.disconnect()
        pageObserver = null
        overlay.hidden = true
        send('td:view', { shown: false, bar: false, desktop: desktop(), panel: true })
      }
      // set once the host has declared the panel slots and taken our entries; a
      // host that never declares them (older harnesses) gets the fallback below
      let registered = false
      if (React && ctx.slots && ctx.layout && ctx.locale && typeof ctx.effect === 'function') {
        try {
          const h = React.createElement
          // the three-dot mark, as the sidebar glyph
          const PanelIcon = ({ size }) => h('svg', { width: size ?? 16, height: size ?? 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
            h('circle', { cx: 8, cy: 3, r: 2.2, fill: '#a99cff' }),
            h('circle', { cx: 8, cy: 8, r: 2.2, fill: '#6d5dfc' }),
            h('circle', { cx: 8, cy: 13, r: 2.2, fill: '#f0a35a' }))
          // the page: a placeholder the iframe layer is laid over while mounted
          const PanelPage = () => {
            const ref = React.useRef(null)
            React.useEffect(() => {
              if (ref.current) openPanel(ref.current)
              return () => closePanel()
            }, [])
            return h('div', { ref, className: 'dsh-td-page', 'data-td-page': '' })
          }
          ctx.effect(() => ctx.locale.register(NS, { zh: { panel: 'ThoughtDAG' }, en: { panel: 'ThoughtDAG' } }), 'dsh-thoughtdag: dictionaries')
          const t = ctx.locale.bind(NS)
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) }, PanelPage))
          ctx.slots.inject('sidebar.panellist', () => { const dispose = ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => t('panel') }, PanelIcon); registered = true; return dispose })
          panelMode = true
        } catch (error) {
          console.warn('[dsh-thoughtdag] panel entry unavailable, using the floating switch:', error)
          panelMode = false
        }
      }

      // ── fallback mode: the floating pill and the full-window overlay ──
      let spaReady = false
      // the band only on macOS: there the strip under the traffic lights is transparent and the host's session
      // header would show through the overlay (#39). On Windows the strip is the host's own chrome (its menu,
      // the caption buttons), opaque and above us; a band there painted over the host's menu (#55). With no
      // band the overlay starts below the chrome and the canvas shows its own switch.
      const barUp = () => !panelMode && document.documentElement.dataset.platform === 'darwin' && strip() > 0
      const setView = map => {
        dialogBtn.classList.toggle('active', !map)
        dialogBtn.setAttribute('aria-pressed', String(!map))
        mapBtn.classList.toggle('active', map)
        mapBtn.setAttribute('aria-pressed', String(map))
      }
      const closeFallback = () => { overlay.hidden = true; bar.hidden = true; switchEl.hidden = false; setView(false); send('td:view', { shown: false, bar: false, desktop: desktop() }) }
      const showBand = () => { bar.hidden = !barUp(); send('td:view', { shown: true, bar: !bar.hidden, desktop: desktop() }) }
      const openFallback = () => {
        overlay.classList.add('dsh-td-full')
        overlay.style.left = overlay.style.top = overlay.style.width = overlay.style.height = ''
        overlay.hidden = false
        setView(true)
        bar.hidden = !barUp()
        if (spaReady || !bar.hidden) switchEl.hidden = true
        ensureSrc()
        syncCurrent()
        showBand()
        // let the SPA boot, then re-sync so its listener is ready
        window.setTimeout(() => { syncCurrent(); showBand() }, 400)
      }
      let fallbackOn = false
      const enableFallback = () => {
        if (fallbackOn) return
        fallbackOn = true
        panelMode = false
        switchEl.hidden = false
        window.addEventListener('resize', () => { if (!overlay.hidden) showBand() })
        bar.querySelector('[data-view="dialog"]').addEventListener('click', closeFallback)
        mapBtn.addEventListener('click', openFallback)
        dialogBtn.addEventListener('click', closeFallback)
      }
      if (!panelMode) enableFallback()
      // the slot system takes registrations only once the host declares the
      // slot; a host that has not declared sidebar.panellist within a moment
      // of our apply has no panel list at all, so the floating switch returns
      else window.setTimeout(() => { if (!registered) { console.warn('[dsh-thoughtdag] no sidebar panel list on this host, using the floating switch'); enableFallback() } }, 2500)

      // back to the conversation: the host's own navigation in panel mode, the overlay's close otherwise
      const close = () => { if (panelMode) { try { ctx.layout.selectPanel(null) } catch { closePanel() } } else closeFallback() }

      window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.data?.source !== 'dsh-thoughtdag') return
        if (event.data.type === 'td:close') return close()
        // the canvas asks for a working directory: open the harness's own
        // picker and hand the path back (null when cancelled; unsupported
        // when this runtime has no picker, so the canvas shows a typed field)
        if (event.data.type === 'td:pick-cwd') {
          const requestId = event.data.requestId
          const pick = ctx.uiWorkspace?.pickDirectory
          if (typeof pick !== 'function') return send('td:picked-cwd', { requestId, path: null, unsupported: true })
          // null = cancelled; a throw = this harness has no OS dialog to show
          // (reached remotely, its picker is the in-app browse kind): the
          // canvas then offers a typed path instead
          Promise.resolve(pick.call(ctx.uiWorkspace))
            .then(path => send('td:picked-cwd', { requestId, path: typeof path === 'string' ? path : null }))
            .catch(() => send('td:picked-cwd', { requestId, path: null, unsupported: true }))
          return
        }
        if (event.data.type === 'td:request-current') {
          // the SPA has booted and shows its own switch: in fallback mode the pill steps aside
          spaReady = true
          if (!panelMode && !overlay.hidden) { switchEl.hidden = true; showBand() }
          if (panelMode && pageEl) send('td:view', { shown: true, bar: false, desktop: desktop(), panel: true })
          return syncCurrent()
        }
        // the canvas names its project: the band shows it (fallback mode only)
        if (event.data.type === 'td:title') { barTitle.textContent = typeof event.data.name === 'string' ? event.data.name : ''; return }
        // the canvas forked or continued a session: stage it and go back to the
        // chat, which now shows exactly the context the canvas produced
        if (event.data.type === 'td:select-session' && typeof event.data.session === 'string') {
          // 0.1.2 renamed the selector: the ISessions contract exposes open(id);
          // older runtimes (0.1.1) still call it select
          const select = ctx.sessions.open ?? ctx.sessions.select
          select.call(ctx.sessions, event.data.session)
          if (event.data.close !== false) close()
          syncCurrent()
        }
      })
    }

    return module.exports
  },
})
