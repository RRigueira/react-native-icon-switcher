#!/usr/bin/env node

import path from 'node:path';

import { ConfigError } from './core/errors';
import { TransformError } from './transforms/errors';
import { ProjectLayoutError } from './paths';
import { syncProject } from './sync';

export { syncProject } from './sync';

function _printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function run(argv: string[]): Promise<number> {
  const command = argv[0];
  if (command !== 'sync') {
    _printError(
      'Usage: react-native-icon-switcher sync [--check] [--project-root <dir>] [--config <path>]'
    );
    return 2;
  }

  let check = false;
  let projectRoot = process.cwd();
  let configPath: string | undefined;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--project-root') {
      const value = argv[i + 1];
      if (!value) {
        _printError('--project-root requires a directory');
        return 2;
      }
      projectRoot = value;
      i += 1;
      continue;
    }
    if (arg === '--config') {
      const value = argv[i + 1];
      if (!value) {
        _printError('--config requires a path');
        return 2;
      }
      configPath = value;
      i += 1;
      continue;
    }
    _printError(`Unknown argument: ${arg}`);
    return 2;
  }

  try {
    const result = await syncProject({
      projectRoot: path.resolve(projectRoot),
      configPath,
      check,
    });

    if (check) {
      if (result.driftedPaths.length > 0) {
        for (const rel of result.driftedPaths.sort()) {
          _printError(rel);
        }
        return 1;
      }
      return 0;
    }

    process.stdout.write(
      `updated ${result.updated} files, unchanged ${result.unchanged}\n`
    );
    return 0;
  } catch (err) {
    if (
      err instanceof ConfigError ||
      err instanceof TransformError ||
      err instanceof ProjectLayoutError
    ) {
      _printError(err.message);
      return 2;
    }
    throw err;
  }
}

if (require.main === module) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
