const commands = [
  ['bun', 'run', 'dev:v2:server'],
  ['bun', 'run', 'dev:v2:web'],
];

const processes = commands.map(command =>
  Bun.spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
);

const stop = () => {
  for (const child of processes) {
    child.kill();
  }
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const exitCode = await Promise.race(processes.map(child => child.exited));
stop();
process.exit(exitCode);
