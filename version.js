(function (root) {
    'use strict';

    function compareSmartDnsVersions(current, latest) {
        const parse = value => {
            if (typeof value !== 'string' || !/^\\d+\\.\\d+\\.\\d+$/.test(value)) return null;
            return value.split('.').map(part => Number(part));
        };

        const a = parse(current);
        const b = parse(latest);
        if (!a || !b || a.some(n => !Number.isSafeInteger(n)) || b.some(n => !Number.isSafeInteger(n))) {
            return null;
        }

        for (let i = 0; i < 3; i++) {
            if (b[i] > a[i]) return 1;
            if (b[i] < a[i]) return -1;
        }
        return 0;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { compareSmartDnsVersions };
    }
    if (root) root.compareSmartDnsVersions = compareSmartDnsVersions;
})(typeof window !== 'undefined' ? window : globalThis);
