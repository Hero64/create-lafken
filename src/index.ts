#! /usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { input, checkbox, confirm, select } from "@inquirer/prompts";
import { Eta } from "eta";

interface TemplateContext {
  appName: string;
  services: string[];
  uuid: string;
  lafkenVersion: string;
}

const execPromise = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, "../template");

const DEFAULT_LAFKEN_VERSION = "0.8.0";

const fetchLatestVersion = async (packageName: string): Promise<string> => {
  try {
    const { stdout } = await execPromise(`npm view ${packageName} version`);
    return stdout.trim();
  } catch {
    return DEFAULT_LAFKEN_VERSION;
  }
};

const processDirectory = async (
  src: string,
  dest: string,
  context: TemplateContext,
) => {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await processDirectory(srcPath, destPath, context);
    } else {
      if (entry.name.endsWith(".eta")) {
        const content = await fs.readFile(srcPath, "utf-8");
        const realDestPath = destPath.replace(/\.eta$/, "");
        const eta = new Eta();

        const rendered = eta.renderString(content, context);
        await fs.writeFile(realDestPath, rendered);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
};

const checkDirectoryEmpty = async (dir: string): Promise<boolean> => {
  try {
    const files = await fs.readdir(dir);
    return files.length === 0;
  } catch {
    return true;
  }
};

const main = async () => {
  try {
    console.log("🌊 Welcome to Lafken 🌊");

    const appName = await input({
      message: "Project name:",
      default: "my-lafken-app",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Project name cannot be empty";
        }
        if (!/^[a-z0-9-_]+$/i.test(value)) {
          return "Project name can only contain letters, numbers, hyphens and underscores";
        }
        return true;
      },
    });

    const currentDirName = path.basename(process.cwd());
    let useCurrentDir = false;

    if (currentDirName === appName) {
      useCurrentDir = await confirm({
        message: `Current directory is already named "${appName}". Create project here?`,
        default: true,
      });
    }

    const targetDir = useCurrentDir
      ? process.cwd()
      : path.join(process.cwd(), appName);

    let dirExists = false;
    try {
      await fs.access(targetDir);
      dirExists = true;
    } catch {
      dirExists = false;
    }

    if (!dirExists) {
      console.log(`\n📁 Creating directory: ${targetDir}`);
      await fs.mkdir(targetDir, { recursive: true });
    } else {
      const isEmpty = await checkDirectoryEmpty(targetDir);
      if (!isEmpty) {
        const overwrite = await confirm({
          message: "⚠️  Directory is not empty. Continue anyway?",
          default: false,
        });

        if (!overwrite) {
          console.log("\n❌ Project creation cancelled");
          process.exit(0);
        }
      }
    }

    const services = await checkbox({
      message: "Select services to include:",
      choices: [
        { name: "API Gateway", value: "api" },
        { name: "Cognito Authentication", value: "auth" },
        { name: "S3 Bucket", value: "bucket" },
        { name: "DynamoDB", value: "dynamo" },
        { name: "EventBridge Events", value: "event" },
        { name: "SQS Queue", value: "queue" },
        { name: "EventBridge Schedule", value: "schedule" },
        { name: "Step Functions", value: "state-machine" },
      ],
    });

    const shouldInstall = await confirm({
      message: "Install dependencies?",
      default: true,
    });

    let packageManager = "npm";
    if (shouldInstall) {
      packageManager = await select({
        message: "Select package manager:",
        choices: [
          { name: "npm", value: "npm" },
          { name: "yarn", value: "yarn" },
          { name: "pnpm", value: "pnpm" },
        ],
        default: "npm",
      });
    }

    console.log(`\n🚀 Creating project in ${targetDir}...`);

    try {
      await fs.access(TEMPLATE_DIR);
    } catch {
      console.error(`❌ Template directory not found at ${TEMPLATE_DIR}`);
      process.exit(1);
    }

    const lafkenVersion = await fetchLatestVersion("@lafken/common");

    const uuid = crypto.randomUUID();

    await processDirectory(TEMPLATE_DIR, targetDir, {
      appName,
      services,
      uuid,
      lafkenVersion,
    });

    console.log("✅ Project created successfully!");

    if (shouldInstall) {
      console.log(`\n📦 Installing dependencies with ${packageManager}...`);

      const installCommand =
        packageManager === "yarn"
          ? "yarn install"
          : `${packageManager} install`;

      try {
        await execPromise(installCommand, { cwd: targetDir });
        console.log("✅ Dependencies installed successfully!");
      } catch (error) {
        console.error("❌ Failed to install dependencies:", error);
      }
    }

    console.log("\n🎉 All done! Happy coding with Lafken!\n");
    console.log("Next steps:");

    if (!useCurrentDir) {
      console.log(`  cd ${appName}`);
    }

    if (!shouldInstall) {
      console.log(`  ${packageManager} install`);
    }

    console.log(
      `  ${packageManager === "npm" ? "npm run" : packageManager} dev\n`,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      console.log("\n👋 Project creation cancelled");
      process.exit(0);
    }
    console.error("❌ An error occurred:", error);
    process.exit(1);
  }
};

main();
