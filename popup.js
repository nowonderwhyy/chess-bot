// Persist and reflect settings in the popup UI

function estimateEloForLevel(levelNumber) {
    const lvl = Math.max(0, Math.min(20, Number(levelNumber) || 0));
    // Piecewise mapping using rough, human-friendly estimates
    // 0–8: keep legacy-ish curve; 9–20: ramp to superhuman
    const table = {
        0: 750,
        1: 850,
        2: 950,
        3: 1050,
        4: 1250,
        5: 1700,
        6: 1900,
        7: 2000,
        8: 2250,
        9: 2350,
        10: 2450,
        11: 2550,
        12: 2650,
        13: 2750,
        14: 2850,
        15: 2950,
        16: 3050,
        17: 3100,
        18: 3150,
        19: 3200,
        20: 3250,
    };
    return table[lvl];
}

function updateCurrentStateUI(level, thinkMs) {
    const seconds = (Number(thinkMs) / 1000).toFixed(1);
    const elo = estimateEloForLevel(level);
    $("#current-level").text(level);
    $("#current-level-elo").text(`~${elo} Elo`);
    $("#current-mode").text(seconds + "s");
}

function restoreSelections() {
    chrome.storage.sync.get({ engineLevel: "8", engineThinkMs: 200 }, function (items) {
        const { engineLevel, engineThinkMs } = items;
        const clampedLevel = String(Math.max(0, Math.min(20, parseInt(engineLevel, 10) || 8)));
        const clampedMs = String(Math.max(200, Math.min(5000, parseInt(engineThinkMs, 10) || 200)));
        $("#level-slider").val(clampedLevel);
        $("#level-slider-value").text(clampedLevel);
        $("#level-elo").text(`~${estimateEloForLevel(clampedLevel)} Elo`);
        $("#time-slider").val(clampedMs);
        $("#time-slider-value").text((Number(clampedMs) / 1000).toFixed(1));
        updateCurrentStateUI(clampedLevel, clampedMs);
    });
}

$(document).ready(function () {
    restoreSelections();

    // Reflect slider movement immediately
    $("#level-slider").on("input change", function () {
        const val = $(this).val();
        $("#level-slider-value").text(val);
        $("#level-elo").text(`~${estimateEloForLevel(val)} Elo`);
    });

    $("#time-slider").on("input change", function () {
        const ms = $(this).val();
        $("#time-slider-value").text((Number(ms) / 1000).toFixed(1));
    });

    $("#set-level").click(function () {
        const levelValue = $("#level-slider").val();
        chrome.storage.sync.set({ engineLevel: levelValue });
        updateCurrentStateUI(levelValue, $("#time-slider").val());
        // Fire-and-forget; no response expected to avoid runtime.lastError
        chrome.runtime.sendMessage({ type: "set-level", radioValue: levelValue });
    });

    $("#set-time").click(function () {
        const thinkMs = $("#time-slider").val();
        chrome.storage.sync.set({ engineThinkMs: thinkMs });
        updateCurrentStateUI($("#level-slider").val(), thinkMs);
        // Fire-and-forget; no response expected to avoid runtime.lastError
        chrome.runtime.sendMessage({ type: "set-think-time", radioValue: thinkMs });
    });
});