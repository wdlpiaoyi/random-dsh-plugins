/**
 * settings-tweaks — Client half.
 *
 * Moves the two actions that used to live in the bottom-left account menu into
 * Settings, and turns the bottom-left entry into a direct shortcut to Settings:
 *
 *   1. "Sign out" now lives at the bottom of Settings -> Account, under the
 *      account card, with its own inline confirmation.
 *   2. "Feedback" now lives in Settings -> General, between "Developer tools"
 *      and "Current version".
 *   3. Clicking the bottom-left account entry opens Settings instead of
 *      unfolding the menu.
 *
 * It works without touching app.asar: the shipped slot entries are ordinary
 * mutable objects, and the settings renderer reads `entry.component` at render
 * time, so wrapping that field is enough. The shipped AccountMenu keeps being
 * mounted (bonus notices, session-expired toasts, the sign-in dialog and the
 * sign-out confirmation dialog all keep working) — only the trigger click is
 * intercepted. `ctx.effect` restores every wrapped component on unload.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-settings-tweaks',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Fragment, useState } = React

    const LOG = '[settings-tweaks]'
    const NS = 'settings.tweaks'

    const SLOT_LAUNCHER = 'settings.launcher'
    const SLOT_SECTION = 'settings.section'
    const SLOT_GENERAL_ITEM = 'settings.general.item'

    const MENU_TRIGGER = '[aria-haspopup="menu"]'

    const DICT = {
      zh: {
        'feedback.title': '意见反馈',
        'feedback.description': '遇到问题或有建议，可以通过反馈表单告诉我们。',
        'feedback.action': '填写反馈',
        'feedback.failed': '暂时无法打开反馈表单，请稍后再试。',
        signOut: '退出登录',
        signOutDescription: '退出后需要重新登录才能继续使用账号相关的功能。',
        signOutRunningDescription:
          '当前有进程正在执行中，点击“退出登录”，将会打断进程，是否即刻退出登录？',
        signOutUnknownDescription: '无法确认是否有任务正在执行，退出登录可能会打断当前任务。',
        signOutUnavailable: '账号服务暂不可用，无法退出登录。',
        cancel: '取消',
        failed: '退出登录失败，请稍后再试。',
      },
      en: {
        'feedback.title': 'Feedback',
        'feedback.description':
          'Tell us about a problem or a suggestion through the feedback form.',
        'feedback.action': 'Open form',
        'feedback.failed': 'The feedback form could not be opened. Please try again later.',
        signOut: 'Sign out',
        signOutDescription: 'You will need to sign in again to keep using account features.',
        signOutRunningDescription:
          'A process is still running. Signing out will interrupt it. Sign out now?',
        signOutUnknownDescription:
          'Running tasks could not be checked. Signing out may interrupt them.',
        signOutUnavailable: 'The account service is unavailable, so signing out is not possible.',
        cancel: 'Cancel',
        failed: 'Sign out failed. Please try again later.',
      },
    }

    const CARD = {
      border: '0.5px solid var(--dsw-alias-settings-card-stroke)',
      borderRadius: 'var(--dsw-radius-xl)',
      background: 'var(--dsw-alias-settings-card-fill)',
      padding: '12px 16px',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      lineHeight: '22px',
      marginTop: '16px',
      marginBottom: '8px',
    }

    const ROW = {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
    }

    const GENERAL_ROW = {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '24px',
      padding: '16px 0',
      borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-primary)',
    }

    const GENERAL_TITLE = { fontSize: '14px', lineHeight: '20px' }
    const GENERAL_DESC = {
      marginTop: '4px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-secondary)',
    }
    const GENERAL_ERROR = {
      marginTop: '4px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-danger, var(--dsw-alias-label-secondary))',
    }

    const BUTTON = {
      flex: 'none',
      height: '28px',
      padding: '0 12px',
      font: 'inherit',
      fontSize: '13px',
      borderRadius: 'var(--dsw-radius-md)',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
    }

    const BUTTON_PRIMARY = {
      ...BUTTON,
      border: '0.5px solid transparent',
      background: 'var(--dsw-alias-interactive-bg-hover)',
    }

    /** Resolve one visible string: the seat's `t` first, our own dict second. */
    const pick = (t, key, own) => {
      if (typeof t === 'function') {
        try {
          const value = t(key)
          if (typeof value === 'string' && value.length > 0 && value !== key) return value
        } catch {}
      }
      return own(key) ?? key
    }

    /**
     * Replace `entry.component` on every entry of one slot that matches, and
     * keep doing so when the slot is re-registered (the account section comes
     * and goes with the sign-in state). Returns a restore function.
     */
    const wrapEntries = (ctx, slotKey, match, makeWrapper) => {
      const patched = new Map()

      const sync = () => {
        let entries
        try {
          entries = ctx.slots.entries(slotKey) ?? []
        } catch (error) {
          console.warn(LOG, 'cannot read entries of', slotKey, error)
          return
        }
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object' || patched.has(entry)) continue
          let matched = false
          try {
            matched = match(entry) === true
          } catch {
            matched = false
          }
          if (!matched) continue
          const original = entry.component
          if (typeof original !== 'function') continue
          try {
            entry.component = makeWrapper(original, entry)
            patched.set(entry, original)
          } catch (error) {
            console.warn(LOG, 'cannot wrap an entry of', slotKey, error)
          }
        }
      }

      sync()

      let off = () => {}
      try {
        off = ctx.slots.subscribe(slotKey, sync) ?? (() => {})
      } catch (error) {
        console.warn(LOG, 'cannot subscribe to', slotKey, error)
      }

      return () => {
        try {
          off()
        } catch {}
        for (const [entry, original] of patched) {
          try {
            entry.component = original
          } catch {}
        }
        patched.clear()
      }
    }

    /** The shipped account plugin's operation face (signOut, contactUs, hooks). */
    const readAccountOperations = (ctx) => {
      try {
        for (const entry of ctx.slots.entries(SLOT_LAUNCHER) ?? []) {
          if (typeof entry?.inject !== 'function') continue
          try {
            const face = entry.inject()
            if (face && typeof face === 'object') return face
          } catch {}
        }
      } catch {}
      return undefined
    }

    /** Fallback feedback URL when the account plugin's `contactUs` is missing. */
    const fallbackFeedbackUrl = () => {
      const config = globalThis.__DSH_CONTACT_CONFIG__
      const base = config?.contactFormUrl
      if (typeof base !== 'string' || base.length === 0) return undefined
      try {
        const url = new URL(base)
        url.searchParams.set('hide_uid', '1')
        url.searchParams.set('hide_device_info', '1')
        url.searchParams.set('hide_harness_version', '1')
        if (typeof config.contactSource === 'string') {
          url.searchParams.set('prefill_source', config.contactSource)
        }
        return url.toString()
      } catch {
        return undefined
      }
    }

    const useNoopStore = () => undefined

    /* ------------------------------------------------------------------ */
    /* 1. Bottom-left entry opens Settings directly                       */
    /* ------------------------------------------------------------------ */

    const makeLauncherWrapper = (Original) =>
      function SettingsTweaksLauncher(props) {
        const useAccount = typeof props.useAccount === 'function' ? props.useAccount : useNoopStore
        const signedIn = useAccount((state) => state?.view?.status === 'credential-stored')

        const onClickCapture = (event) => {
          if (!signedIn) return
          const hit = event.target?.closest?.(MENU_TRIGGER)
          if (!hit || !event.currentTarget?.contains?.(hit)) return
          event.preventDefault()
          event.stopPropagation()
          try {
            props.openSettings?.()
          } catch (error) {
            console.warn(LOG, 'openSettings failed', error)
          }
        }

        return h(
          'div',
          { style: { display: 'contents' }, onClickCapture },
          h(Original, props),
        )
      }

    /* ------------------------------------------------------------------ */
    /* 2. Sign out card at the bottom of Settings -> Account              */
    /* ------------------------------------------------------------------ */

    const SignOutCard = (props) => {
      const t = props.t
      const own = props.own
      const [phase, setPhase] = useState('idle')
      const [impact, setImpact] = useState(undefined)
      const [error, setError] = useState(undefined)

      const canSignOut = typeof props.signOut === 'function'

      const begin = async () => {
        if (!canSignOut || phase === 'busy' || phase === 'working') return
        setError(undefined)
        setPhase('busy')
        let value
        try {
          const raw = await props.hasRunningAccountTasks?.()
          value = raw === 'unknown' ? 'unknown' : Boolean(raw)
        } catch {
          value = 'unknown'
        }
        setImpact(value)
        setPhase('confirm')
      }

      const confirm = async () => {
        setPhase('working')
        try {
          await props.signOut()
          setPhase('idle')
          setImpact(undefined)
        } catch (failure) {
          console.warn(LOG, 'sign out failed', failure)
          setError(pick(t, 'failed', own))
          setPhase('error')
        }
      }

      const cancel = () => {
        setPhase('idle')
        setImpact(undefined)
      }

      let body
      if (phase === 'confirm' || phase === 'working') {
        const message =
          impact === 'unknown'
            ? pick(t, 'signOutUnknownDescription', own)
            : impact
              ? pick(t, 'signOutRunningDescription', own)
              : pick(t, 'signOutDescription', own)
        body = h(
          Fragment,
          null,
          h('div', { style: { marginTop: '8px' } }, message),
          h(
            'div',
            { style: { ...ROW, justifyContent: 'flex-end', marginTop: '12px', gap: '10px' } },
            h(
              'button',
              { type: 'button', style: BUTTON, onClick: cancel, disabled: phase === 'working' },
              pick(t, 'cancel', own),
            ),
            h(
              'button',
              {
                type: 'button',
                style: BUTTON_PRIMARY,
                onClick: confirm,
                disabled: phase === 'working',
              },
              pick(t, 'signOut', own),
            ),
          ),
        )
      } else {
        body = h(
          'div',
          { style: { ...ROW, marginTop: '8px' } },
          h(
            'div',
            null,
            error ??
              (canSignOut
                ? pick(t, 'signOutDescription', own)
                : pick(t, 'signOutUnavailable', own)),
          ),
          h(
            'button',
            {
              type: 'button',
              style: BUTTON,
              onClick: begin,
              disabled: !canSignOut || phase === 'busy',
            },
            pick(t, 'signOut', own),
          ),
        )
      }

      return h(
        'section',
        { style: CARD, 'aria-label': pick(t, 'signOut', own) },
        h('div', { style: { fontSize: '14px', lineHeight: '20px' } }, pick(t, 'signOut', own)),
        body,
      )
    }

    const makeAccountWrapper = (Original, own) =>
      function SettingsTweaksAccountSection(props) {
        const useAccount = typeof props.useAccount === 'function' ? props.useAccount : useNoopStore
        const signedIn = useAccount((state) => state?.view?.status === 'credential-stored')
        if (!signedIn) return h(Original, props)
        return h(
          Fragment,
          null,
          h(Original, props),
          h(SignOutCard, { ...props, own }),
        )
      }

    /* ------------------------------------------------------------------ */
    /* 3. Feedback row in Settings -> General                             */
    /* ------------------------------------------------------------------ */

    const makeFeedbackRow = (openFeedback, own) =>
      function SettingsTweaksFeedbackRow(props) {
        const t = props.t
        const [failed, setFailed] = useState(false)

        const onClick = () => {
          let opened = false
          try {
            opened = openFeedback() === true
          } catch (error) {
            console.warn(LOG, 'feedback failed', error)
          }
          setFailed(!opened)
        }

        return h(
          'div',
          { style: GENERAL_ROW, 'data-settings-tweaks': 'feedback' },
          h(
            'div',
            { style: { minWidth: '0' } },
            h('div', { style: GENERAL_TITLE }, pick(t, 'feedback.title', own)),
            h('div', { style: GENERAL_DESC }, pick(t, 'feedback.description', own)),
            failed ? h('div', { style: GENERAL_ERROR, role: 'alert' }, pick(t, 'feedback.failed', own)) : null,
          ),
          h(
            'button',
            { type: 'button', style: BUTTON, onClick },
            pick(t, 'feedback.action', own),
          ),
        )
      }

    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],

      apply(ctx) {
        const disposers = []

        let localeSeat
        try {
          localeSeat = ctx.locale.register(NS, DICT)
          if (typeof localeSeat === 'function') disposers.push(localeSeat)
        } catch (error) {
          console.warn(LOG, 'cannot register locale', error)
        }

        const bindT = () => {
          try {
            return ctx.locale.bind(NS)
          } catch {
            return undefined
          }
        }

        const ownFor = (seat) => (key) => {
          const t = seat ?? bindT()
          if (typeof t !== 'function') return undefined
          try {
            const value = t(key)
            return typeof value === 'string' && value !== key ? value : undefined
          } catch {
            return undefined
          }
        }

        const own = ownFor()

        const openFeedback = () => {
          const operations = readAccountOperations(ctx)
          if (typeof operations?.contactUs === 'function') {
            try {
              operations.contactUs()
              return true
            } catch (error) {
              console.warn(LOG, 'contactUs failed', error)
            }
          }
          const url = fallbackFeedbackUrl()
          if (url === undefined) return false
          try {
            const opened = window.open(url, '_blank', 'noopener,noreferrer')
            return opened !== null
          } catch {
            return false
          }
        }

        /* Wrapped entries need a per-instance `own` fallback; it is derived
           lazily so a locale switch is picked up by the next render. */
        const launcherDispose = wrapEntries(
          ctx,
          SLOT_LAUNCHER,
          () => true,
          makeLauncherWrapper,
        )
        disposers.push(launcherDispose)

        const sectionDispose = wrapEntries(
          ctx,
          SLOT_SECTION,
          (entry) => entry.options?.id === 'account',
          (Original) => makeAccountWrapper(Original, own),
        )
        disposers.push(sectionDispose)

        try {
          const off = ctx.slots.inject(SLOT_GENERAL_ITEM, () =>
            ctx.slots.register(
              {
                name: SLOT_GENERAL_ITEM,
                id: 'feedback',
                order: 50,
                locale: NS,
              },
              makeFeedbackRow(openFeedback, own),
            ),
          )
          if (typeof off === 'function') disposers.push(off)
        } catch (error) {
          console.warn(LOG, 'cannot register the feedback row', error)
        }

        /* `own` is handed to the components through the wrapper closures so a
           locale switch does not require re-registering anything. */
        ctx.effect(() => () => {
          for (const dispose of disposers.reverse()) {
            try {
              dispose()
            } catch (error) {
              console.warn(LOG, 'cleanup failed', error)
            }
          }
        })
      },
    }
  },
})
