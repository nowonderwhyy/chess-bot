// background.js

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request && typeof request.type === 'string' && (
        request.type === 'set-level' ||
        request.type === 'set-think-time' ||
        request.type === 'set-auto-move' ||
        request.type === 'set-multipv' ||
        request.type === 'set-elo' ||
        request.type === 'set-elo-enabled' ||
        request.type === 'set-hash' ||
        request.type === 'set-ponder' ||
        request.type === 'set-autoplay-confidence' ||
        request.type === 'set-minimal-overlay' ||
        request.type === 'set-threads' ||
        request.type === 'set-time-mgmt' ||
        request.type === 'set-time-mode' ||
        request.type === 'run-calibrate'
    )) {
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs && tabs.length > 0 && tabs[0] && tabs[0].id) {
                    try { chrome.tabs.sendMessage(tabs[0].id, request); } catch (e) { console.warn('Error sending message to tab:', e); }
                }
            });
        } catch (e) { console.warn('Error querying tabs:', e); }
    }
});
