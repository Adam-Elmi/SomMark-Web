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
  'tailwindcss@^4.3.0',
  '@tailwindcss/postcss@^4.3.0',
  'postcss@^8.5.15',
  'autoprefixer@^10.5.0'
];

const POSTCSS_CONFIG_CONTENT = `export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
`;

const TAILWIND_CONFIG_CONTENT = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,smark}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
`;

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
 * Gets the installation command based on the detected package manager.
 */
function getInstallCommand(pkgManager, deps) {
  switch (pkgManager) {
    case 'bun':
      return `bun add -d ${deps.join(' ')}`;
    case 'pnpm':
      return `pnpm add -D ${deps.join(' ')}`;
    case 'yarn':
      return `yarn add -D ${deps.join(' ')}`;
    case 'npm':
    default:
      return `npm install -D ${deps.join(' ')}`;
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
  console.log(pc.cyan('\n  ◢ Tailwind CSS Setup for SomMark Web ◣\n'));

  // --- Step 3.1: Package Manager Detection ---
  const pkgManager = detectPackageManager();
  console.log(`${pc.blue('ℹ')} Detected package manager: ${pc.green(pkgManager)}`);

  // --- Step 3.2: Dependency Installation ---
  const installCmd = getInstallCommand(pkgManager, TARGET_DEPS);
  const installSpinner = ora(`Installing Tailwind CSS dependencies using ${pkgManager}...`).start();

  try {
    await runCommand(installCmd);
    installSpinner.succeed(pc.green('Tailwind CSS dependencies installed successfully!'));
  } catch (error) {
    installSpinner.fail(pc.red('Failed to install dependencies.'));
    console.error(pc.red(error.message));
    process.exit(1);
  }

  // --- Step 3.3: Recreating Configuration Files ---
  const configSpinner = ora('Creating configuration files...').start();
  try {
    await fs.writeFile(path.resolve(process.cwd(), 'postcss.config.js'), POSTCSS_CONFIG_CONTENT, 'utf-8');
    await fs.writeFile(path.resolve(process.cwd(), 'tailwind.config.js'), TAILWIND_CONFIG_CONTENT, 'utf-8');
    configSpinner.succeed(pc.green('Created postcss.config.js and tailwind.config.js'));
  } catch (error) {
    configSpinner.fail(pc.red('Failed to create configuration files.'));
    console.error(pc.red(error.message));
    process.exit(1);
  }

  // --- Step 3.4: Locating Target CSS File ---
  const defaultCss = await findDefaultCssFile();
  const userInput = await askQuestion(
    `${pc.cyan('?')} Enter the CSS file to include Tailwind imports [default: ${defaultCss}]: `
  );

  const selectedCssPath = userInput || defaultCss;
  const absoluteCssPath = path.resolve(process.cwd(), selectedCssPath);

  const cssSpinner = ora(`Configuring stylesheet: ${selectedCssPath}...`).start();

  try {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(absoluteCssPath), { recursive: true });

    let cssContent = '';
    if (existsSync(absoluteCssPath)) {
      cssContent = await fs.readFile(absoluteCssPath, 'utf-8');
    }

    // Determine correct relative source path for .smark pages compilation tracking
    const cssDir = path.dirname(absoluteCssPath);
    const pagesDir = path.resolve(process.cwd(), 'src/pages');
    let relativePagesPath = '../pages';

    if (existsSync(pagesDir)) {
      relativePagesPath = path.relative(cssDir, pagesDir).replace(/\\/g, '/');
    }

    const tailwindDirectives = `@import "tailwindcss";\n\n@source "${relativePagesPath}/**/*.smark";\n`;

    // Only prepend directives if they don't already exist
    if (!cssContent.includes('@import "tailwindcss"') && !cssContent.includes('@import ' + "'tailwindcss'")) {
      const updatedContent = `${tailwindDirectives}\n${cssContent}`;
      await fs.writeFile(absoluteCssPath, updatedContent, 'utf-8');
      cssSpinner.succeed(pc.green(`Tailwind CSS imports successfully injected into ${selectedCssPath}`));
    } else {
      cssSpinner.info(pc.yellow(`Tailwind CSS imports already present in ${selectedCssPath}`));
    }
  } catch (error) {
    cssSpinner.fail(pc.red(`Failed to configure stylesheet at ${selectedCssPath}`));
    console.error(pc.red(error.message));
    process.exit(1);
  }

  // --- Step 3.5: Final Setup Summary ---
  console.log(pc.green('\n✔ Tailwind CSS setup complete!'));
  console.log(pc.dim('----------------------------------------'));
  console.log(`To start your development server, run:`);
  console.log(pc.cyan(`  ${pkgManager === 'npm' ? 'npm run dev' : pkgManager + ' run dev'}`));
  console.log(pc.dim('----------------------------------------\n'));
}

main().catch(err => {
  console.error(pc.red('An unexpected error occurred during setup:'));
  console.error(err);
  process.exit(1);
});
