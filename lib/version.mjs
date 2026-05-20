import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../package.json');
export const VERSION = version;
