import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import readline from 'node:readline';
import ora from 'ora';
import pc from 'picocolors';

// ==========================================
// 1. Configuration & Constants
// ==========================================

const TARGET_DEPS = [
  'tailwindcss',
  '@tailwindcss/postcss',
  'postcss',
  'autoprefixer'
];

// ==========================================
// 2. Helper Functions
// ==========================================

/**
 * Detects the package manager used in the project by checking lockfiles.
 * Defaults to 'npm'.
 */
function detectPackageManager() {
  if (existsSync('bun.lock')) return 'bun';
  if (existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (existsSync('yarn.lock')) return 'yarn';
  return 'npm';
}

/**
 * Gets the uninstall command based on the detected package manager.
 */
function getUninstallCommand(pkgManager, deps) {
  switch (pkgManager) {
    case 'bun':
      return `bun remove ${deps.join(' ')}`;
    case 'pnpm':
      return `pnpm remove ${deps.join(' ')}`;
    case 'yarn':
      return `yarn remove ${deps.join(' ')}`;
    case 'npm':
    default:
      return `npm uninstall ${deps.join(' ')}`;
  }
}

/**
 * Executes a shell command and returns a promise.
 */
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Asks the user a question via readline terminal input.
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

/**
 * Searches the styles folder recursively or returns default style file.
 */
async function findDefaultCssFile() {
  const stylesDir = path.resolve(process.cwd(), 'src/styles');
  const defaultPath = 'src/styles/style.css';

  if (!existsSync(stylesDir)) {
    return defaultPath;
  }

  try {
    const files = await fs.readdir(stylesDir);
    const cssFile = files.find(file => file.endsWith('.css'));
    if (cssFile) {
      return path.join('src/styles', cssFile);
    }
  } catch (err) {
    // Ignore and fallback
  }

  return defaultPath;
}

// ==========================================
// 3. Core Workflow
// ==========================================

async function main() {
  console.log(pc.cyan('\n  ◢ Tailwind CSS Cleanup for SomMark Web ◣\n'));

  // --- Step 3.1: Package Manager Detection ---
  const pkgManager = detectPackageManager();
  console.log(`${pc.blue('ℹ')} Detected package manager: ${pc.green(pkgManager)}`);

  // --- Step 3.2: Dependency Uninstallation ---
  const uninstallCmd = getUninstallCommand(pkgManager, TARGET_DEPS);
  const uninstallSpinner = ora(`Uninstalling Tailwind CSS dependencies using ${pkgManager}...`).start();

  try {
    await runCommand(uninstallCmd);
    uninstallSpinner.succeed(pc.green('Tailwind CSS dependencies uninstalled successfully!'));
  } catch (error) {
    // If the dependencies were not installed in the first place, ignore failure
    uninstallSpinner.info(pc.yellow('No Tailwind CSS dependencies to uninstall or already removed.'));
  }

  // --- Step 3.3: Deleting Configuration Files ---
  const configSpinner = ora('Removing configuration files...').start();
  try {
    const postcssPath = path.resolve(process.cwd(), 'postcss.config.js');
    const tailwindPath = path.resolve(process.cwd(), 'tailwind.config.js');

    if (existsSync(postcssPath)) {
      await fs.unlink(postcssPath);
    }
    if (existsSync(tailwindPath)) {
      await fs.unlink(tailwindPath);
    }
    configSpinner.succeed(pc.green('Removed postcss.config.js and tailwind.config.js'));
  } catch (error) {
    configSpinner.fail(pc.red('Failed to remove configuration files.'));
    console.error(pc.red(error.message));
  }

  // --- Step 3.4: Cleaning Target CSS File ---
  const defaultCss = await findDefaultCssFile();
  const userInput = await askQuestion(
    `${pc.cyan('?')} Enter the CSS file to clean up Tailwind imports [default: ${defaultCss}]: `
  );

  const selectedCssPath = userInput || defaultCss;
  const absoluteCssPath = path.resolve(process.cwd(), selectedCssPath);

  if (existsSync(absoluteCssPath)) {
    const cssSpinner = ora(`Cleaning stylesheet: ${selectedCssPath}...`).start();
    try {
      let cssContent = await fs.readFile(absoluteCssPath, 'utf-8');

      // Regular expressions to remove @import "tailwindcss" (with or without quotes) and @source directives
      const updatedContent = cssContent
        .replace(/@import\s+['"]tailwindcss['"];?\s*\n*/g, '')
        .replace(/@source\s+['"][^'"]+['"];?\s*\n*/g, '')
        .trimStart();

      await fs.writeFile(absoluteCssPath, updatedContent, 'utf-8');
      cssSpinner.succeed(pc.green(`Tailwind CSS imports successfully removed from ${selectedCssPath}`));
    } catch (error) {
      cssSpinner.fail(pc.red(`Failed to clean stylesheet at ${selectedCssPath}`));
      console.error(pc.red(error.message));
    }
  } else {
    console.log(`${pc.yellow('⚠')} Stylesheet not found at ${selectedCssPath}, skipping stylesheet cleanup.`);
  }

  // --- Step 3.5: Final Cleanup Summary ---
  console.log(pc.green('\n✔ Tailwind CSS cleanup complete!'));
  console.log(pc.dim('----------------------------------------'));
  console.log(`Your project has been restored to vanilla CSS.`);
  console.log(pc.dim('----------------------------------------\n'));
}

main().catch(err => {
  console.error(pc.red('An unexpected error occurred during cleanup:'));
  console.error(err);
  process.exit(1);
});
