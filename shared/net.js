// Two-player rooms. Online uses PeerJS (WebRTC, needs the global `Peer` from
// the PeerJS script). Add `?local` to the URL to use BroadcastChannel instead,
// which connects two tabs in the same browser — handy for testing.
//
// room.on('ready')   host: table is open, share the code
// room.on('open')    the other player connected
// room.on('message', data)
// room.on('close')   the other player left
// room.on('error', text)
// room.send(data), room.close()

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(length = 5) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, n => ALPHABET[n % ALPHABET.length]).join('');
}

export const normalizeCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

function emitter() {
  const handlers = {};
  return {
    on(event, fn) { (handlers[event] ||= []).push(fn); return this; },
    emit(event, ...args) { (handlers[event] || []).forEach(fn => fn(...args)); },
  };
}

export function openRoom({ game, role, code, local = new URLSearchParams(location.search).has('local') }) {
  return (local ? localRoom : peerRoom)(`pocketneon-${game}-${code}`.toLowerCase(), role);
}

const PEER_ERRORS = {
  'unavailable-id': 'That table code is already in use. Please try again.',
  'peer-unavailable': 'Table not found. Check the code, and make sure the host still has the page open.',
  network: 'Could not reach the connection server. Check your internet.',
  'server-error': 'The connection server is having trouble. Try again in a moment.',
  'browser-incompatible': 'This browser does not support online play.',
};

function peerRoom(id, role) {
  const room = emitter();
  let conn = null;
  let closed = false;

  const attach = c => {
    conn = c;
    c.on('open', () => room.emit('open'));
    c.on('data', data => room.emit('message', data));
    c.on('close', () => { if (!closed) room.emit('close'); });
  };

  let peer;
  if (role === 'host') {
    peer = new Peer(id);
    peer.on('open', () => room.emit('ready'));
    peer.on('connection', c => {
      if (conn) {
        c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 500); });
        return;
      }
      attach(c);
    });
  } else {
    peer = new Peer();
    peer.on('open', () => attach(peer.connect(id, { reliable: true })));
    const timeout = setTimeout(() => {
      if (!conn?.open && !closed) room.emit('error', PEER_ERRORS['peer-unavailable']);
    }, 20000);
    room.on('open', () => clearTimeout(timeout));
  }

  peer.on('error', err => room.emit('error', PEER_ERRORS[err.type] || `Connection error (${err.type}).`));
  // Losing the signaling server doesn't drop an open game, but reconnect so new joins work.
  peer.on('disconnected', () => { if (!closed && !peer.destroyed) peer.reconnect(); });

  room.send = data => { if (conn?.open) conn.send(data); };
  room.close = () => {
    if (closed) return;
    closed = true;
    conn?.close();
    peer.destroy();
  };
  return room;
}

function localRoom(id, role) {
  const room = emitter();
  const channel = new BroadcastChannel(id);
  const other = role === 'host' ? 'guest' : 'host';
  let open = false;
  let closed = false;
  const post = (kind, data) => channel.postMessage({ from: role, kind, data });
  const opened = () => { if (!open) { open = true; room.emit('open'); } };

  channel.onmessage = ({ data: m }) => {
    if (m.from !== other) return;
    if (m.kind === 'hello') { post('hello-ack'); opened(); }
    else if (m.kind === 'hello-ack') opened();
    else if (m.kind === 'msg' && open) room.emit('message', m.data);
    else if (m.kind === 'bye' && open) { open = false; room.emit('close'); }
  };
  setTimeout(() => {
    if (role === 'host') room.emit('ready');
    post('hello');
  });

  room.send = data => { if (open) post('msg', data); };
  room.close = () => {
    if (closed) return;
    closed = true;
    post('bye');
    channel.close();
  };
  return room;
}
