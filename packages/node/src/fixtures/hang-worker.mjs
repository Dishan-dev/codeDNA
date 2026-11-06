// Test double: a worker that never answers, for timeout and cancellation tests.
globalThis.setInterval(() => {}, 1000);
