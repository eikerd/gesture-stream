import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

const CANDIDATE_HOSTS = ["192.168.42.230", "pi-zero-ai.local", "raspberrypi.local"];

export async function GET() {
  for (const host of CANDIDATE_HOSTS) {
    try {
      // Node.js fetch/http gets EHOSTUNREACH for the Pi's USB-gadget interface;
      // curl uses the system network stack and can reach it.
      const { stdout } = await execFileAsync(
        "curl",
        ["--silent", "--max-time", "2", "--output", "-", `http://${host}:8766/snapshot`],
        { encoding: "buffer", maxBuffer: 1024 * 512 }
      );
      if (stdout.length > 0) {
        return new NextResponse(stdout, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-store",
            "X-Snapshot-Host": host,
          },
        });
      }
    } catch {
      // Host unreachable or timed out — try next
    }
  }
  return new NextResponse(null, { status: 503 });
}
