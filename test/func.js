const {performance} = require('perf_hooks');

const tests = [];

function test(name, func) {
  tests.push({name, func});
}

async function run() {
  function fixed(value, digits = 0) {
    return +value.toFixed(digits);
  }

  let passedCount = 0;
  let failedCount = 0;
  for (let i = 0; i < tests.length; i++) {
    let tsStartTest;
    let tsDelta;
    try {
      const {name, func} = tests[i];
      process.stdout.write(`Test ${name}... `);
      tsStartTest = performance.now();
      await func();
      tsDelta = performance.now() - tsStartTest;
      tests[i].tsDelta = tsDelta;
      passedCount++;
      process.stdout.write(`\x1b[32mok\u2714\x1b[0m (${fixed(tsDelta)} ms)\n`);
    } catch (err) {
      tsDelta = performance.now() - tsStartTest;
      tests[i].tsDelta = tsDelta;
      failedCount++;
      process.stdout.write(`\x1b[31mfailed\u2718\x1b[0m (${fixed(tsDelta)} ms)\n`);
    }
  }

  const sumTSDelta = tests.reduce((sum, test) => sum + test.tsDelta, 0);
  console.log(`\nTests result: ${passedCount} passed; ${failedCount} failed (${fixed(sumTSDelta)} ms)`);
}

module.exports = {
  test,
  run
};
