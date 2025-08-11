// Persist and reflect settings in the popup UI

function updateCurrentStateUI(level, modeValue) {
    const modeLabel = modeValue === "2" ? "Slow" : "Fast";
    $("#current-level").text(level);
    $("#current-mode").text(modeLabel);
}

function restoreSelections() {
    chrome.storage.sync.get({ engineLevel: "8", engineMode: "1" }, function (items) {
        const { engineLevel, engineMode } = items;
        const clampedLevel = String(Math.max(0, Math.min(20, parseInt(engineLevel, 10) || 8)));
        $("#level-slider").val(clampedLevel);
        $("#level-slider-value").text(clampedLevel);
        $(`input[name='depth'][value='${engineMode}']`).prop("checked", true);
        updateCurrentStateUI(clampedLevel, engineMode);
    });
}

$(document).ready(function () {
    restoreSelections();

    // Reflect slider movement immediately
    $("#level-slider").on("input change", function () {
        const val = $(this).val();
        $("#level-slider-value").text(val);
    });

    $("#set-level").click(function () {
        const levelValue = $("#level-slider").val();
        chrome.storage.sync.set({ engineLevel: levelValue });
        updateCurrentStateUI(levelValue, $("input[name='depth']:checked").val());
        // Fire-and-forget; no response expected to avoid runtime.lastError
        chrome.runtime.sendMessage({ type: "set-level", radioValue: levelValue });
    });

    $("#set-depth").click(function () {
        const radioValue = $("input[name='depth']:checked").val();
        chrome.storage.sync.set({ engineMode: radioValue });
        updateCurrentStateUI($("#level-slider").val(), radioValue);
        // Fire-and-forget; no response expected to avoid runtime.lastError
        chrome.runtime.sendMessage({ type: "set-mode", radioValue: radioValue });
    });
});