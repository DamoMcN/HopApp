// Tickets page. Shows the journey picked on the map (Buy a ticket tab).
// Buying is not built yet: this only displays the saved journey.

const DRAFT_KEY = 'hop.ticketDraft';

function text(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

// Anything in storage could have been changed, so check it before showing it
function readDraft() {
    let raw = null;
    try { raw = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object') return null;

    const draft = {
        routeId: text(raw.routeId, 64),
        shortName: text(raw.shortName, 20),
        longName: text(raw.longName, 200),
        agency: typeof raw.agency === 'string' && raw.agency.length <= 120 ? raw.agency : '',
        fromId: text(raw.fromId, 64),
        fromName: text(raw.fromName, 160),
        toId: text(raw.toId, 64),
        toName: text(raw.toName, 160),
        stopsBetween: raw.stopsBetween
    };

    const ok = draft.routeId && draft.shortName && draft.fromId && draft.fromName &&
        draft.toId && draft.toName &&
        Number.isInteger(draft.stopsBetween) && draft.stopsBetween >= 1 && draft.stopsBetween <= 500;
    return ok ? draft : null;
}

function show(draft) {
    document.getElementById('journey').hidden = !draft;
    document.getElementById('tickets-empty').hidden = Boolean(draft);
    if (!draft) return;

    const badge = document.getElementById('j-badge');
    badge.textContent = draft.shortName;
    badge.classList.toggle('is-citylink', draft.agency.toLowerCase().includes('citylink'));

    document.getElementById('j-name').textContent = draft.longName || 'Bus route';
    document.getElementById('j-agency').textContent = draft.agency || 'Unknown operator';
    document.getElementById('j-from').textContent = draft.fromName;
    document.getElementById('j-to').textContent = draft.toName;
    document.getElementById('j-between').textContent =
        draft.stopsBetween + (draft.stopsBetween === 1 ? ' stop' : ' stops') + ' on this journey.';
}

document.getElementById('clear-journey').addEventListener('click', () => {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ }
    show(null);
});

show(readDraft());
