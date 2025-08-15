function loadScript(src) {
    let div = document.getElementById("sampleScript");
    var script = document.createElement("script");
    script.src = src;
    div.replaceChildren(script);
}
