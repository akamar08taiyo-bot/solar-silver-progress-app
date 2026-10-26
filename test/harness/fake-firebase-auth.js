const listeners = new Set();
let current = null;
export const getAuth = () => ({});
export const onAuthStateChanged = (_auth, cb) => {
  listeners.add(cb);
  setTimeout(() => cb(current), 0);
  return () => listeners.delete(cb);
};
export const signInAnonymously = async () => {
  current = {uid: 'test-user', isAnonymous: true};
  for (const cb of listeners) setTimeout(() => cb(current), 0);
  return {user: current};
};
export const signInWithCustomToken = async () => {
  throw new Error('no custom token in tests');
};
