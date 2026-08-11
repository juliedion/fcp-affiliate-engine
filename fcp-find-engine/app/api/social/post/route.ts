import { NextResponse } from "next/server";
import { z } from "zod";
import { formatApiError } from "@/lib/apiError";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

const schema = z.object({
  platform: z.enum(["facebook", "instagram"]),
  mediaUrl: z.string().min(10),
  mediaType: z.enum(["image", "video"]),
  caption: z.string().default("")
});

const isPublicUrl = (s: string) => /^https?:\/\//i.test(s);

async function postFacebook(mediaUrl: string, mediaType: "image" | "video", caption: string) {
  const pageId = process.env.META_PAGE_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) throw new Error("META_PAGE_ID / META_PAGE_ACCESS_TOKEN are not configured on the server.");

  const endpoint = mediaType === "video" ? `${GRAPH_BASE}/${pageId}/videos` : `${GRAPH_BASE}/${pageId}/photos`;

  if (isPublicUrl(mediaUrl)) {
    const params = new URLSearchParams({ access_token: token, ...(mediaType === "video" ? { file_url: mediaUrl, description: caption } : { url: mediaUrl, caption }) });
    const r = await fetch(`${endpoint}?${params.toString()}`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || "Facebook post failed.");
    return data;
  }

  // AI-generated images come back as data: URIs (no public host) — Facebook's
  // photos/videos endpoints accept a direct multipart binary upload, so upload the raw
  // bytes instead of requiring a hosted URL first.
  const match = mediaUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("Unrecognized media format for Facebook upload.");
  const [, mime, b64] = match;
  const buffer = Buffer.from(b64, "base64");
  const form = new FormData();
  form.append("access_token", token);
  if (mediaType === "video") form.append("description", caption); else form.append("caption", caption);
  form.append("source", new Blob([buffer], { type: mime }), mediaType === "video" ? "video.mp4" : "image.png");
  const r = await fetch(endpoint, { method: "POST", body: form });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "Facebook upload failed.");
  return data;
}

async function postInstagram(mediaUrl: string, mediaType: "image" | "video", caption: string) {
  const igUserId = process.env.META_IG_USER_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!igUserId || !token) throw new Error("META_IG_USER_ID / META_PAGE_ACCESS_TOKEN are not configured on the server.");
  // Unlike Facebook, Instagram's media-creation endpoint only accepts a hosted
  // image_url/video_url — no binary upload option — so a data: URI (an OpenAI image
  // with nowhere public to live) genuinely cannot be posted here.
  if (!isPublicUrl(mediaUrl)) throw new Error("Instagram requires a publicly hosted image/video URL — this AI-generated image has no public host yet, so it can't be posted directly. Post the generated video instead (Runway videos are hosted), or post this image to Facebook.");

  const createParams = new URLSearchParams({ access_token: token, caption, ...(mediaType === "video" ? { video_url: mediaUrl, media_type: "REELS" } : { image_url: mediaUrl }) });
  const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media?${createParams.toString()}`, { method: "POST" });
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(createData?.error?.message || "Instagram media creation failed.");
  const creationId = createData.id;

  if (mediaType === "video") {
    // Video containers process asynchronously on Instagram's side before they can be published.
    let finished = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(res => setTimeout(res, 3000));
      const statusRes = await fetch(`${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${token}`);
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") { finished = true; break; }
      if (statusData.status_code === "ERROR") throw new Error("Instagram failed to process the video.");
    }
    if (!finished) throw new Error("Instagram video processing took too long — try publishing again shortly.");
  }

  const publishParams = new URLSearchParams({ access_token: token, creation_id: creationId });
  const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish?${publishParams.toString()}`, { method: "POST" });
  const publishData = await publishRes.json();
  if (!publishRes.ok) throw new Error(publishData?.error?.message || "Instagram publish failed.");
  return publishData;
}

export async function POST(req: Request) {
  try {
    const { platform, mediaUrl, mediaType, caption } = schema.parse(await req.json());
    const result = platform === "facebook" ? await postFacebook(mediaUrl, mediaType, caption) : await postInstagram(mediaUrl, mediaType, caption);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error, "Social post failed.") }, { status: 400 });
  }
}
