import { NextResponse } from "next/server";

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";

export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RUNWAY_API_KEY is not configured on the server." }, { status: 400 });
  }

  const r = await fetch(`${RUNWAY_BASE}/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": RUNWAY_VERSION }
  });
  const data = await r.json();
  if (!r.ok) {
    return NextResponse.json({ error: data?.error || "Could not fetch task status." }, { status: r.status });
  }

  // Runway task status: PENDING | RUNNING | SUCCEEDED | FAILED
  return NextResponse.json({
    status: data.status,
    videoUrl: data.status === "SUCCEEDED" ? data.output?.[0] : null,
    error: data.status === "FAILED" ? data.failure || "Generation failed." : null
  });
}
