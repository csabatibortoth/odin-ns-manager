'use strict';

/**
 * DS records of the root zone key signing keys, https://data.iana.org/root-anchors/root-anchors.xml
 */
module.exports = [
    {
        // KSK-2017
        keyTag:     20326,
        algorithm:  8,
        digestType: 2,
        digest:     'E06D44B80B8F1D39A95C0B0D7C65D08458E880409BBC683457104237C7F8EC8D'
    },
    {
        // KSK-2024
        keyTag:     38696,
        algorithm:  8,
        digestType: 2,
        digest:     '683D2D0ACB8C9B712A1948B27F741219298D0A450D612C483AF444A4C0FB2B16'
    }
];
