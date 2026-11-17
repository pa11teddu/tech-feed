import { NextResponse, type NextRequest } from "next/server";
import { getFeedPage, UnauthorizedError } from "@/lib/feed-data";
import { isStreamId } from "@/lib/streams";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const s = params.get("s");
  const stream = s && isStreamId(s) ? s : null;
  const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "0", 10) || 0);
  try {
    const page = await getFeedPage(stream, offset);
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "feed unavailable" }, { status: 500 });
  }
}
