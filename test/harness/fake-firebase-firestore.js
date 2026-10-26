// メモリの中だけの Firestore（window.__fakeFS = {'a/b/c/docId': data}）。書いたものは window.__fakeWrites にも記録する
const fs = (window.__fakeFS ??= {});
const writes = (window.__fakeWrites ??= []);
const subs = new Set();
export const getFirestore = () => ({});
export const collection = (_db, ...segs) => ({type: 'col', path: segs.join('/')});
export const doc = (_db, ...segs) => ({type: 'doc', path: segs.join('/'), id: segs.at(-1)});
const snapOf = (ref) => {
  if (ref.type === 'doc') {
    const d = fs[ref.path];
    return {id: ref.id, exists: () => d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d))};
  }
  const prefix = `${ref.path}/`;
  const docs = Object.keys(fs)
    .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
    .map((k) => ({id: k.slice(prefix.length), data: () => structuredClone(fs[k])}));
  return {docs, empty: docs.length === 0, size: docs.length};
};
const emit = () => {
  for (const s of subs) {
    try {
      s.next(snapOf(s.ref));
    } catch (e) {
      console.error(e);
    }
  }
};
export const onSnapshot = (ref, next) => {
  const s = {ref, next};
  subs.add(s);
  setTimeout(() => subs.has(s) && next(snapOf(ref)), 0);
  return () => subs.delete(s);
};
const apply = (op) => {
  writes.push(structuredClone(op));
  if (op.kind === 'set') fs[op.path] = structuredClone(op.data);
  else if (op.kind === 'update') {
    if (fs[op.path] === undefined) throw new Error(`No document to update: ${op.path}`);
    fs[op.path] = {...fs[op.path], ...structuredClone(op.data)};
  } else if (op.kind === 'delete') delete fs[op.path];
};
export const setDoc = async (ref, data) => {
  apply({kind: 'set', path: ref.path, data});
  setTimeout(emit, 0);
};
export const updateDoc = async (ref, data) => {
  apply({kind: 'update', path: ref.path, data});
  setTimeout(emit, 0);
};
export const deleteDoc = async (ref) => {
  apply({kind: 'delete', path: ref.path});
  setTimeout(emit, 0);
};
export const writeBatch = () => {
  const ops = [];
  return {
    set: (ref, data) => ops.push({kind: 'set', path: ref.path, data}),
    update: (ref, data) => ops.push({kind: 'update', path: ref.path, data}),
    delete: (ref) => ops.push({kind: 'delete', path: ref.path}),
    commit: async () => {
      for (const op of ops) apply(op);
      setTimeout(emit, 0);
    },
  };
};
