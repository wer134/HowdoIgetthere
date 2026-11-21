export let editorSession = null;
export let leavingEditor = false;

export function leaveEditor() {
  if (leavingEditor) return;
  leavingEditor = true;
  document.documentElement.hidden = true;
  location.replace('/');
}

export function initializeEditorSession(session) {
  editorSession = session;
  async function checkSession() {
    try {
      const response = await fetch('/api/session', {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(10000)});
      if (response.ok && (await response.json()).user?.id !== session.user.id) leaveEditor();
    } catch { /* Offline edits stay available until the session can be checked. */ }
  }
  window.addEventListener('pagehide', () => { document.documentElement.hidden = true; });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
  window.addEventListener('focus', checkSession);
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('routeflow.sessions') : null;
  channel?.addEventListener('message', event => { if (event.data === 'logout') checkSession(); });
  window.addEventListener('routeflow-logout', () => channel?.postMessage('logout'));
}
