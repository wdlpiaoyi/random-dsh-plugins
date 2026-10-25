/**
 * win-toast — Client half.
 *
 * Clicking a Windows toast runs focus.ps1, which brings DSH forward and
 * publishes the clicked session to %TEMP%\dsh-toast-focus.json. The Host half
 * exposes that request at GET /win-toast/focus; this half polls the route and
 * opens the matching conversation through the workspace service.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-win-toast',
  factory(require) {
    const ROUTE = '/win-toast/focus'
    const POLL_MS = 750

    return {
      inject: ['uiWorkspace'],
      apply(ctx) {
        let disposed = false
        let timer
        let busy = false

        const openSession = (sessionId) => {
          let workspace
          try {
            workspace = ctx.get('uiWorkspace')
          } catch {
            return false
          }
          if (!workspace || typeof workspace.openSession !== 'function') return false
          try {
            workspace.openSession(sessionId)
            return true
          } catch {
            return false
          }
        }

        const tick = async () => {
          if (disposed) return
          if (!busy) {
            busy = true
            try {
              const response = await fetch(ROUTE, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { accept: 'application/json' },
              })
              if (response.ok) {
                const data = await response.json()
                const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : ''
                if (sessionId !== '' && !openSession(sessionId)) {
                  // A session created after the page booted may still be
                  // arriving; refresh the projection and retry once.
                  try { ctx.get('sessions')?.refresh?.() } catch {}
                  setTimeout(() => {
                    if (!disposed) openSession(sessionId)
                  }, 1000)
                }
              }
            } catch {
              // Host may still be starting, or the page was just reloaded:
              // keep polling.
            } finally {
              busy = false
            }
          }
          if (!disposed) timer = setTimeout(tick, POLL_MS)
        }

        ctx.effect(() => {
          disposed = false
          timer = setTimeout(tick, 500)
          return () => {
            disposed = true
            clearTimeout(timer)
          }
        })
      },
    }
  },
})
