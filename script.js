// Planning Poker front-end (Firebase Firestore, anonymous auth)
// Works on static hosting like GitHub Pages.
// Room is determined by ?room=<id> query param. If missing, user can create a new room.

(function () {
    const cards = ['0.5', '1', '2', '3', '5', '8', '13', '20', '☕', '∞'];
    const $ = (id) => document.getElementById(id);

    // Resolve room
    const url = new URL(location.href);
    let roomId = url.searchParams.get('room') || '';
    const roomIdLabel = $('roomIdLabel');
    const statusPill = $('status');
    let _roomReveal = false;

    function randomRoomId() {
        return Math.random().toString(36).slice(2, 8);
    }

    function setStatus(text) {
        statusPill.textContent = text;
    }

    // Firebase init
    if (!window.FIREBASE_CONFIG) {
        alert("Missing Firebase config. Copy config.example.js to config.js and fill in your project's keys.");
    }
    firebase.initializeApp(window.FIREBASE_CONFIG);
    const auth = firebase.auth();
    const db = firebase.firestore();

    // Auth anon
    let currentUser = null;
    auth.onAuthStateChanged((u) => {
        currentUser = u;
        if (u) {
            setStatus('online');
            ensureParticipantDoc();
        } else {
            setStatus('auth…');
        }
    });
    auth.signInAnonymously().catch(console.error);

    // Elements
    const participantsEl = $('participants');
    const cardsEl = $('cards');
    const displayNameInput = $('displayName');
    const saveNameBtn = $('saveNameBtn');
    const revealBtn = $('revealBtn');
    const resetBtn = $('resetBtn');
    const copyLinkBtn = $('copyLinkBtn');
    const createRoomBtn = $('createRoomBtn');
    const manualEvalBtn = $('manualEvalBtn');
    const minValEl = $('minVal');
    const avgValEl = $('avgVal');
    const maxValEl = $('maxVal');

    // Build cards UI
    function renderCards(selected) {
        cardsEl.innerHTML = '';
        cards.forEach(v => {
            const c = document.createElement('button');
            c.className = 'card';
            c.innerHTML = `<small>vote</small>${v}`;
            if (selected === v) c.classList.add('selected');
            c.onclick = () => castVote(v);
            cardsEl.appendChild(c);
        });
    }

    // Presence and room listeners
    let roomUnsub = null;
    let participantsUnsub = null;
    let heartbeatTimer = null;

    function getRoomRef() {
        if (!roomId) return null;
        return db.collection('rooms').doc(roomId);
    }

    function getSelfRef() {
        if (!currentUser || !roomId) return null;
        return getRoomRef().collection('participants').doc(currentUser.uid);
    }

    function ensureRoomExists() {
        if (!roomId) return;
        const r = getRoomRef();
        r.get().then(snap => {
            if (!snap.exists) {
                r.set({createdAt: firebase.firestore.FieldValue.serverTimestamp(), reveal: false});
            }
        });
    }

    function ensureParticipantDoc() {
        if (!currentUser || !roomId) return;
        const p = getSelfRef();
        const displayName = localStorage.getItem('pp_displayName') || '';
        displayNameInput.value = displayName;
        p.set({
            uid: currentUser.uid,
            name: displayName || 'Anonymous',
            vote: null,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }, {merge: true});
    }

    function heartbeat() {
        const p = getSelfRef();
        if (!p) return;
        p.update({lastSeen: firebase.firestore.FieldValue.serverTimestamp()}).catch(() => {
        });
    }

    function startPresence() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(heartbeat, 20 * 1000);
        heartbeat(); // immediate
    }

    function joinRoom(id) {
        roomId = id;
        roomIdLabel.textContent = roomId || '—';
        if (roomUnsub) roomUnsub();
        if (participantsUnsub) participantsUnsub();
        if (!roomId) {
            renderCards(null);
            participantsEl.innerHTML = '';
            return;
        }
        history.replaceState(null, '', `?room=${encodeURIComponent(roomId)}`);
        ensureRoomExists();
        ensureParticipantDoc();
        startPresence();
        listenRoom();
        listenParticipants();
    }

    function listenRoom() {
        roomUnsub = getRoomRef().onSnapshot(doc => {
            const data = doc.data() || {reveal: false};
            const reveal = !!data.reveal;
            _roomReveal = reveal;                // <-- add this line
            revealBtn.textContent = reveal ? 'Hide' : 'Reveal';
            updateStats();                       // recompute with the new reveal state
            renderParticipants(_lastParticipants, reveal);
            renderCards(_myVote);
        });
    }

    let _lastParticipants = [];
    let _myVote = null;

    function listenParticipants() {
        const since = firebase.firestore.Timestamp.fromMillis(Date.now() - 60 * 1000);
        participantsUnsub = getRoomRef()
            .collection('participants')
            .orderBy('name')
            .onSnapshot(snap => {
                const list = [];
                snap.forEach(doc => list.push({id: doc.id, ...doc.data()}));
                // Consider away if lastSeen older than 1 min
                const now = Date.now();
                list.forEach(p => {
                    const ls = p.lastSeen?.toMillis?.() ?? 0;
                    p.away = (now - ls) > 60 * 1000;
                });
                _lastParticipants = list;
                const me = list.find(p => p.id === (currentUser?.uid));
                _myVote = me ? me.vote : null;
                renderParticipants(list, null); // room listener will pass reveal state
                updateStats();
                renderCards(_myVote);
            });
    }

    function everyoneVoted(list) {
        if (list.length === 0) return false;
        return list.every(p => p.vote !== null && p.vote !== undefined);
    }

    function renderParticipants(list, revealOverride) {
        const revealState = (typeof revealOverride === 'boolean') ? revealOverride : _cachedReveal();
        participantsEl.innerHTML = '';
        list.forEach(p => {
            const row = document.createElement('div');
            row.className = 'person';
            const dot = `<span class="dot ${p.away ? 'away' : ''}"></span>`;
            const vote = p.vote === null || p.vote === undefined ? '—' : p.vote;
            const blurred = !revealState && !everyoneVoted(list);
            row.innerHTML = `<div class="row">${dot}<strong>${p.name || 'Anonymous'}</strong></div>
                       <div class="vote ${blurred ? 'hidden-vote' : ''}">${vote}</div>`;
            participantsEl.appendChild(row);
        });
    }

    function _cachedReveal() {
        return window._revealCache === true;
    }

    function setReveal(val) {
        window._revealCache = !!val;
        return getRoomRef().set({reveal: !!val}, {merge: true});
    }

    async function castVote(v) {
        const p = getSelfRef();
        if (!p) return;
        await p.set({vote: v}, {merge: true});
        renderCards(v);
        updateStats();
    }

    async function resetVotes() {
        const parts = await getRoomRef().collection('participants').get();
        const batch = db.batch();
        parts.forEach(doc => batch.update(doc.ref, {vote: null}));
        await batch.commit();
        await setReveal(false);
    }

    function getNumericVotes() {
        const nums = [];
        for (const p of _lastParticipants) {
            const val = p.vote;
            if (val === null || val === undefined) continue;
            if (val === '☕' || val === '∞') continue;
            const n = Number(val);
            if (!isNaN(n)) nums.push(n);
        }
        return nums;
    }

    function updateStats() {
        // Show results only if Reveal is on OR everyone has voted
        const showResults = _roomReveal || everyoneVoted(_lastParticipants);

        // Get the Results section elements
        const resultsSection = document.getElementById('minVal').closest('section');
        const statsBox = resultsSection.querySelector('.stats');

        // Lazy-create a small note we can toggle when results are hidden
        let hiddenNote = resultsSection.querySelector('[data-results-note]');
        if (!hiddenNote) {
            hiddenNote = document.createElement('div');
            hiddenNote.setAttribute('data-results-note', '');
            hiddenNote.className = 'footer';
            hiddenNote.textContent = 'Results are hidden until everyone votes or Reveal is clicked.';
            resultsSection.appendChild(hiddenNote);
        }

        // Helper to set the numbers quickly
        const setText = (el, v) => el.textContent = v;

        if (!showResults) {
            // Hide stats, show note, and blank out numbers
            statsBox.style.display = 'none';
            hiddenNote.style.display = 'block';
            setText(minValEl, '—');
            setText(avgValEl, '—');
            setText(maxValEl, '—');
            return;
        }

        // Show stats and hide the note
        statsBox.style.display = '';
        hiddenNote.style.display = 'none';

        // Compute stats (ignoring ☕ and ∞)
        const nums = (() => {
            const arr = [];
            for (const p of _lastParticipants) {
                const v = p.vote;
                if (v == null || v === '☕' || v === '∞') continue;
                const n = Number(v);
                if (!isNaN(n)) arr.push(n);
            }
            return arr;
        })();

        if (nums.length) {
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
            setText(minValEl, String(min));
            setText(avgValEl, String(avg));
            setText(maxValEl, String(max));
        } else {
            setText(minValEl, '—');
            setText(avgValEl, '—');
            setText(maxValEl, '—');
        }
    }

    // UI events
    saveNameBtn.onclick = async () => {
        const name = displayNameInput.value.trim() || 'Anonymous';
        localStorage.setItem('pp_displayName', name);
        const p = getSelfRef();
        if (p) await p.set({name}, {merge: true});
    };

    revealBtn.onclick = async () => {
        const doc = await getRoomRef().get();
        const cur = !!(doc.data()?.reveal);
        await setReveal(!cur);
    };

    resetBtn.onclick = async () => {
        if (confirm('Clear all votes in this room?')) {
            await resetVotes();
        }
    };

    copyLinkBtn.onclick = async () => {
        const link = location.origin + location.pathname + `?room=${encodeURIComponent(roomId)}`;
        await navigator.clipboard.writeText(link);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => copyLinkBtn.textContent = 'Copy Link', 1200);
    };

    createRoomBtn.onclick = () => {
        const id = randomRoomId();
        joinRoom(id);
    };

    manualEvalBtn.onclick = async () => {
        const missing = _lastParticipants.filter(p => p.vote === null || p.vote === undefined);
        if (missing.length === 0) {
            alert('Everyone already voted. Nothing to evaluate manually.');
            return;
        }
        openManualDialog(missing);
    };

    function openManualDialog(missing) {
        const dlg = document.createElement('dialog');
        const wrap = document.createElement('div');
        wrap.className = 'modal';
        wrap.innerHTML = `<h3>Manual Evaluation</h3>
      <p>Enter votes for people who couldn't vote. Use the exact card values: ${cards.join(', ')}.</p>
      <table class="table">
        <thead><tr><th>Name</th><th>Vote</th></tr></thead>
        <tbody>${missing.map(m => `<tr><td>${m.name || 'Anonymous'}</td><td><input data-uid="${m.id}" type="text" placeholder="e.g. 3 or ☕"/></td></tr>`).join('')}</tbody>
      </table>
      <div class="row" style="margin-top:10px; justify-content:flex-end">
        <button id="cancelManual">Cancel</button>
        <button class="accent" id="applyManual">Apply</button>
      </div>`;
        dlg.appendChild(wrap);
        document.body.appendChild(dlg);
        dlg.showModal();
        wrap.querySelector('#cancelManual').onclick = () => dlg.close();
        wrap.querySelector('#applyManual').onclick = async () => {
            const inputs = wrap.querySelectorAll('input[data-uid]');
            const batch = db.batch();
            inputs.forEach(inp => {
                const uid = inp.getAttribute('data-uid');
                const v = inp.value.trim();
                if (!v) return;
                // Accept only predefined cards (including numeric strings that match cards)
                if (!cards.includes(v)) {
                    alert(`Invalid vote "${v}". Must be one of: ${cards.join(', ')}`);
                    return;
                }
                const ref = getRoomRef().collection('participants').doc(uid);
                batch.update(ref, {vote: v});
            });
            await batch.commit();
            dlg.close();
            updateStats();
        };
    }

    // Initial mount
    function init() {
        roomIdLabel.textContent = roomId || '—';
        renderCards(null);
        if (roomId) {
            joinRoom(roomId);
        }
    }

    init();
})();