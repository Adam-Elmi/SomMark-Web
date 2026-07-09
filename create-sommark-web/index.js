#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import { cyan, green, red, reset, yellow } from 'kolorist';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function init() {
  console.log(cyan('\n  ◢ Create SomMark Web ◣\n'));

  let targetDir = process.argv[2];
  const defaultProjectName = targetDir || 'sommark-app';

  let result = {};

  try {
    result = await prompts(
      [
        {
          type: targetDir ? null : 'text',
          name: 'projectName',
          message: reset('Project name:'),
          initial: defaultProjectName,
          onState: (state) => {
            targetDir = state.value.trim() || defaultProjectName;
          },
        },
        {
          type: () =>
            !fs.existsSync(targetDir) || fs.readdirSync(targetDir).length === 0
              ? null
              : 'confirm',
          name: 'overwrite',
          message: () =>
            (targetDir === '.'
              ? 'Current directory'
              : `Target directory "${targetDir}"`) +
            ` is not empty. Remove existing files and continue?`,
        },
        {
          type: (_, { overwrite } = {}) => {
            if (overwrite === false) {
              throw new Error(red('✖') + ' Operation cancelled');
            }
            return null;
          },
          name: 'overwriteChecker',
        },
      ],
      {
        onCancel: () => {
          throw new Error(red('✖') + ' Operation cancelled');
        },
      }
    );
  } catch (cancelled) {
    console.log(cancelled.message);
    return;
  }

  const root = path.join(process.cwd(), targetDir);

  if (result.overwrite) {
    fs.emptyDirSync(root);
  } else if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  const templateDir = path.resolve(__dirname, 'template');

  console.log(`\nSetting up project in ${root}...`);

  const write = (file, content) => {
    const targetPath = path.join(root, file);
    if (content) {
      fs.writeFileSync(targetPath, content);
    } else {
      fs.copySync(path.join(templateDir, file), targetPath);
    }
  };

  const files = fs.readdirSync(templateDir);
  for (const file of files) {
    if (file === 'node_modules' || file === 'dist' || file === 'bun.lock' || file === 'package-lock.json') {
      continue;
    }
    if (file === 'package.json') {
      const pkg = fs.readJsonSync(path.join(templateDir, 'package.json'));
      pkg.name = (path.basename(root) || 'sommark-app')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/^[._]/, '')
        .replace(/[^a-z0-9-~]/g, '-');
      write('package.json', JSON.stringify(pkg, null, 2) + '\n');
    } else {
      write(file);
    }
  }

  console.log(green('\nDone. Now run:\n'));
  if (root !== process.cwd()) {
    console.log(`  cd ${path.relative(process.cwd(), root)}`);
  }
  console.log('  bun install');
  console.log('  bun run dev\n');
}

init().catch((e) => {
  console.error(e);
});
