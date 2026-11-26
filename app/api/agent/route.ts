import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(req: NextRequest) {
  const os = req.nextUrl.searchParams.get("os");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || req.nextUrl.host;
  const origin = `${proto}://${host}`;

  if (os === "mac") {
    const script = `#!/bin/bash
echo "========================================="
echo "  AnyCraft Mac OS Control Agent"
echo "========================================="
echo "Note: Grant Accessibility permission to Terminal if prompted:"
echo "System Settings -> Privacy & Security -> Accessibility"
echo ""
curl -sL "${origin}/api/agent" -o /tmp/anycraft_agent.py
python3 /tmp/anycraft_agent.py
`;
    return new NextResponse(script, {
      headers: {
        "Content-Type": "application/x-sh; charset=utf-8",
        "Content-Disposition": 'attachment; filename="AnyCraft-Mac.command"',
      },
    });
  }

  if (os === "win") {
    const bat = `@echo off
title AnyCraft Windows OS Control Agent
echo =========================================
echo   AnyCraft Windows OS Control Agent
echo =========================================
curl -sL "${origin}/api/agent" -o "%TEMP%\\anycraft_agent.py"
python "%TEMP%\\anycraft_agent.py"
pause
`;
    return new NextResponse(bat, {
      headers: {
        "Content-Type": "application/x-bat; charset=utf-8",
        "Content-Disposition": 'attachment; filename="AnyCraft-Win.bat"',
      },
    });
  }

  const pyPath = join(process.cwd(), "agent", "anycraft_agent.py");
  const content = readFileSync(pyPath, "utf-8");
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/x-python; charset=utf-8",
      "Content-Disposition": 'attachment; filename="anycraft_agent.py"',
    },
  });
}
