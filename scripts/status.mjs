import { status } from '../dist/index.js';

try {
  console.log(JSON.stringify(await status(process.argv[2]), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
