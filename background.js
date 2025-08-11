// background.js

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request && typeof request.type === 'string' && (
        request.type === 'set-level' ||
        /* legacy removed */
        request.type === 'set-think-time' ||
        request.type === 'set-auto-move' ||
        request.type === 'set-multipv'
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
