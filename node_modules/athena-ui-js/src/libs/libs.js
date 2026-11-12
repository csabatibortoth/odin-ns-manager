//libs for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// Classic (non-module) scripts that have to be loaded at runtime because they
// register globals. Everything else is a regular ES module import.
const lib = (id, name, path) => ({ id, name, src: new URL(path, import.meta.url).href });

export default [
    lib(0, "HTMLControlGenerator", "hephaestus/HTMLControlGenerator/src/HTMLControlGenerator.min.js"),
    lib(10, "crypto-js", "crypto-js/crypto-js.js")
];
