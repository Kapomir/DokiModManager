// Kapomir fork modifications, 2026-11-19.
// Compare only this fork's release channel. An upstream release is not a fork update.
export function isNewerForkVersion(candidate, installed) {
    const parse = value => /^(\d+)\.(\d+)\.(\d+)-kapomir\.(\d+)$/.exec(value)?.slice(1).map(Number);
    const next = parse(candidate);
    const current = parse(installed);
    if (!next || !current) return false;
    for (let i = 0; i < current.length; i++) {
        if (next[i] !== current[i]) return next[i] > current[i];
    }
    return false;
}
