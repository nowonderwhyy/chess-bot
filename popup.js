$("#set-level").click(function () {
    var radioValue = $("input[name='level']:checked").val();
    chrome.runtime.sendMessage({type: "set-level", radioValue: radioValue}, function(response) {});
});

$("#set-depth").click(function () {
    var radioValue = $("input[name='depth']:checked").val();
    chrome.runtime.sendMessage({type: "set-mode", radioValue: radioValue}, function(response) {});
});