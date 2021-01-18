const {WebSocket} = require('../../');

const agent = process.argv.length > 2 ? process.argv[2] : 'web-sct';
const hostName = process.argv.length > 3 ? process.argv[3] : 'localhost';
const port = process.argv.length > 4 ? process.argv[4] : 5555;

console.log(`agent: ${agent}`);
console.log(`hostName: ${hostName}`);
console.log(`port: ${port}`);

function getCaseCount() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${hostName}:${port}/getCaseCount`);
    let caseCount;
    ws.on('message', (msg) => {
      let caseCount = parseInt(msg.data);
      resolve(caseCount);
    });
    ws.on('close', () => {
      resolve(caseCount);
    });
  });
}

function runCase(caseIndex) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${hostName}:${port}/runCase?case=${caseIndex}&agent=${agent}`);
    ws.on('message', (msg) => ws.send(msg.data));
    ws.on('error', (err) => console.error(err));
    ws.on('close', () => {
      process.nextTick(resolve);
    });
  });
}

function updateReports() {
  return new WebSocket(`ws://${hostName}:${port}/updateReports?agent=${agent}`);
}

async function run() {
  const caseCount = await getCaseCount();
  for (let i = 1; i < caseCount; i++) {
    console.log(`Running test case ${i} of ${caseCount}`);
    await runCase(i);
  }
  if (caseCount > 0) {
    updateReports();
  }
}

(async () => run())();