// Vitest setup: mark process.stdin as a TTY so readStdin() returns null
// during tests that don't pass an explicit stdin mock. Tests that exercise
// stdin behavior should pass `dependencies.stdin` directly.
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
