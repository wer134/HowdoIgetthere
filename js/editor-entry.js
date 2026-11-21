import { scopeEditorStorage } from './util.js';
import { initializeEditorSession, leaveEditor } from './editor-session.js';

try {
  const response = await fetch('/api/session', {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error();
  const session = await response.json();
  if (!session.user?.id) leaveEditor();
  else {
    initializeEditorSession(session);
    scopeEditorStorage(session.user.id);
    await import('./app.js');
    document.body.inert = false;
  }
} catch {
  leaveEditor();
}
