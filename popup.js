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

function formatNps(n) {
    if (!n || n <= 0) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return String(n);
}

function updateCurrentStateUI(level, thinkMs, multiPV) {
    const seconds = (Number(thinkMs) / 1000).toFixed(1);
    const elo = estimateEloForLevel(level);
    $("#current-level").text(level);
    $("#current-level-elo").text(`~${elo} Elo`);
    $("#current-mode").text(seconds + "s");
    if (multiPV) { $("#current-multipv").text(String(multiPV)); }
    // Try reflect live engine stats if available
    try {
        chrome.storage.local.get({ lastEngineStats: null }, (items) => {
            const s = items && items.lastEngineStats ? items.lastEngineStats : null;
            if (!s) return;
            if (typeof s.depth === 'number') { $("#current-depth").text(String(s.depth)); }
            if (typeof s.nps === 'number') { $("#current-nps").text(formatNps(s.nps)); }
            if (typeof s.tbhits === 'number' && s.tbhits > 0) { $("#current-tb").text(' · TB'); }
            else { $("#current-tb").text(''); }
        });
    } catch (_) {}
}

function restoreSelections() {
    chrome.storage.sync.get({ engineLevel: "8", engineThinkMs: 200, engineMultiPV: 1, autoMove: false, autoMoveDelayBaseMs: 150, autoMoveDelayJitterMs: 600, eloEnabled: false, eloValue: 1600, hashMb: 64, ponderEnabled: false, autoMoveConfidencePct: 0, minimalOverlay: false, threads: 0, moveOverheadMs: 80, slowMoverPercent: 100 }, function (items) {
        const { engineLevel, engineThinkMs, engineMultiPV, autoMove, autoMoveDelayBaseMs, autoMoveDelayJitterMs, eloEnabled, eloValue, hashMb, ponderEnabled, autoMoveConfidencePct, minimalOverlay, threads, moveOverheadMs, slowMoverPercent } = items;
        const clampedLevel = String(Math.max(0, Math.min(20, parseInt(engineLevel, 10) || 8)));
        const clampedMs = String(Math.max(200, Math.min(5000, parseInt(engineThinkMs, 10) || 200)));
        const clampedMultiPV = String(Math.max(1, Math.min(5, parseInt(engineMultiPV, 10) || 1)));
        const clampedDelayBase = String(Math.max(0, Math.min(5000, parseInt(autoMoveDelayBaseMs, 10) || 150)));
        const clampedDelayJitter = String(Math.max(0, Math.min(20000, parseInt(autoMoveDelayJitterMs, 10) || 600)));
        const clampedElo = String(Math.max(800, Math.min(2800, parseInt(eloValue, 10) || 1600)));
        const clampedHash = String(Math.max(16, Math.min(256, parseInt(hashMb, 10) || 64)));
        const clampedConf = String(Math.max(0, Math.min(20, parseInt(autoMoveConfidencePct, 10) || 0)));
        const hwThreads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 1;
        const clampedThreads = String(Math.max(1, Math.min(32, parseInt(threads, 10) || hwThreads)));
        const clampedOverhead = String(Math.max(0, Math.min(500, parseInt(moveOverheadMs, 10) || 80)));
        const clampedSlowMover = String(Math.max(10, Math.min(1000, parseInt(slowMoverPercent, 10) || 100)));
        $("#level-slider").val(clampedLevel);
        $("#level-slider-value").text(clampedLevel);
        $("#level-elo").text(`~${estimateEloForLevel(clampedLevel)} Elo`);
        $("#time-slider").val(clampedMs);
        $("#time-slider-value").text((Number(clampedMs) / 1000).toFixed(1));
        $("#multipv-slider").val(clampedMultiPV);
        $("#multipv-slider-value").text(clampedMultiPV);
        $("#minimal-overlay-checkbox").prop('checked', Boolean(minimalOverlay));
        $("#auto-move-checkbox").prop('checked', Boolean(autoMove));
        $("#auto-delay-base-slider").val(clampedDelayBase);
        $("#auto-delay-base-value").text(clampedDelayBase);
        $("#auto-delay-jitter-slider").val(clampedDelayJitter);
        $("#auto-delay-jitter-value").text(clampedDelayJitter);
        $("#elo-enabled").prop('checked', Boolean(eloEnabled));
        $("#elo-value").val(clampedElo);
        $("#hash-slider").val(clampedHash);
        $("#hash-slider-value").text(clampedHash);
        $("#ponder-enabled").prop('checked', Boolean(ponderEnabled));
        $("#auto-confidence-slider").val(clampedConf);
        $("#auto-confidence-value").text(clampedConf);
        $("#threads-slider").val(clampedThreads);
        $("#threads-slider-value").text(clampedThreads);
        $("#overhead-slider").val(clampedOverhead);
        $("#overhead-slider-value").text(clampedOverhead);
        $("#slowmover-slider").val(clampedSlowMover);
        $("#slowmover-slider-value").text(clampedSlowMover);
        updateCurrentStateUI(clampedLevel, clampedMs, clampedMultiPV);
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

    $("#multipv-slider").on("input change", function () {
        const v = $(this).val();
        $("#multipv-slider-value").text(String(v));
    });

    $("#threads-slider").on("input change", function () {
        const v = $(this).val();
        $("#threads-slider-value").text(String(v));
    });
    $("#overhead-slider").on("input change", function () {
        const v = $(this).val();
        $("#overhead-slider-value").text(String(v));
    });
    $("#slowmover-slider").on("input change", function () {
        const v = $(this).val();
        $("#slowmover-slider-value").text(String(v));
    });

    // Debounce helpers to reduce storage write rate and avoid message errors
    function debounce(fn, wait) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }
    const debouncedSet = debounce((obj) => chrome.storage.sync.set(obj), 300);
    const safeSend = (msg) => { try { chrome.runtime.sendMessage(msg); } catch (e) {} };

    $("#auto-delay-base-slider").on("input change", function () {
        const ms = $(this).val();
        $("#auto-delay-base-value").text(String(ms));
        debouncedSet({ autoMoveDelayBaseMs: ms });
        const autoMove = $("#auto-move-checkbox").is(':checked');
        safeSend({ type: "set-auto-move", enabled: autoMove });
    });
    $("#auto-delay-jitter-slider").on("input change", function () {
        const ms = $(this).val();
        $("#auto-delay-jitter-value").text(String(ms));
        debouncedSet({ autoMoveDelayJitterMs: ms });
        const autoMove = $("#auto-move-checkbox").is(':checked');
        safeSend({ type: "set-auto-move", enabled: autoMove });
    });

    $("#auto-confidence-slider").on("input change", function () {
        const v = $(this).val();
        $("#auto-confidence-value").text(String(v));
        debouncedSet({ autoMoveConfidencePct: v });
        safeSend({ type: "set-autoplay-confidence", value: v });
    });

    $("#set-level").click(function () {
        const levelValue = $("#level-slider").val();
        debouncedSet({ engineLevel: levelValue });
        updateCurrentStateUI(levelValue, $("#time-slider").val(), $("#multipv-slider").val());
        safeSend({ type: "set-level", radioValue: levelValue });
    });

    $("#set-time").click(function () {
        const thinkMs = $("#time-slider").val();
        debouncedSet({ engineThinkMs: thinkMs });
        updateCurrentStateUI($("#level-slider").val(), thinkMs, $("#multipv-slider").val());
        safeSend({ type: "set-think-time", radioValue: thinkMs });
    });

    $("#set-multipv").click(function () {
        const mpv = $("#multipv-slider").val();
        debouncedSet({ engineMultiPV: mpv });
        updateCurrentStateUI($("#level-slider").val(), $("#time-slider").val(), mpv);
        safeSend({ type: "set-multipv", value: mpv });
    });

    $("#set-threads").click(function () {
        const v = $("#threads-slider").val();
        debouncedSet({ threads: v });
        safeSend({ type: "set-threads", value: v });
    });

    $("#apply-time-mgmt").click(function () {
        const ov = $("#overhead-slider").val();
        const sm = $("#slowmover-slider").val();
        debouncedSet({ moveOverheadMs: ov, slowMoverPercent: sm });
        safeSend({ type: "set-time-mgmt", overhead: ov, slowmover: sm });
    });

    // Apply immediately when toggling checkbox
    $("#auto-move-checkbox").on('change', function () {
        const autoMove = $(this).is(':checked');
        debouncedSet({ autoMove: autoMove });
        safeSend({ type: "set-auto-move", enabled: autoMove });
    });

    // Minimal overlay toggle
    $("#minimal-overlay-checkbox").on('change', function () {
        const enabled = $(this).is(':checked');
        debouncedSet({ minimalOverlay: enabled });
        safeSend({ type: "set-minimal-overlay", enabled });
    });

    // Elo limit controls
    $("#elo-enabled").on('change', function () {
        const enabled = $(this).is(':checked');
        debouncedSet({ eloEnabled: enabled });
        safeSend({ type: "set-elo-enabled", enabled });
    });
    $("#set-elo").click(function () {
        const elo = $("#elo-value").val();
        debouncedSet({ eloValue: elo });
        safeSend({ type: "set-elo", value: elo });
    });

    // Hash control
    $("#hash-slider").on("input change", function () {
        const v = $(this).val();
        $("#hash-slider-value").text(String(v));
    });
    $("#set-hash").click(function () {
        const v = $("#hash-slider").val();
        debouncedSet({ hashMb: v });
        safeSend({ type: "set-hash", value: v });
    });

    // Ponder toggle
    $("#ponder-enabled").on('change', function () {
        const enabled = $(this).is(':checked');
        debouncedSet({ ponderEnabled: enabled });
        safeSend({ type: "set-ponder", enabled });
    });

    // Calibration
    $("#run-calibrate").click(function () {
        $("#calibration-output").text('Running speedtest...');
        safeSend({ type: "run-calibrate" });
        // Poll calibration output without blocking main engine
        const start = Date.now();
        const tick = () => {
            chrome.storage.local.get({ calibrationOutput: '' }, (items) => {
                if (items && items.calibrationOutput) {
                    $("#calibration-output").text(items.calibrationOutput);
                    return;
                }
                if (Date.now() - start < 16000) setTimeout(tick, 400);
            });
        };
        setTimeout(tick, 500);
    });
    // Refresh stats periodically while popup is open
    const statsInterval = setInterval(() => {
        updateCurrentStateUI($("#level-slider").val(), $("#time-slider").val(), $("#multipv-slider").val());
    }, 1500);
    window.addEventListener('beforeunload', () => clearInterval(statsInterval));
});