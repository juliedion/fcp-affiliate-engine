import { NextResponse } from "next/server";
import { z } from "zod";
import { formatApiError } from "@/lib/apiError";

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";

const schema = z.object({
  promptText: z.string().min(2),
  // Runway's video models animate a still image — generate one first (see /api/generate-image)
  // and pass its URL/data URI here as the starting frame.
  promptImage: z.string().min(10),
  duration: z.coerce.number().optional().default(5)
});

// Submits a Runway image-to-video generation task. Runway generation is asynchronous:
// this returns a taskId immediately; poll GET /api/generate-video/{taskId} for the result.
export async function POST(req: Request) {
  try {
    const { promptText, promptImage, duration } = schema.parse(await req.json());
    const apiKey = process.env.RUNWAY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "RUNWAY_API_KEY is not configured on the server." }, { status: 400 });
    }

    const r = await fetch(`${RUNWAY_BASE}/image_to_video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": RUNWAY_VERSION
      },
      body: JSON.stringify({
        model: "gen3a_turbo",
        promptImage,
        promptText,
        duration,
        ratio: "768:1280"
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return NextResponse.json({ error: data?.error || "Runway task creation failed." }, { status: r.status });
    }

    return NextResponse.json({ taskId: data.id });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Invalid video request.") }, { status: 400 });
  }
}
