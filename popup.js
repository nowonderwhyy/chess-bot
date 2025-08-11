// Persist and reflect settings in the popup UI

function updateCurrentStateUI(level, modeValue) {
    const modeLabel = modeValue === "2" ? "Slow" : "Fast";
    $("#current-level").text(level);
    $("#current-mode").text(modeLabel);
}

function restoreSelections() {
    chrome.storage.sync.get({ engineLevel: "8", engineMode: "1" }, function (items) {
        const { engineLevel, engineMode } = items;
        $(`input[name='level'][value='${engineLevel}']`).prop("checked", true);
        $(`input[name='depth'][value='${engineMode}']`).prop("checked", true);
        updateCurrentStateUI(engineLevel, engineMode);
    });
}

$(document).ready(function () {
    restoreSelections();

    $("#set-level").click(function () {
        const radioValue = $("input[name='level']:checked").val();
        chrome.storage.sync.set({ engineLevel: radioValue });
        updateCurrentStateUI(radioValue, $("input[name='depth']:checked").val());
        // Fire-and-forget; no response expected to avoid runtime.lastError
        chrome.runtime.sendMessage({ type: "set-level", radioValue: radioValue });
    });

    $("#set-depth").click(function () {
        const radioValue = $("input[name='depth']:checked").val();
        chrome.storage.sync.set({ engineMode: radioValue });
        updateCurrentStateUI($("input[name='level']:checked").val(), radioValue);
        // Fire-and-forget; no response expected to avoid runtime.lastError
        chrome.runtime.sendMessage({ type: "set-mode", radioValue: radioValue });
    });
});