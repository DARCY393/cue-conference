import "dotenv/config";
import { upsertStaffUser } from "../lib/staff-auth";

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = String.fromCharCode(127);

/** Reads a line from stdin without echoing it to the terminal. */
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(query);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r" || char === CTRL_D) {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          stdout.write("\n");
          resolve(input);
          return;
        }
        if (char === CTRL_C) {
          process.exit(1);
        }
        if (char === BACKSPACE || char === "\b") {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const email = (process.env.STAFF_EMAIL || "").trim();
  const name = (process.env.STAFF_NAME || "").trim();

  if (!email || !name) {
    console.error(
      'Usage: STAFF_EMAIL=you@example.com STAFF_NAME="Your Name" [STAFF_PASSWORD=...] npm run staff:create'
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.warn(
      "Warning: DATABASE_URL is not set — this account will only exist in this process's " +
        "in-memory store, not in a running server. Set DATABASE_URL to persist it."
    );
  }

  let password = process.env.STAFF_PASSWORD || "";
  if (!password) {
    password = await promptHidden("Password: ");
  }
  if (!password) {
    console.error("A password is required.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const staff = await upsertStaffUser({ email, name, password });
  console.log(`Upserted staff user ${staff.email} (role: ${staff.role}, id: ${staff.id}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
