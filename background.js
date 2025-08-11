// background.js

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request && typeof request.type === 'string' && (
        request.type === 'set-level' ||
        request.type === 'set-mode' ||
        request.type === 'set-think-time' ||
        request.type === 'set-auto-move'
    )) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, request);
            }
        });
    }
});
