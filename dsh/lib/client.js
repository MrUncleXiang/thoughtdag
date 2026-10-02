// dsh-thoughtdag client half — the lightest possible browser shim.
// It renders a floating "对话 | 思维图" switch over the harness UI and, on
// "思维图", shows a full-screen SAME-ORIGIN iframe at /thoughtdag/ (the SPA
// is served by the host half on the same web server — no CORS, no second
// origin). The switch floats on purpose: it is there before any session is
// open (0.4.18 moved it into the session header, which hid it on the empty
// page; withdrawn in 0.4.19). While the canvas is up, the SPA shows the same
// switch in its own top bar, next to the canvas chip, so nothing floats over
// the canvas toolbar at any width: the pill hides once the SPA has booted
// and comes back when the canvas closes (0.4.20). All conversation smarts live inside the ThoughtDAG app; this file
// only opens the door and forwards the current session id so the canvas can
// offer to mirror it.
//
// Same pattern as dsh-synapse: window.__ModuleLoader__.load with a module
// whose inject lists the client services it reads (sessions) and whose apply
// touches the DOM.

window.__ModuleLoader__.load({
  id: 'dsh-thoughtdag',
  factory: () => {
    const module = { exports: {} }

    // uiWorkspace: the harness's directory picker (the OS dialog when the
    // harness runs on this machine, its in-app browser when reached remotely)
    module.exports.inject = ['sessions', 'uiWorkspace']
    module.exports.apply = ctx => {
      const currentSession = () => {
        const snapshot = ctx.sessions.list.getSnapshot()
        const id = snapshot.current
        if (id === undefined) return null
        const session = snapshot.byId[id]
        return session === undefined ? null : { id, title: session.displayTitle ?? null, cwd: session.cwd ?? null }
      }

      const style = document.createElement('style')
      // The map overlay starts below the window's top strip: the desktop host
      // publishes --dsh-frame-top-clearance on its root (48px under the
      // hiddenInset traffic lights on macOS, the caption height on Windows,
      // 0 in native fullscreen). In that strip the plugin draws a title band
      // of its own: the ThoughtDAG name, the 对话|思维图 switch and the canvas's
      // name, draggable like the host's own chrome rows (data-window-drag),
      // starting past the traffic lights (--dsh-frame-leading-clearance while
      // the sidebar is collapsed, 84px otherwise, since the overlay covers the
      // sidebar too) and stopping short of the Windows caption buttons. So
      // the lights and the window controls are never covered, and nothing of
      // the host's session header shows through (#39). A browser tab has no
      // clearance: no band, the overlay fills the window, the canvas keeps its
      // own switch.
      // The floating pill sits in the window's top strip, centre-right, on every platform: 12px down in a
      // browser tab, vertically centred in the host's own strip on the desktop (40px on Windows, 48px on
      // macOS). It is no-drag, so the strip's drag region never takes its clicks (#55: pinned half into the
      // drag region without no-drag, its upper half was swallowed; moved below the strip, it landed in the
      // host's session header). Centre-right keeps it clear of the host's menu on the left and the window
      // controls on the right.
      style.textContent = '.dsh-td-switch{position:fixed;z-index:120;top:12px;left:60%;display:flex;align-items:center;gap:2px;transform:translateX(-50%);-webkit-app-region:no-drag;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px)}.dsh-td-switch button{height:28px;border:0;border-radius:999px;background:transparent;padding:0 11px;color:#6b7280;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}.dsh-td-switch button:hover{background:#f3f4f6;color:#111827}.dsh-td-switch button.active{background:#111827;color:#fff}.dsh-td-switch .dsh-td-mark{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6d5dfc;box-shadow:0 -7px 0 #a99cff,0 7px 0 #f0a35a;margin:0 6px 0 8px;flex:none}.dsh-td-switch[hidden]{display:none}html[data-platform] .dsh-td-switch,html[data-windows-titlebar] .dsh-td-switch{top:max(2px,calc((var(--dsh-frame-top-clearance,40px) - 36px) / 2))}.dsh-td-bar{position:fixed;z-index:121;top:0;left:0;right:0;height:var(--dsh-frame-top-clearance,0px);display:flex;align-items:center;gap:14px;padding:0 16px;box-sizing:border-box;background:#faf9f7;border-bottom:1px solid #e7e2d9;font:500 12px Inter,system-ui,sans-serif;color:#6b7280;overflow:hidden;-webkit-app-region:drag;user-select:none}.dsh-td-bar[hidden]{display:none}html[data-platform="darwin"] .dsh-td-bar{padding-left:max(var(--dsh-frame-leading-clearance,0px),84px)}html[data-windows-titlebar] .dsh-td-bar{padding-right:calc(100% - env(titlebar-area-width,100%) + 16px)}.dsh-td-bar .dsh-td-brand{display:flex;align-items:center;gap:7px;color:#111827;font-weight:600;font-size:13px;white-space:nowrap}.dsh-td-bar .dsh-td-brand i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6d5dfc;box-shadow:0 -7px 0 #a99cff,0 7px 0 #f0a35a}.dsh-td-bar .dsh-td-switch{position:static;transform:none;-webkit-app-region:no-drag}.dsh-td-bar .dsh-td-title{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6b7280}.dsh-td-overlay{position:fixed;z-index:100;inset:var(--dsh-frame-top-clearance,0px) 0 0 0;background:#faf9f7}.dsh-td-overlay[hidden]{display:none}.dsh-td-overlay iframe{display:block;width:100%;height:100%;border:0}'
      document.head.append(style)

      const host = document.createElement('div')
      host.innerHTML = '<div class="dsh-td-switch" role="group" aria-label="view switch"><i class="dsh-td-mark" title="ThoughtDAG"></i><button type="button" data-view="dialog" class="active" aria-pressed="true">对话</button><button type="button" data-view="map" aria-pressed="false">思维图</button></div><div class="dsh-td-bar" data-window-drag hidden><span class="dsh-td-brand"><i></i>ThoughtDAG</span><div class="dsh-td-switch" role="group" aria-label="view switch"><button type="button" data-view="dialog" aria-pressed="false">对话</button><button type="button" data-view="map" class="active" aria-pressed="true">思维图</button></div><span class="dsh-td-title"></span></div><section class="dsh-td-overlay" hidden><iframe title="ThoughtDAG" data-src="/thoughtdag/"></iframe></section>'
      document.body.append(host)

      // the plugin's version, for the canvas's update dialog and release history
      let pluginVersion = null
      fetch('/thoughtdag/api/version').then(r => (r.ok ? r.json() : null)).then(j => { if (j && typeof j.version === 'string') pluginVersion = j.version }).catch(() => {})

      const switchEl = host.querySelector(':scope > .dsh-td-switch')
      const bar = host.querySelector('.dsh-td-bar')
      const barTitle = bar.querySelector('.dsh-td-title')
      // the desktop host marks its root; the band exists only there, and only while the strip has height (not in native fullscreen)
      const desktop = () => document.documentElement.dataset.platform !== undefined || document.documentElement.hasAttribute('data-windows-titlebar')
      const strip = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0
      // the band only on macOS: there the strip under the traffic lights is transparent and the host's session
      // header would show through the overlay (#39). On Windows the strip is the host's own chrome (its menu,
      // the caption buttons), opaque and above us; a band there painted over the host's menu (#55). With no
      // band the overlay starts below the chrome and the canvas shows its own switch.
      const barUp = () => document.documentElement.dataset.platform === 'darwin' && strip() > 0
      let spaReady = false
      const dialogBtn = host.querySelector('[data-view="dialog"]')
      const mapBtn = host.querySelector('[data-view="map"]')
      const overlay = host.querySelector('.dsh-td-overlay')
      const frame = host.querySelector('iframe')

      const setView = map => {
        dialogBtn.classList.toggle('active', !map)
        dialogBtn.setAttribute('aria-pressed', String(!map))
        mapBtn.classList.toggle('active', map)
        mapBtn.setAttribute('aria-pressed', String(map))
      }
      const close = () => { overlay.hidden = true; bar.hidden = true; switchEl.hidden = false; setView(false); send('td:view', { shown: false, bar: false, desktop: desktop() }) }
      const showBand = () => { bar.hidden = !barUp(); send('td:view', { shown: true, bar: !bar.hidden, desktop: desktop() }) }
      window.addEventListener('resize', () => { if (!overlay.hidden) showBand() })
      bar.querySelector('[data-view="dialog"]').addEventListener('click', () => close())
      const send = (type, payload) => frame.contentWindow?.postMessage({ source: 'dsh-thoughtdag', type, ...payload }, location.origin)

      const syncCurrent = () => {
        const session = currentSession()
        send('td:current-session', { session })
      }

      mapBtn.addEventListener('click', () => {
        overlay.hidden = false
        setView(true)
        bar.hidden = !barUp()
        if (spaReady || !bar.hidden) switchEl.hidden = true
        // the SPA boots on first open, never while hidden: a canvas that
        // measures itself inside a display:none frame fits its view to a 0×0
        // box and shows nothing when revealed
        if (!frame.src) frame.src = frame.dataset.src + (pluginVersion ? (frame.dataset.src.includes('?') ? '&' : '?') + 'dv=' + encodeURIComponent(pluginVersion) : '')
        syncCurrent()
        showBand()
        // let the SPA boot, then re-sync so its listener is ready
        window.setTimeout(() => { syncCurrent(); showBand() }, 400)
      })
      dialogBtn.addEventListener('click', close)

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
          // the SPA has booted and shows its own switch: the pill steps aside
          spaReady = true
          if (!overlay.hidden) { switchEl.hidden = true; showBand() }
          return syncCurrent()
        }
        // the canvas names its project: the band shows it
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
