// multiplayer.js — PeerJS WebRTC P2P networking for PJBoy.
//
// Topology: star. The host accepts connections from every client and acts as
// a relay so all peers see each other. There's no dedicated server: PeerJS
// brokers signalling on their free public server, then traffic is direct WebRTC.
//
// Public API (used by game.js):
//   const net = new MultiplayerNet({
//       onStatus(text, kind),                 // 'idle' | 'connecting' | 'connected' | 'error'
//       onRoster(rosterArray),                // [{id, name, character, hp}, ...]
//       onPeerState(id, state),               // remote snapshot received
//       onPeerLeave(id),                      // peer disconnected
//   });
//   await net.host(displayName);              // → roomCode
//   await net.join(roomCode, displayName);
//   net.broadcast(state);                     // local snapshot { pos, rotY, anim, char, hp }
//   net.disconnect();
//   net.isConnected, net.isHost, net.roomCode

(function () {
    const ROOM_PREFIX = 'pjboy-';
    const PROTOCOL_VERSION = 1;

    // ICE servers for WebRTC NAT traversal. Without TURN, ~30% of peer pairs
    // fail to connect across the open internet (symmetric NAT, mobile carriers,
    // corporate firewalls). The Open Relay Project offers free public TURN for
    // small projects: https://www.metered.ca/tools/openrelay/
    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Open Relay (free public TURN — fine for hobby projects, no SLA)
        { urls: 'turn:openrelay.metered.ca:80',           username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443',          username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ];
    const PEER_OPTIONS = {
        debug: 1,
        config: { iceServers: ICE_SERVERS },
    };

    function randomCode(len = 6) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous
        let s = '';
        for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }

    function normalizeCode(code) {
        return String(code || '').trim().toUpperCase().replace(/^PJBOY-/, '');
    }

    class MultiplayerNet {
        constructor(opts = {}) {
            this.onStatus     = opts.onStatus     || (() => {});
            this.onRoster     = opts.onRoster     || (() => {});
            this.onPeerState  = opts.onPeerState  || (() => {});
            this.onPeerLeave  = opts.onPeerLeave  || (() => {});

            this.peer = null;
            this.isHost = false;
            this.roomCode = null;
            this.isConnected = false;
            this.localName = 'Player';
            this.localId = null;

            // host: map peerId -> { conn, name, character, hp }
            // client: only contains the host entry under hostConn.peer
            this.peers = new Map();
            this.hostConn = null; // client-side connection to host
        }

        _setStatus(text, kind) {
            try { this.onStatus(text, kind || 'idle'); } catch (_) {}
        }

        _emitRoster() {
            const list = [];
            // Include self
            list.push({
                id: this.localId,
                name: this.localName,
                self: true,
                host: this.isHost,
            });
            this.peers.forEach((info, id) => {
                list.push({
                    id,
                    name: info.name || 'Player',
                    character: info.character || null,
                    hp: info.hp,
                    host: !this.isHost && this.hostConn && this.hostConn.peer === id,
                });
            });
            try { this.onRoster(list); } catch (_) {}
        }

        _ensurePeerJs() {
            if (typeof Peer === 'undefined') {
                throw new Error('PeerJS not loaded — check the script tag in index.html');
            }
        }

        async host(displayName) {
            this._ensurePeerJs();
            this.disconnect();
            this.localName = displayName || 'Host';
            this.isHost = true;

            const code = randomCode(6);
            const peerId = ROOM_PREFIX + code;
            this.roomCode = code;

            return new Promise((resolve, reject) => {
                this._setStatus('Creating room…', 'connecting');
                const peer = new Peer(peerId, PEER_OPTIONS);
                this.peer = peer;

                peer.on('open', (id) => {
                    this.localId = id;
                    this.isConnected = true;
                    this._setStatus(`Hosting room ${code}`, 'connected');
                    this._emitRoster();
                    resolve(code);
                });

                peer.on('connection', (conn) => this._handleHostConnection(conn));

                peer.on('error', (err) => {
                    console.error('[mp] peer error', err);
                    // ID-taken is the most common case: retry with a new code
                    if (err && (err.type === 'unavailable-id' || /ID.*taken/i.test(err.message || ''))) {
                        this._setStatus('Room code clash, retrying…', 'connecting');
                        peer.destroy();
                        this.peer = null;
                        // Recurse with a fresh code
                        this.host(displayName).then(resolve, reject);
                        return;
                    }
                    this._setStatus('Error: ' + (err.message || err.type || 'unknown'), 'error');
                    if (!this.isConnected) reject(err);
                });

                peer.on('disconnected', () => {
                    this._setStatus('Disconnected from broker', 'error');
                });
            });
        }

        _handleHostConnection(conn) {
            // Reject if room is full (cap at 7 others = 8 total)
            if (this.peers.size >= 7) {
                conn.on('open', () => {
                    conn.send({ type: 'kick', reason: 'Room is full' });
                    setTimeout(() => conn.close(), 100);
                });
                return;
            }
            const info = { conn, name: 'Player', character: null, hp: 100 };
            this.peers.set(conn.peer, info);

            conn.on('open', () => {
                // Tell new client about everyone already here
                const roster = [];
                this.peers.forEach((p, id) => {
                    if (id === conn.peer) return;
                    roster.push({ id, name: p.name, character: p.character });
                });
                conn.send({
                    type: 'welcome',
                    v: PROTOCOL_VERSION,
                    hostId: this.localId,
                    hostName: this.localName,
                    yourId: conn.peer,
                    roster,
                });
                // Tell every other peer that someone joined
                this.peers.forEach((p, id) => {
                    if (id === conn.peer) return;
                    try { p.conn.send({ type: 'peer-join', id: conn.peer, name: info.name }); } catch (_) {}
                });
                this._emitRoster();
            });

            conn.on('data', (msg) => this._handleHostMessage(conn.peer, msg));

            conn.on('close', () => this._handleHostDisconnect(conn.peer));
            conn.on('error', (err) => {
                console.warn('[mp] conn error', conn.peer, err);
                this._handleHostDisconnect(conn.peer);
            });
        }

        _handleHostDisconnect(peerId) {
            if (!this.peers.has(peerId)) return;
            this.peers.delete(peerId);
            // Notify other clients
            this.peers.forEach((p) => {
                try { p.conn.send({ type: 'peer-leave', id: peerId }); } catch (_) {}
            });
            try { this.onPeerLeave(peerId); } catch (_) {}
            this._emitRoster();
        }

        _handleHostMessage(fromId, msg) {
            if (!msg || typeof msg !== 'object') return;
            const info = this.peers.get(fromId);
            switch (msg.type) {
                case 'hello': {
                    if (info) {
                        info.name = String(msg.name || 'Player').slice(0, 24);
                        info.character = msg.character || null;
                    }
                    this._emitRoster();
                    break;
                }
                case 'state': {
                    if (info) {
                        info.character = msg.char || info.character;
                        info.hp = msg.hp;
                    }
                    try { this.onPeerState(fromId, msg); } catch (_) {}
                    // Fan out to every other client
                    const fanout = { type: 'peer-state', id: fromId, s: msg };
                    this.peers.forEach((p, id) => {
                        if (id === fromId) return;
                        try { p.conn.send(fanout); } catch (_) {}
                    });
                    break;
                }
                case 'event': {
                    // Generic gameplay event (shoot, hit, etc.) — re-broadcast
                    const fanout = { type: 'peer-event', id: fromId, e: msg.e };
                    try { this.onPeerState(fromId, { type: 'event', e: msg.e }); } catch (_) {}
                    this.peers.forEach((p, id) => {
                        if (id === fromId) return;
                        try { p.conn.send(fanout); } catch (_) {}
                    });
                    break;
                }
            }
        }

        async join(rawCode, displayName) {
            this._ensurePeerJs();
            this.disconnect();
            this.localName = displayName || 'Guest';
            this.isHost = false;

            const code = normalizeCode(rawCode);
            if (!/^[A-Z0-9]{4,12}$/.test(code)) {
                throw new Error('Invalid room code');
            }
            const hostId = ROOM_PREFIX + code;
            this.roomCode = code;

            return new Promise((resolve, reject) => {
                this._setStatus('Connecting to ' + code + '…', 'connecting');
                const peer = new Peer(undefined, PEER_OPTIONS);
                this.peer = peer;

                let resolved = false;
                const connectTimeout = setTimeout(() => {
                    if (!resolved) {
                        this._setStatus('Connection timed out', 'error');
                        reject(new Error('Connection timed out — check the code'));
                        this.disconnect();
                    }
                }, 15000);

                peer.on('open', (id) => {
                    this.localId = id;
                    const conn = peer.connect(hostId, { reliable: true });
                    this.hostConn = conn;

                    conn.on('open', () => {
                        this.isConnected = true;
                        clearTimeout(connectTimeout);
                        resolved = true;
                        this._setStatus(`Joined ${code}`, 'connected');
                        conn.send({ type: 'hello', name: this.localName, character: null });
                        this._emitRoster();
                        resolve();
                    });
                    conn.on('data', (msg) => this._handleClientMessage(msg));
                    conn.on('close', () => {
                        this._setStatus('Disconnected from host', 'error');
                        this._handleHostGone();
                    });
                    conn.on('error', (err) => {
                        console.warn('[mp] host conn error', err);
                    });
                });

                peer.on('error', (err) => {
                    console.error('[mp] peer error (join)', err);
                    clearTimeout(connectTimeout);
                    if (err.type === 'peer-unavailable') {
                        this._setStatus('Room not found: ' + code, 'error');
                        reject(new Error('Room not found'));
                    } else {
                        this._setStatus('Error: ' + (err.message || err.type || 'unknown'), 'error');
                        if (!resolved) reject(err);
                    }
                });
            });
        }

        _handleClientMessage(msg) {
            if (!msg || typeof msg !== 'object') return;
            switch (msg.type) {
                case 'welcome': {
                    // Seed roster with host + already-connected peers
                    this.peers.clear();
                    this.peers.set(msg.hostId, { name: msg.hostName || 'Host', character: null, host: true });
                    (msg.roster || []).forEach((entry) => {
                        if (entry.id === this.localId) return;
                        this.peers.set(entry.id, { name: entry.name, character: entry.character || null });
                    });
                    this._emitRoster();
                    break;
                }
                case 'peer-join': {
                    this.peers.set(msg.id, { name: msg.name || 'Player', character: null });
                    this._emitRoster();
                    break;
                }
                case 'peer-leave': {
                    if (this.peers.has(msg.id)) {
                        this.peers.delete(msg.id);
                        try { this.onPeerLeave(msg.id); } catch (_) {}
                        this._emitRoster();
                    }
                    break;
                }
                case 'peer-state': {
                    const info = this.peers.get(msg.id);
                    if (info) {
                        info.character = msg.s.char || info.character;
                        info.hp = msg.s.hp;
                    }
                    try { this.onPeerState(msg.id, msg.s); } catch (_) {}
                    break;
                }
                case 'peer-event': {
                    try { this.onPeerState(msg.id, { type: 'event', e: msg.e }); } catch (_) {}
                    break;
                }
                case 'kick': {
                    this._setStatus('Kicked: ' + (msg.reason || ''), 'error');
                    this.disconnect();
                    break;
                }
            }
        }

        _handleHostGone() {
            // The host went away. Notify game so it removes all remote models.
            this.peers.forEach((_, id) => { try { this.onPeerLeave(id); } catch (_) {} });
            this.peers.clear();
            this.isConnected = false;
            this._emitRoster();
        }

        broadcast(state) {
            if (!this.isConnected) return;
            const msg = Object.assign({ type: 'state' }, state);
            if (this.isHost) {
                // Fan out as peer-state to every client
                const fanout = { type: 'peer-state', id: this.localId, s: msg };
                this.peers.forEach((p) => {
                    if (p.conn && p.conn.open) {
                        try { p.conn.send(fanout); } catch (_) {}
                    }
                });
            } else if (this.hostConn && this.hostConn.open) {
                try { this.hostConn.send(msg); } catch (_) {}
            }
        }

        disconnect() {
            try {
                if (this.hostConn) this.hostConn.close();
            } catch (_) {}
            try {
                if (this.peer && !this.peer.destroyed) this.peer.destroy();
            } catch (_) {}
            // Notify game to drop every remote model
            this.peers.forEach((_, id) => { try { this.onPeerLeave(id); } catch (_) {} });
            this.peers.clear();
            this.hostConn = null;
            this.peer = null;
            this.isConnected = false;
            this.isHost = false;
            this.roomCode = null;
            this.localId = null;
            this._setStatus('Not connected', 'idle');
            this._emitRoster();
        }
    }

    window.MultiplayerNet = MultiplayerNet;
})();
